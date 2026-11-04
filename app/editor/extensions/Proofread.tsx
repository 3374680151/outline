import { action, computed, makeObservable, observable, reaction } from "mobx";
import * as React from "react";
import i18next from "i18next";
import { toast } from "sonner";
import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorState } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { EditorView } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";
import Extension from "@shared/editor/lib/Extension";
import { errToString } from "@shared/utils/error";
import type { ProofreadSuggestion } from "@shared/types/proofread";
import depths from "@shared/styles/depths";
import {
  ProofreadPanel,
  type ProofreadPanelEntry,
} from "~/editor/components/ProofreadPanel";
import { ProofreadBadge } from "~/editor/components/ProofreadBadge";
import BilingualStore from "~/stores/BilingualStore";
import { client } from "~/utils/ApiClient";
import {
  clampPanelPosition,
  editorPaneRect,
  mountReactOverlay,
  type ReactOverlay,
} from "~/utils/bilingual/overlay";
import { textHash } from "~/utils/bilingual/hash";
import {
  bilingualPrefsVersion,
  proofreadingEnabled,
} from "~/utils/bilingual/prefs";
import { findFragmentRange } from "~/utils/proofread/findFragment";
import {
  selectionBlocks,
  type SelectionBlockText,
} from "~/utils/proofread/selectionBlocks";

/** Options for the proofread extension. */
interface ProofreadOptions {
  /**
   * An additional live gate, e.g. "not the mirror pane", read at event time
   * so pane changes apply without remounting.
   */
  gate?: () => boolean;
}

/** Suggestions stored for one checked top-level block. */
interface BlockResult {
  /** Hash of the block text when it was checked, for staleness detection. */
  hash: string;
  /** The validated suggestions for the block's text. */
  suggestions: ProofreadSuggestion[];
}

/** What anchors the open panel. */
type PanelAnchor =
  | { kind: "pos"; pos: number }
  | { kind: "block"; blockFrom: number }
  | { kind: "badge" };

/** Internal state of the open proofread panel. */
interface ProofreadPanelState {
  /** Whether the check is running, finished, or failed. */
  status: "loading" | "done" | "error";
  /** The suggestions currently shown. */
  entries: ProofreadPanelEntry[];
  /** Whether cards show the block number they came from. */
  showBlock: boolean;
  /** Error message when status is "error". */
  error?: string;
  /** Whether the workspace has no proofread model configured. */
  unconfigured?: boolean;
  /** How many suggestions were applied through the panel. */
  appliedCount: number;
  /** The entry highlighted, when the panel opened from an underline click. */
  activeKey?: string | null;
  /** What the panel is anchored to. */
  anchor: PanelAnchor;
}

/** The viewport rect shape used for panel positioning. */
interface AnchorRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** How long the applied-replacement highlight stays visible, in ms. */
const FLASH_MS = 600;

/** Delay after a selection settles before proofread mode checks it, in ms. */
const SELECTION_CHECK_DELAY_MS = 600;

/** Minimum total words in a selection for the automatic check to run. */
const MIN_SELECTION_WORDS = 4;

/** Minimum block text length for a paragraph to show a candidate marker. */
const MIN_BLOCK_LENGTH = 8;

/** Decoration set holding the applied-replacement highlight. */
const flashKey = new PluginKey<DecorationSet>("proofread-flash");

/** Meta key whose presence forces the computed decorations to re-evaluate. */
const refreshKey = new PluginKey("proofread-refresh");

/**
 * Plugin that renders the short highlight over freshly applied suggestions.
 * The flash is a ProseMirror decoration so it survives DOM redraws.
 */
const flashPlugin = new Plugin<DecorationSet>({
  key: flashKey,
  state: {
    init: () => DecorationSet.empty,
    apply(tr, value) {
      const meta = tr.getMeta(flashKey) as
        | {
            add?: {
              from: number;
              to: number;
            };
            clear?: boolean;
          }
        | undefined;

      if (meta?.clear) {
        return DecorationSet.empty;
      }

      const mapped = value.map(tr.mapping, tr.doc);

      if (meta?.add) {
        return DecorationSet.create(tr.doc, [
          Decoration.inline(meta.add.from, meta.add.to, {
            class: "proofread-flash",
          }),
        ]);
      }

      return mapped;
    },
  },
  props: {
    decorations: (state) => flashKey.getState(state),
  },
});

/** Injects the flash, candidate marker, and underline styles once. */
function ensureProofreadStyles() {
  if (document.getElementById("proofread-styles")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "proofread-styles";
  style.textContent = `
    @keyframes proofread-flash-fade {
      0% { background: rgba(90, 200, 130, 0.4); }
      100% { background: transparent; }
    }
    .proofread-flash {
      animation: proofread-flash-fade ${FLASH_MS}ms ease-out forwards;
      border-radius: 2px;
    }
    .proofread-candidate {
      box-shadow: inset 3px 0 0 0 rgba(99, 148, 255, 0.28);
      transition: box-shadow 150ms ease-in-out;
    }
    .proofread-candidate:hover {
      box-shadow: inset 3px 0 0 0 rgba(99, 148, 255, 0.65);
    }
    .proofread-underline {
      text-decoration: underline wavy;
      text-decoration-skip-ink: none;
      text-underline-offset: 3px;
      cursor: pointer;
    }
    .proofread-underline-spelling { text-decoration-color: #e5484d; }
    .proofread-underline-grammar { text-decoration-color: #3b82f6; }
    .proofread-underline-punctuation { text-decoration-color: #d97706; }
    .proofread-underline-style { text-decoration-color: #6366f1; }
    .proofread-underline-word_choice { text-decoration-color: #12a150; }
    @media (prefers-reduced-motion: reduce) {
      .proofread-flash { animation-duration: 1ms; }
      .proofread-candidate { transition: none; }
    }
  `;
  document.head.appendChild(style);
}

/**
 * Whether a top-level block can show a candidate marker in proofread mode.
 * Containers such as blockquotes and lists are skipped: their text belongs
 * to nested blocks that a top-level check cannot address.
 *
 * @param node The top-level node.
 * @returns True when the block is eligible for checking.
 */
function isCandidateBlock(node: PMNode): boolean {
  return (
    (node.type.name === "paragraph" || node.type.name === "heading") &&
    node.textContent.trim().length >= MIN_BLOCK_LENGTH &&
    /[A-Za-z]/.test(node.textContent)
  );
}

/**
 * The stable key of one panel entry.
 *
 * @param blockIndex The 0-based block index.
 * @param index The suggestion's index within its block.
 * @param suggestion The suggestion.
 * @returns The key.
 */
function entryKey(
  blockIndex: number,
  index: number,
  suggestion: ProofreadSuggestion
): string {
  return `${blockIndex}#${index}:${suggestion.original}→${suggestion.suggestion}`;
}

/**
 * Drops duplicate suggestions that resolve to the same replacement, so one
 * fragment never draws two underlines.
 *
 * @param suggestions The raw suggestions.
 * @returns The unique suggestions, in order.
 */
function dedupeSuggestions(
  suggestions: ProofreadSuggestion[]
): ProofreadSuggestion[] {
  const seen = new Set<string>();
  const unique: ProofreadSuggestion[] = [];

  for (const suggestion of suggestions) {
    const key = `${suggestion.original}→${suggestion.suggestion}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(suggestion);
  }

  return unique;
}

/**
 * Builds the panel entries for all stored results, ordered by block.
 *
 * @param results The results by block index.
 * @returns The entries.
 */
function buildEntries(
  results: Map<number, BlockResult>
): ProofreadPanelEntry[] {
  const entries: ProofreadPanelEntry[] = [];
  const indexes = Array.from(results.keys()).sort((a, b) => a - b);

  for (const blockIndex of indexes) {
    const result = results.get(blockIndex);

    if (!result) {
      continue;
    }

    result.suggestions.forEach((suggestion, index) => {
      entries.push({
        key: entryKey(blockIndex, index, suggestion),
        blockIndex,
        suggestion,
      });
    });
  }

  return entries;
}

/**
 * LLM grammar checking. Proofread mode (the document header toggle) checks
 * the paragraphs a user selects, keeps the suggestions as wavy underlines in
 * the text, and summarizes the pending issues in a corner badge. The
 * selection toolbar and the store request still run a one-off check of the
 * selection (or the block at the cursor) without the mode.
 */
export default class ProofreadExtension extends Extension<ProofreadOptions> {
  /** The open panel state, or null when closed. */
  @observable
  panel: ProofreadPanelState | null = null;

  /** Results per top-level block index, from checks in proofread mode. */
  @observable
  resultsByBlock = new Map<number, BlockResult>();

  /** How many check requests are in flight. */
  @observable
  inFlight = 0;

  private overlay: ReactOverlay | null = null;
  private badgeOverlay: ReactOverlay | null = null;
  private requestSeq = 0;
  private scrollRaf = 0;
  private selectionTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSelection: { from: number; to: number } | null = null;
  private lastCheck: {
    blocks: SelectionBlockText[];
    anchor: PanelAnchor;
  } | null = null;

  constructor(options: Partial<ProofreadOptions> = {}) {
    super(options);
    makeObservable(this);
    ensureProofreadStyles();
  }

  get name() {
    return "proofread";
  }

  /** The total number of pending issues across checked blocks. */
  @computed
  get issueCount(): number {
    let count = 0;

    this.resultsByBlock.forEach((result) => {
      count += result.suggestions.length;
    });

    return count;
  }

  /**
   * Forces the editor to re-evaluate the computed decorations after the
   * stored results changed without a document transaction. The empty
   * transaction is non-undoable and changes nothing in the document.
   */
  private refreshDecorations() {
    const view = this.editor?.view;

    if (!view || view.isDestroyed) {
      return;
    }

    view.dispatch(view.state.tr.setMeta(refreshKey, true));
  }

  /** Whether proofread mode is active for this pane, read at event time. */
  private get modeEnabled(): boolean {
    return proofreadingEnabled() && this.options.gate?.() !== false;
  }

  get plugins() {
    return [
      flashPlugin,
      new Plugin({
        props: {
          decorations: (state) => this.buildDecorationSet(state),
          handleDOMEvents: {
            mousedown: (view, event) =>
              this.handleUnderlineClick(view, event as MouseEvent),
          },
        },
        view: () => {
          // Both panes listen: the pane side is often unknown at mount time,
          // and only the extension whose gate passes answers the request.
          const requestDisposer = reaction(
            () => BilingualStore.proofreadRequest,
            () => {
              if (this.options.gate?.() === false) {
                return;
              }

              const view = this.editor?.view;

              if (view && !view.isDestroyed) {
                this.checkAtSelection(view.state);
              }
            }
          );

          // The mode toggles without remounting; react to the change instead.
          const prefsDisposer = reaction(
            () => bilingualPrefsVersion.get(),
            () => this.handleModeChanged()
          );

          return {
            update: (view, prevState) => {
              if (!prevState.doc.eq(view.state.doc)) {
                this.handleDocChanged(view);
              }

              this.handleSelectionChanged(view, prevState);
            },
            destroy: () => {
              requestDisposer();
              prefsDisposer();
              this.teardown();
            },
          };
        },
      }),
    ];
  }

  commands() {
    return {
      proofread:
        () =>
        (state: EditorState): boolean => {
          if (this.options.gate?.() === false) {
            return false;
          }

          this.checkAtSelection(state);
          return true;
        },
    };
  }

  /**
   * Starts a check for the selection, or for the block at the cursor when
   * the selection is collapsed. Used by the selection toolbar and the store
   * request, and works whether or not proofread mode is enabled.
   *
   * @param state The editor state to read the selection from.
   */
  @action
  private checkAtSelection(state: EditorState) {
    const { selection } = state;

    if (!selection.empty) {
      const blocks = selectionBlocks(state.doc, selection.from, selection.to);

      if (blocks) {
        void this.checkBlocks(blocks, {
          kind: "pos",
          pos: selection.to,
        });
        return;
      }
    }

    // Resolve the top-level block containing the selection head. An
    // AllSelection (Cmd+A) or a top-level NodeSelection resolves at depth 0,
    // so the position is clamped into the nearest content position first.
    const clamped = Math.min(
      Math.max(selection.from, 1),
      Math.max(state.doc.content.size - 1, 1)
    );
    let $pos = state.doc.resolve(clamped);

    if ($pos.depth === 0) {
      // Between blocks; step forward into the next one.
      $pos = state.doc.resolve(Math.min(clamped + 1, state.doc.content.size));
    }

    if ($pos.depth === 0) {
      return;
    }

    const blockFrom = $pos.before(1);
    const block = state.doc.nodeAt(blockFrom);
    const text = block?.textContent.trim();

    if (!block || !text) {
      return;
    }

    void this.checkBlocks(
      [
        {
          blockFrom,
          blockIndex: $pos.index(0),
          text,
        },
      ],
      {
        kind: "block",
        blockFrom,
      }
    );
  }

  /**
   * Runs the automatic check for the current selection in proofread mode:
   * the selection must contain enough English writing to be worth a model
   * call; single words stay with the translation dot.
   *
   * @param state The editor state to read the selection from.
   */
  @action
  private checkSelection(state: EditorState) {
    if (!this.modeEnabled) {
      return;
    }

    const { selection } = state;

    if (selection.empty) {
      return;
    }

    const blocks = selectionBlocks(state.doc, selection.from, selection.to);

    if (!blocks) {
      return;
    }

    const words = blocks.reduce(
      (count, block) =>
        count + block.text.split(/\s+/).filter(Boolean).length,
      0
    );
    const hasLatin = blocks.some((block) => /[A-Za-z]/.test(block.text));

    if (!hasLatin || words < MIN_SELECTION_WORDS) {
      return;
    }

    void this.checkBlocks(blocks, {
      kind: "pos",
      pos: selection.to,
    });
  }

  /**
   * Sends one batch check request and opens the panel with the response.
   *
   * @param blocks The block texts to check.
   * @param anchor What the panel anchors to.
   */
  private async checkBlocks(
    blocks: SelectionBlockText[],
    anchor: PanelAnchor
  ) {
    const seq = ++this.requestSeq;
    const view = this.editor?.view;

    if (!view || view.isDestroyed) {
      return;
    }

    this.lastCheck = {
      blocks,
      anchor,
    };

    // Record the block hashes at send time so results whose block changed
    // while the request ran are dropped instead of drawn at wrong ranges.
    const sentHashes = new Map<number, string>();

    for (const block of blocks) {
      const node = view.state.doc.nodeAt(block.blockFrom);
      sentHashes.set(block.blockIndex, textHash(node?.textContent ?? ""));
    }

    this.inFlight += 1;
    this.panel = {
      status: "loading",
      entries: [],
      showBlock: blocks.length > 1,
      appliedCount: 0,
      activeKey: null,
      anchor,
    };
    this.renderPanel();
    this.syncBadge();

    try {
      const res = await client.post("/proofread.checkBatch", {
        items: blocks.map((block) => ({
          id: String(block.blockIndex),
          text: block.text,
        })),
      });
      const data = res.data as {
        results?: {
          id: string;
          suggestions?: ProofreadSuggestion[];
          unconfigured?: boolean;
          error?: string;
        }[];
      };

      if (seq !== this.requestSeq || !this.panel) {
        return;
      }

      this.applyBatchResponse(data.results ?? [], sentHashes, blocks.length);
    } catch (err) {
      if (seq !== this.requestSeq || !this.panel) {
        return;
      }

      this.panel = {
        ...this.panel,
        status: "error",
        error: errToString(err),
      };
    } finally {
      this.inFlight -= 1;
      this.syncBadge();
    }

    this.renderPanel();
  }

  /**
   * Stores the batch response: per-block results are kept for drawing, the
   * panel shows the checked blocks' suggestions.
   *
   * @param results The per-item results from the server.
   * @param sentHashes The block hashes at send time, by block index.
   * @param blockCount How many blocks were sent.
   */
  @action
  private applyBatchResponse(
    results: {
      id: string;
      suggestions?: ProofreadSuggestion[];
      unconfigured?: boolean;
      error?: string;
    }[],
    sentHashes: Map<number, string>,
    blockCount: number
  ) {
    const view = this.editor?.view;
    const panel = this.panel;

    if (!view || view.isDestroyed || !panel) {
      return;
    }

    let unconfigured = false;
    let errored = 0;
    let firstError: string | undefined;

    for (const result of results) {
      const blockIndex = Number(result.id);

      if (result.unconfigured) {
        unconfigured = true;
        continue;
      }

      if (result.error) {
        errored += 1;
        firstError = firstError ?? result.error;
        continue;
      }

      const sentHash = sentHashes.get(blockIndex);
      const node =
        blockIndex >= 0 && blockIndex < view.state.doc.childCount
          ? view.state.doc.child(blockIndex)
          : null;

      if (!node || sentHash === undefined) {
        continue;
      }

      const hash = textHash(node.textContent);

      if (hash !== sentHash) {
        // The block changed while the request ran; drop instead of drawing
        // underlines against stale text.
        continue;
      }

      const suggestions = dedupeSuggestions(result.suggestions ?? []);

      if (suggestions.length > 0) {
        this.resultsByBlock.set(blockIndex, {
          hash,
          suggestions,
        });
      } else {
        this.resultsByBlock.delete(blockIndex);
      }
    }

    if (unconfigured) {
      this.panel = {
        ...panel,
        status: "done",
        entries: [],
        unconfigured: true,
      };
    } else if (errored > 0 && errored === results.length) {
      this.panel = {
        ...panel,
        status: "error",
        error: firstError,
      };
    } else {
      const entries = buildEntries(
        new Map(
          Array.from(sentHashes.keys()).flatMap((blockIndex) => {
            const result = this.resultsByBlock.get(blockIndex);
            return result ? [[blockIndex, result] as const] : [];
          })
        )
      );

      this.panel = {
        ...panel,
        status: "done",
        entries,
        showBlock: panel.showBlock || blockCount > 1,
        unconfigured: undefined,
      };
    }

    this.refreshDecorations();
  }

  /**
   * Opens the summary panel listing every pending issue across checked
   * blocks. Called from the corner badge.
   */
  @action
  openSummary = () => {
    const entries = buildEntries(this.resultsByBlock);

    if (entries.length === 0) {
      toast.message(i18next.t("No proofread issues yet"));
      return;
    }

    this.panel = {
      status: "done",
      entries,
      showBlock: this.resultsByBlock.size > 1,
      appliedCount: 0,
      activeKey: null,
      anchor: {
        kind: "badge",
      },
    };
    this.renderPanel();
  };

  /**
   * Applies one suggestion: replaces the first occurrence of the fragment in
   * its block, re-validates the remaining suggestions against the new text,
   * and closes the panel when nothing is left.
   *
   * @param entry The panel entry to apply.
   */
  @action
  applySuggestion = (entry: ProofreadPanelEntry) => {
    const view = this.editor?.view;

    if (!view || view.isDestroyed) {
      return;
    }

    const blockPosition = this.blockPosition(view.state.doc, entry.blockIndex);

    if (!blockPosition) {
      this.removeEntry(entry);
      return;
    }

    const range = findFragmentRange(
      blockPosition.node,
      blockPosition.from,
      entry.suggestion.original
    );

    if (!range) {
      this.removeEntry(entry);
      return;
    }

    const marks = view.state.doc.resolve(range.from).marks();
    const tr = view.state.tr.replaceWith(
      range.from,
      range.to,
      view.state.schema.text(entry.suggestion.suggestion, marks)
    );
    tr.setMeta(flashKey, {
      add: {
        from: range.from,
        to: range.from + entry.suggestion.suggestion.length,
      },
    });
    view.dispatch(tr);

    window.setTimeout(() => {
      const current = this.editor?.view;

      if (current && !current.isDestroyed) {
        current.dispatch(current.state.tr.setMeta(flashKey, { clear: true }));
      }
    }, FLASH_MS);

    // The dispatch above re-validated the stored results; now update the
    // open panel from the surviving entries.
    if (this.panel) {
      const panel = this.panel;
      const entries = panel.entries.filter(
        (candidate) =>
          candidate !== entry && this.entryStillValid(view.state, candidate)
      );
      const appliedCount = panel.appliedCount + 1;

      if (entries.length === 0) {
        toast.success(
          i18next.t("Applied {{count}} suggestions", {
            count: appliedCount,
          })
        );
        this.close();
        this.refreshDecorations();
        return;
      }

      this.panel = {
        ...panel,
        entries,
        appliedCount,
      };
      this.renderPanel();
    }

    this.refreshDecorations();
  };

  /** Dismisses one suggestion without changing the text. */
  @action
  removeEntry = (entry: ProofreadPanelEntry) => {
    const result = this.resultsByBlock.get(entry.blockIndex);

    if (result) {
      const remaining = result.suggestions.filter(
        (suggestion) => suggestion !== entry.suggestion
      );

      if (remaining.length > 0) {
        this.resultsByBlock.set(entry.blockIndex, {
          ...result,
          suggestions: remaining,
        });
      } else {
        this.resultsByBlock.delete(entry.blockIndex);
      }
    }

    if (this.panel) {
      const entries = this.panel.entries.filter(
        (candidate) => candidate !== entry
      );

      if (entries.length === 0) {
        this.close();
      } else {
        this.panel = {
          ...this.panel,
          entries,
        };
        this.renderPanel();
      }
    }

    this.syncBadge();
    this.refreshDecorations();
  };

  /** Re-runs the check that produced the current panel content. */
  @action
  retry = () => {
    const last = this.lastCheck;

    if (last) {
      void this.checkBlocks(last.blocks, last.anchor);
    }
  };

  /** Closes the panel and returns focus to the editor. */
  @action
  close = () => {
    if (!this.panel) {
      return;
    }

    this.panel = null;
    this.requestSeq += 1;
    this.destroyOverlay();
    this.detachScrollFollowIfIdle();

    const view = this.editor?.view;

    if (view && !view.isDestroyed) {
      view.focus();
    }
  };

  /**
   * Reacts to the proofread mode toggling without a remount: enabling mounts
   * the badge and draws the candidate markers, disabling clears everything.
   */
  @action
  private handleModeChanged() {
    this.clearSelectionTimer();

    if (!this.modeEnabled) {
      this.resultsByBlock.clear();
      this.lastSelection = null;
      this.close();
      this.destroyBadge();
      this.refreshDecorations();
      return;
    }

    this.syncBadge();
    this.refreshDecorations();
  }

  /**
   * Schedules the automatic check when a selection settles in proofread
   * mode, cancelling a pending check when the selection collapses or
   * changes.
   *
   * @param view The editor view.
   * @param prevState The state before the latest transaction.
   */
  private handleSelectionChanged(view: EditorView, prevState: EditorState) {
    const { selection } = view.state;

    if (selection.empty) {
      if (!prevState.selection.empty) {
        this.clearSelectionTimer();
      }

      this.lastSelection = null;
      return;
    }

    if (!this.modeEnabled) {
      return;
    }

    const current = {
      from: selection.from,
      to: selection.to,
    };

    if (
      this.lastSelection &&
      this.lastSelection.from === current.from &&
      this.lastSelection.to === current.to
    ) {
      return;
    }

    this.lastSelection = current;
    this.clearSelectionTimer();
    this.selectionTimer = setTimeout(() => {
      this.selectionTimer = null;
      const currentView = this.editor?.view;

      if (currentView && !currentView.isDestroyed) {
        this.checkSelection(currentView.state);
      }
    }, SELECTION_CHECK_DELAY_MS);
  }

  /**
   * Reacts to document changes: blocks whose text changed keep only the
   * suggestions whose fragment still exists (so applying one fix does not
   * wipe the block's other underlines), and the open panel drops entries
   * that no longer match so a stale accept can never corrupt the document.
   *
   * @param view The editor view.
   */
  @action
  private handleDocChanged(view: EditorView) {
    const doc = view.state.doc;
    const removed: number[] = [];

    this.resultsByBlock.forEach((result, blockIndex) => {
      const node =
        blockIndex < doc.childCount ? doc.child(blockIndex) : null;

      if (!node) {
        removed.push(blockIndex);
        return;
      }

      const hash = textHash(node.textContent);

      if (hash === result.hash) {
        return;
      }

      const remaining = result.suggestions.filter((suggestion) =>
        node.textContent.includes(suggestion.original)
      );

      if (remaining.length > 0) {
        this.resultsByBlock.set(blockIndex, {
          hash,
          suggestions: remaining,
        });
      } else {
        removed.push(blockIndex);
      }
    });

    removed.forEach((blockIndex) => this.resultsByBlock.delete(blockIndex));

    if (this.panel && this.panel.entries.length > 0) {
      const entries = this.panel.entries.filter((entry) =>
        this.entryStillValid(view.state, entry)
      );

      if (entries.length === 0) {
        this.close();
        this.syncBadge();
        return;
      }

      if (entries.length !== this.panel.entries.length) {
        this.panel = {
          ...this.panel,
          entries,
        };
      }
    }

    if (this.panel) {
      this.positionPanel();
    }

    this.syncBadge();
  }

  /**
   * Whether a panel entry's fragment still exists in its block.
   *
   * @param state The current editor state.
   * @param entry The entry to test.
   * @returns True when the fragment is still present.
   */
  private entryStillValid(
    state: EditorState,
    entry: ProofreadPanelEntry
  ): boolean {
    const node =
      entry.blockIndex < state.doc.childCount
        ? state.doc.child(entry.blockIndex)
        : null;
    return (
      !!node && node.textContent.includes(entry.suggestion.original)
    );
  }

  /**
   * Builds the decoration set: candidate markers on checkable blocks while
   * the mode is on, and wavy underlines for the stored suggestions whose
   * fragments still match the current block text. Rebuilt on demand rather
   * than mapped through transactions, so collaboration updates cannot leave
   * decorations at stale positions.
   *
   * @param state The editor state to decorate.
   * @returns The decorations.
   */
  private buildDecorationSet(state: EditorState): DecorationSet {
    const mode = this.modeEnabled;

    if (!mode && this.resultsByBlock.size === 0) {
      return DecorationSet.empty;
    }

    const decorations: Decoration[] = [];

    state.doc.forEach((node, offset, index) => {
      if (mode && isCandidateBlock(node)) {
        decorations.push(
          Decoration.node(offset, offset + node.nodeSize, {
            class: "proofread-candidate",
          })
        );
      }

      const result = this.resultsByBlock.get(index);

      if (!result || textHash(node.textContent) !== result.hash) {
        return;
      }

      const seen = new Set<string>();

      for (const suggestion of result.suggestions) {
        const range = findFragmentRange(node, offset, suggestion.original);

        if (!range) {
          continue;
        }

        const key = `${range.from}:${range.to}`;

        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        decorations.push(
          Decoration.inline(range.from, range.to, {
            class: `proofread-underline proofread-underline-${suggestion.category}`,
          })
        );
      }
    });

    return decorations.length > 0
      ? DecorationSet.create(state.doc, decorations)
      : DecorationSet.empty;
  }

  /**
   * Opens the panel near an underline the user clicked, highlighting the
   * matching entry.
   *
   * @param view The editor view.
   * @param event The mousedown event.
   * @returns True when the click hit an underline and was handled.
   */
  @action
  private handleUnderlineClick(view: EditorView, event: MouseEvent): boolean {
    if (!this.modeEnabled) {
      return false;
    }

    const target = event.target as HTMLElement | null;

    if (
      !target ||
      !(target instanceof Element) ||
      !target.classList.contains("proofread-underline")
    ) {
      return false;
    }

    let pos: number;

    try {
      pos = view.posAtDOM(target, 0);
    } catch {
      return false;
    }

    const $pos = view.state.doc.resolve(pos);
    const blockIndex = $pos.index(0);
    const result = this.resultsByBlock.get(blockIndex);
    const block =
      blockIndex < view.state.doc.childCount
        ? view.state.doc.child(blockIndex)
        : null;

    if (!result || !block) {
      return false;
    }

    const blockFrom = $pos.before(1);
    let activeKey: string | null = null;

    result.suggestions.forEach((suggestion, index) => {
      const range = findFragmentRange(block, blockFrom, suggestion.original);

      if (range && pos >= range.from && pos <= range.to) {
        activeKey = entryKey(blockIndex, index, suggestion);
      }
    });

    const entries = buildEntries(this.resultsByBlock);

    if (entries.length === 0) {
      return false;
    }

    this.panel = {
      status: "done",
      entries,
      showBlock: this.resultsByBlock.size > 1,
      appliedCount: 0,
      activeKey,
      anchor: {
        kind: "pos",
        pos,
      },
    };
    this.renderPanel();
    return true;
  }

  /**
   * The position of a top-level block in the document.
   *
   * @param doc The document.
   * @param blockIndex The 0-based block index.
   * @returns The block node and its start position, or null when gone.
   */
  private blockPosition(
    doc: PMNode,
    blockIndex: number
  ): { from: number; node: PMNode } | null {
    if (blockIndex >= doc.childCount) {
      return null;
    }

    const node = doc.child(blockIndex);
    let from = 0;

    doc.forEach((child, offset, index) => {
      if (index === blockIndex) {
        from = offset;
      }
    });

    return {
      from,
      node,
    };
  }

  /** Renders (or re-renders) the floating panel overlay. */
  private renderPanel() {
    if (!this.panel) {
      this.destroyOverlay();
      this.detachScrollFollowIfIdle();
      return;
    }

    const view = this.editor?.view;

    if (!view || view.isDestroyed) {
      return;
    }

    if (!this.overlay) {
      this.overlay = mountReactOverlay(depths.popover);
      this.attachScrollFollow();

      // Place the container immediately at the estimated spot so the panel
      // does not flash at the viewport origin before measurement.
      const anchor = this.panelRect();

      if (anchor) {
        const estimated = clampPanelPosition(
          anchor,
          { width: 420, height: 240 },
          10
        );
        this.overlay.container.style.left = `${estimated.left}px`;
        this.overlay.container.style.top = `${estimated.top}px`;
      }
    }

    const panel = this.panel;
    this.overlay.render(
      <ProofreadPanel
        status={panel.status}
        entries={panel.entries}
        error={panel.error}
        unconfigured={panel.unconfigured}
        activeKey={panel.activeKey}
        showBlock={panel.showBlock}
        onAccept={this.applySuggestion}
        onIgnore={this.removeEntry}
        onRetry={this.retry}
        onClose={this.close}
      />
    );

    // Position once the panel has a measurable size.
    window.requestAnimationFrame(() => this.positionPanel());
  }

  /** Positions the overlay against the current anchor rect. */
  private positionPanel() {
    if (!this.overlay || !this.panel) {
      return;
    }

    const anchor = this.panelRect();

    if (!anchor) {
      this.close();
      return;
    }

    const element = this.overlay.container.firstElementChild as HTMLElement | null;
    const size = {
      width: element?.offsetWidth || 420,
      height: element?.offsetHeight || 240,
    };
    const position = clampPanelPosition(anchor, size, 10);
    this.overlay.container.style.left = `${position.left}px`;
    this.overlay.container.style.top = `${position.top}px`;
  }

  /**
   * The viewport rect of the panel's anchor.
   *
   * @returns The rect, or null when the anchor is gone.
   */
  private panelRect(): AnchorRect | null {
    const panel = this.panel;
    const view = this.editor?.view;

    if (!panel || !view || view.isDestroyed) {
      return null;
    }

    try {
      switch (panel.anchor.kind) {
        case "block": {
          const dom = view.nodeDOM(panel.anchor.blockFrom);
          return dom instanceof HTMLElement
            ? dom.getBoundingClientRect()
            : null;
        }

        case "pos": {
          const coords = view.coordsAtPos(panel.anchor.pos);

          if (coords.top < 0 || coords.top > window.innerHeight) {
            return null;
          }

          return {
            left: coords.left,
            right: coords.left,
            top: coords.top,
            bottom: coords.bottom,
          };
        }

        case "badge": {
          const badge = this.badgeOverlay?.container
            .firstElementChild as HTMLElement | null;
          return badge ? badge.getBoundingClientRect() : null;
        }

        default:
          return null;
      }
    } catch {
      return null;
    }
  }

  /** Mounts or updates the corner badge for proofread mode. */
  private syncBadge() {
    if (!this.modeEnabled) {
      this.destroyBadge();
      return;
    }

    const view = this.editor?.view;

    if (!view || view.isDestroyed) {
      this.destroyBadge();
      return;
    }

    if (!this.badgeOverlay) {
      this.badgeOverlay = mountReactOverlay(depths.popover);
      this.attachScrollFollow();
    }

    this.badgeOverlay.render(
      <ProofreadBadge
        issues={this.issueCount}
        checking={this.inFlight > 0}
        onClick={this.openSummary}
      />
    );
    this.positionBadge();
  }

  /** Pins the badge to the visible bottom-right corner of the editor pane. */
  private positionBadge() {
    if (!this.badgeOverlay) {
      return;
    }

    const view = this.editor?.view;

    if (!view || view.isDestroyed) {
      return;
    }

    const pane = editorPaneRect(view);

    if (!pane) {
      return;
    }

    const size = 36;
    const left = Math.max(8, pane.right - size - 16);
    const top = Math.max(8, pane.bottom - size - 16);
    this.badgeOverlay.container.style.left = `${left}px`;
    this.badgeOverlay.container.style.top = `${top}px`;
  }

  private destroyBadge() {
    this.badgeOverlay?.destroy();
    this.badgeOverlay = null;
    this.detachScrollFollowIfIdle();
  }

  /** Keeps the panel and badge pinned to their anchors while scrolling. */
  private attachScrollFollow() {
    document.addEventListener("scroll", this.handleScroll, {
      capture: true,
      passive: true,
    });
  }

  private detachScrollFollowIfIdle() {
    if (!this.overlay && !this.badgeOverlay) {
      document.removeEventListener("scroll", this.handleScroll, {
        capture: true,
      });
    }
  }

  private handleScroll = () => {
    if (this.scrollRaf) {
      return;
    }

    this.scrollRaf = window.requestAnimationFrame(() => {
      this.scrollRaf = 0;
      this.positionPanel();
      this.positionBadge();
    });
  };

  private clearSelectionTimer() {
    if (this.selectionTimer) {
      clearTimeout(this.selectionTimer);
      this.selectionTimer = null;
    }
  }

  private destroyOverlay() {
    this.overlay?.destroy();
    this.overlay = null;
  }

  /** Releases the overlays, timers, and listeners when the editor unmounts. */
  private teardown() {
    this.clearSelectionTimer();
    this.requestSeq += 1;
    this.destroyOverlay();
    this.destroyBadge();
    document.removeEventListener("scroll", this.handleScroll, {
      capture: true,
    });
  }
}
