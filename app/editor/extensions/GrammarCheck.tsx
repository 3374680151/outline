import { makeObservable, observable, reaction, runInAction } from "mobx";
import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorState, Transaction } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { EditorView } from "prosemirror-view";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import Extension from "@shared/editor/lib/Extension";
import depths from "@shared/styles/depths";
import type { GrammarMatchDTO } from "@shared/types/bilingual";
import GrammarAssist from "~/editor/components/GrammarAssist";
import BilingualStore from "~/stores/BilingualStore";
import Logger from "~/utils/Logger";
import { blockRange, blockRangeInDoc } from "~/utils/bilingual/editorBlocks";
import { textHash } from "~/utils/bilingual/hash";
import { pmRangeForOffset } from "~/utils/bilingual/offsetTable";
import {
  clearActiveGrammarExtension,
  setActiveGrammarExtension,
} from "~/utils/bilingual/grammarUi";
import { mountReactOverlay, editorPaneRect } from "~/utils/bilingual/overlay";
import { buildParagraphMapFromNode } from "~/utils/bilingual/prosemirrorText";
import {
  addGrammarIgnoredRule,
  bilingualPrefsVersion,
  grammarCheckingEnabled,
  grammarIgnoredRules,
  grammarLevel,
} from "~/utils/bilingual/prefs";
import { ensureBilingualStyles } from "~/utils/bilingual/styles";
import { matchType } from "~/utils/bilingual/matchType";
import { observeBlockVisibility } from "~/utils/bilingual/visibility";
import type { BlockVisibilityObserver } from "~/utils/bilingual/visibility";

/**
 * Options for the grammar check extension.
 */
interface GrammarCheckOptions {
  /** Language long code, e.g. en-US. */
  language: string;
  /**
   * An additional live gate, e.g. the workspace grammar preference, read at
   * check time so preference changes apply without remounting.
   */
  gate?: () => boolean;
  /** Notified when the total issue count changes. */
  onIssueCountChange?: (count: number) => void;
}

/** A stored raw match relative to its paragraph text. */
interface RawMatch {
  match: GrammarMatchDTO;
  /** Hash of the paragraph text at check time. */
  textHash: string;
}

/** An ordered issue reference used by the issue panel and navigation. */
export interface GrammarIssueRef {
  blockIndex: number;
  match: GrammarMatchDTO;
  /** Hash of the block text at check time, used to resolve the range. */
  textHash: string;
}

/** Debounce for grammar checks after typing, in milliseconds. */
const CHECK_DEBOUNCE_MS = 700;

/** Minimum text length before a block is checked. */
const MIN_CHECK_LENGTH = 8;

/** Maximum blocks checked in one batched flush; matches the server cap. */
const MAX_BLOCKS_PER_FLUSH = 20;

/** Visual class per LanguageTool category. */
function categoryClass(match: GrammarMatchDTO): string {
  return `bilingual-grammar-${matchType(match)}`;
}

/**
 * Grammar check extension: extracts paragraph text, batches it through the
 * Outline grammar API (LanguageTool), and renders click-to-locate underline
 * decorations. Underlines are locators only: clicking one opens the shared
 * issue panel (floating badge in the pane's corner) focused on that issue,
 * and every fix happens from the panel. One-click fixes are ordinary
 * transactions so they participate in undo.
 */
export default class GrammarCheckExtension extends Extension<GrammarCheckOptions> {
  /** Total open issue count across the document. */
  @observable
  issueCount = 0;

  /** Whether a check request is currently in flight. */
  @observable
  checking = false;

  /** Whether the grammar service is currently unavailable. */
  @observable
  unavailable = false;

  /** Whether the issue panel is currently open. */
  @observable
  panelOpen = false;

  /** Index into {@link listIssues} of the issue highlighted in the text. */
  @observable
  activeIssueIndex: number | null = null;

  /** How many issues were fixed through the panel since the last reset. */
  @observable
  fixedCount = 0;

  /**
   * Bumped whenever the stored matches change, so observers of the issue
   * list re-render even when the total count stays the same.
   */
  @observable
  revision = 0;

  private key = new PluginKey<DecorationSet>("bilingual-grammar");

  constructor(options?: Partial<GrammarCheckOptions>) {
    super(options);
    makeObservable(this);

    // Preference toggles (enable/disable, level, ignored rules) apply live:
    // the stored matches are dropped when checking is switched off and a
    // re-check is queued when the level or rules change.
    this.prefsDisposer = reaction(
      () => bilingualPrefsVersion.get(),
      () => {
        if (!this.enabled) {
          this.clearAllMatches();

          // Re-assert the cleared state after any in-flight editor updates
          // settle, so no stale decoration survives a rapid toggle.
          setTimeout(() => {
            if (!this.enabled) {
              this.refreshDecorations();
            }
          }, 150);
          this.syncAssistOverlay();
          return;
        }

        this.matchesByBlock.clear();
        this.sentHashByBlock.clear();
        this.refreshDecorations();
        this.notifyIssueCount();
        this.syncAssistOverlay();

        const view = this.editor?.view;

        if (view) {
          for (let i = 0; i < view.state.doc.childCount; i++) {
            this.queue.add(i);
          }
          this.scheduleCheck();
        }
      }
    );
  }

  private matchesByBlock = new Map<number, RawMatch[]>();
  private sentHashByBlock = new Map<number, string>();
  private queue = new Set<number>();
  private checkTimer: ReturnType<typeof setTimeout> | null = null;
  private assistOverlay: ReturnType<typeof mountReactOverlay> | null = null;
  private visibilityObserver: BlockVisibilityObserver | null = null;
  private prefsDisposer: (() => void) | null = null;

  get defaultOptions(): GrammarCheckOptions {
    return { language: "en-US" };
  }

  get name() {
    return "bilingual-grammar-check";
  }

  get allowInReadOnly() {
    return false;
  }

  /**
   * Whether checking is currently enabled, from the user's live preferences
   * and any additional gate provided by the host editor.
   *
   * @returns True when checking should run.
   */
  private get enabled(): boolean {
    return grammarCheckingEnabled() && (this.options.gate?.() ?? true);
  }

  /**
   * The ordered flat list of open issues, used by the issue panel and
   * prev/next navigation.
   *
   * @returns Issues ordered by block index, then offset.
   */
  listIssues(): GrammarIssueRef[] {
    const issues: GrammarIssueRef[] = [];

    for (const index of [...this.matchesByBlock.keys()].sort((a, b) => a - b)) {
      for (const raw of this.matchesByBlock.get(index) ?? []) {
        issues.push({
          blockIndex: index,
          match: raw.match,
          textHash: raw.textHash,
        });
      }
    }

    return issues;
  }

  /**
   * Scrolls an issue into view and focuses it in the panel.
   *
   * @param issue The issue to reveal.
   */
  revealIssue(issue: GrammarIssueRef) {
    const index = this.listIssues().findIndex(
      (ref) => ref.blockIndex === issue.blockIndex && ref.match === issue.match
    );

    if (index >= 0) {
      this.focusIssue(index);
    }
  }

  /**
   * Opens the issue panel and focuses an issue by its position in
   * {@link listIssues}, scrolling the text into view.
   *
   * @param index The issue index.
   */
  focusIssue(index: number) {
    const issue = this.listIssues()[index];

    if (!issue) {
      return;
    }

    runInAction(() => {
      this.panelOpen = true;
      this.activeIssueIndex = index;
    });
    this.scrollIssueIntoView(issue);
    this.refreshDecorations();
  }

  /**
   * Highlights an issue in the text without changing the panel's open
   * state, used when a panel row is clicked.
   *
   * @param index The issue index.
   */
  focusIssueInText(index: number) {
    const issue = this.listIssues()[index];

    if (!issue) {
      return;
    }

    runInAction(() => {
      this.activeIssueIndex = index;
    });
    this.scrollIssueIntoView(issue);
    this.refreshDecorations();
  }

  /**
   * Moves the text focus to the previous or next open issue.
   *
   * @param delta -1 for the previous issue, 1 for the next.
   */
  moveFocus(delta: number) {
    const issues = this.listIssues();

    if (issues.length === 0) {
      return;
    }

    const next =
      this.activeIssueIndex === null
        ? delta > 0
          ? 0
          : issues.length - 1
        : Math.min(
            issues.length - 1,
            Math.max(0, this.activeIssueIndex + delta)
          );

    this.focusIssueInText(next);
  }

  /**
   * Opens the issue panel.
   */
  openPanel() {
    runInAction(() => {
      this.panelOpen = true;
    });
  }

  /**
   * Closes the issue panel and clears the text highlight.
   */
  closePanel() {
    runInAction(() => {
      this.panelOpen = false;
      this.activeIssueIndex = null;
    });
    this.refreshDecorations();
  }

  /**
   * Applies a replacement for the issue at the given panel index and
   * advances the focus to the next open issue.
   *
   * @param index The issue index into {@link listIssues}.
   * @param value The replacement text.
   * @returns True when the fix was applied.
   */
  applyFixAt(index: number, value: string): boolean {
    const issue = this.listIssues()[index];

    if (!issue) {
      return false;
    }

    const applied = this.applyFix(
      issue.match,
      issue.blockIndex,
      issue.textHash,
      value
    );

    if (!applied) {
      return false;
    }

    runInAction(() => {
      this.fixedCount += 1;
    });
    this.advanceFocusAfterRemoval(index);
    return true;
  }

  /**
   * Skips a single occurrence of the issue at the given index and advances
   * the focus.
   *
   * @param index The issue index into {@link listIssues}.
   */
  skipIssueAt(index: number) {
    const issue = this.listIssues()[index];

    if (!issue) {
      return;
    }

    this.skipIssue(issue);
    this.advanceFocusAfterRemoval(index);
  }

  /**
   * Ignores the rule behind the issue at the given index for this user;
   * every occurrence of the rule disappears.
   *
   * @param index The issue index into {@link listIssues}.
   */
  ignoreRuleAt(index: number) {
    const issue = this.listIssues()[index];

    if (!issue) {
      return;
    }

    addGrammarIgnoredRule(issue.match.rule.id);
    this.removeMatchesByRule(issue.match.rule.id);
    this.refreshDecorations();
    this.advanceFocusAfterRemoval(index);
  }

  /**
   * Whether the issue at the given index can be fixed with an automatic
   * replacement; issues spanning formatting boundaries cannot.
   *
   * @param index The issue index into {@link listIssues}.
   * @returns True when an automatic fix is possible.
   */
  canAutoFixAt(index: number): boolean {
    const issue = this.listIssues()[index];

    if (!issue) {
      return false;
    }

    const resolved = this.resolveRange(
      issue.match,
      issue.blockIndex,
      issue.textHash
    );
    return !!resolved && !resolved.crossesGap;
  }

  /**
   * The visible rectangle of the editor's scroll pane, used by the floating
   * badge and panel to pin themselves to the pane's corner.
   *
   * @returns The pane rect in viewport coordinates, or null.
   */
  paneRect(): {
    left: number;
    right: number;
    top: number;
    bottom: number;
  } | null {
    const view = this.editor?.view;

    if (!view) {
      return null;
    }

    return editorPaneRect(view);
  }

  /**
   * Scrolls the block containing an issue to the center of the pane.
   *
   * @param issue The issue to reveal.
   */
  private scrollIssueIntoView(issue: GrammarIssueRef) {
    const view = this.editor?.view;

    if (!view) {
      return;
    }

    const range = blockRange(view, issue.blockIndex);

    if (!range) {
      return;
    }

    const dom = view.domAtPos(range.from + 1);
    const element =
      dom.node instanceof Element ? dom.node : dom.node.parentElement;
    element?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  /**
   * Moves the panel focus to the next open issue after one was removed,
   * or clears the highlight when the document is clean.
   *
   * @param index The index the issue was removed from.
   */
  private advanceFocusAfterRemoval(index: number) {
    const remaining = this.listIssues();

    if (remaining.length === 0) {
      runInAction(() => {
        this.activeIssueIndex = null;
      });
      this.refreshDecorations();
      return;
    }

    const nextIndex = Math.min(index, remaining.length - 1);
    runInAction(() => {
      this.activeIssueIndex = nextIndex;
    });
    this.scrollIssueIntoView(remaining[nextIndex]);
    this.refreshDecorations();
  }

  /**
   * Clears every stored result and re-queues all visible blocks, recovering
   * the underlines after the grammar service was unreachable.
   */
  recheckAll() {
    if (!this.enabled) {
      return;
    }

    this.matchesByBlock.clear();
    this.sentHashByBlock.clear();
    runInAction(() => {
      this.activeIssueIndex = null;
      this.fixedCount = 0;
    });
    this.refreshDecorations();
    this.notifyIssueCount();

    const view = this.editor?.view;

    if (view) {
      for (let i = 0; i < view.state.doc.childCount; i++) {
        this.queue.add(i);
      }
      this.scheduleCheck();
    }
  }

  /**
   * Removes a single occurrence of an issue ("skip this one"), without
   * touching the rule.
   *
   * @param issue The issue to skip.
   */
  skipIssue(issue: GrammarIssueRef) {
    const remaining = (this.matchesByBlock.get(issue.blockIndex) ?? []).filter(
      (raw) => raw.match !== issue.match
    );
    this.matchesByBlock.set(issue.blockIndex, remaining);
    this.notifyIssueCount();
    this.refreshDecorations();
  }

  get plugins() {
    return [
      new Plugin<DecorationSet>({
        key: this.key,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, value, oldState, newState) => {
            if (tr.docChanged) {
              // Typing immediately leaves review mode: the highlight would
              // otherwise drift away from the text it describes.
              runInAction(() => {
                this.activeIssueIndex = null;
              });
              this.scheduleRecheck(oldState, newState);
            }

            return value;
          },
        },
        props: {
          decorations: (state: EditorState) =>
            this.enabled
              ? this.buildDecorationSet(state.doc)
              : DecorationSet.empty,
          handleDOMEvents: {
            // Clicking an underline locates the issue: the panel opens
            // focused on it, and fixing happens from the panel.
            mousedown: (view: EditorView, event: MouseEvent) => {
              const target = event.target as HTMLElement;

              if (!target.classList?.contains("bilingual-underline")) {
                return false;
              }

              const coords = view.posAtCoords({
                left: event.clientX,
                top: event.clientY,
              });

              if (!coords) {
                return false;
              }

              const blockIndex = view.state.doc.resolve(coords.pos).index(0);
              const rawMatches = this.matchesByBlock.get(blockIndex) ?? [];

              for (const raw of rawMatches) {
                const range = blockRangeInDoc(view.state.doc, blockIndex);

                if (!range) {
                  break;
                }

                const map = buildParagraphMapFromNode(range.node, range.from);
                const resolved = pmRangeForOffset(
                  map,
                  raw.match.offset,
                  raw.match.length
                );

                if (
                  resolved &&
                  coords.pos >= resolved.pmStart &&
                  coords.pos <= resolved.pmEnd
                ) {
                  const index = this.listIssues().findIndex(
                    (ref) =>
                      ref.blockIndex === blockIndex && ref.match === raw.match
                  );

                  if (index >= 0) {
                    event.preventDefault();
                    event.stopPropagation();
                    this.focusIssue(index);
                    return true;
                  }
                }
              }

              return false;
            },
          },
        },
        view: (editorView) => {
          // Underlines render through raw DOM decorations, so the stylesheet
          // is injected from here rather than from a scene.
          ensureBilingualStyles();
          this.syncAssistOverlay();

          if (this.enabled) {
            this.visibilityObserver = observeBlockVisibility(
              editorView,
              (indexes) => {
                for (const index of indexes) {
                  this.queue.add(index);
                }
                this.scheduleCheck();
              }
            );
          }

          return {
            update: (view, prevState) => {
              // Re-bind the visibility observer when blocks were added or
              // removed so newly mounted blocks are watched.
              if (
                this.visibilityObserver &&
                view.state.doc.childCount !== prevState.doc.childCount
              ) {
                this.visibilityObserver.sync();
              }
            },
            destroy: () => {
              if (this.checkTimer) {
                clearTimeout(this.checkTimer);
              }

              this.visibilityObserver?.disconnect();
              this.visibilityObserver = null;
              this.destroyAssistOverlay();
              this.prefsDisposer?.();
              this.prefsDisposer = null;
            },
          };
        },
      }),
    ];
  }

  /**
   * Schedules a recheck of blocks whose text changed between two states.
   *
   * @param oldState The state before the transactions.
   * @param newState The state after the transactions.
   */
  private scheduleRecheck(oldState: EditorState, newState: EditorState) {
    if (!this.enabled) {
      this.clearAllMatches();
      return;
    }

    const oldDoc = oldState.doc;
    const newDoc = newState.doc;
    const max = Math.max(oldDoc.childCount, newDoc.childCount);

    for (let i = 0; i < max; i++) {
      const oldText =
        i < oldDoc.childCount ? oldDoc.child(i).textContent : null;
      const newText =
        i < newDoc.childCount ? newDoc.child(i).textContent : null;

      if (oldText !== newText) {
        this.matchesByBlock.delete(i);
        this.sentHashByBlock.delete(i);
        this.queue.add(i);
      }
    }

    this.notifyIssueCount();
    this.scheduleCheck();
  }

  /**
   * Debounces the check queue flush.
   */
  private scheduleCheck() {
    if (!this.enabled) {
      return;
    }

    if (this.checkTimer) {
      clearTimeout(this.checkTimer);
    }

    this.checkTimer = setTimeout(() => {
      this.checkTimer = null;
      void this.flush();
    }, CHECK_DEBOUNCE_MS);
  }

  /**
   * Sends queued paragraphs as one batched request and applies the results.
   */
  private async flush() {
    const view = this.editor?.view;

    if (!view || !this.enabled) {
      return;
    }

    const doc = view.state.doc;
    const queued = [...this.queue].filter((index) => index < doc.childCount);
    this.queue.clear();
    const indexes = queued.slice(0, MAX_BLOCKS_PER_FLUSH);
    // Any remainder goes back in the queue; the next flush picks it up.
    queued
      .slice(MAX_BLOCKS_PER_FLUSH)
      .forEach((index) => this.queue.add(index));

    const batch: { index: number; text: string; hash: string }[] = [];

    for (const index of indexes) {
      const node = doc.child(index);

      if (
        (node.type.name !== "paragraph" && node.type.name !== "heading") ||
        node.textContent.trim().length < MIN_CHECK_LENGTH
      ) {
        this.matchesByBlock.delete(index);
        continue;
      }

      const hash = textHash(node.textContent);

      // Skip blocks already in flight with identical text.
      if (this.sentHashByBlock.get(index) === hash) {
        continue;
      }

      batch.push({ index, text: node.textContent, hash });
    }

    if (batch.length === 0) {
      this.notifyIssueCount();

      // The whole batch was skipped but a tail may remain queued.
      if (this.queue.size > 0) {
        this.scheduleCheck();
      }

      return;
    }

    const ignored = grammarIgnoredRules().join(",");
    const currentLevel = grammarLevel();

    runInAction(() => {
      this.checking = true;
    });

    let results: {
      id: string;
      available: boolean;
      reason?: string;
      matches?: unknown[];
    }[];

    try {
      results = await BilingualStore.grammarCheckBatch({
        items: batch.map((item) => ({
          id: String(item.index),
          text: item.text,
        })),
        language: this.options.language,
        level: currentLevel,
        mode: "all",
        disabledRules: ignored || undefined,
      });
    } catch (err) {
      runInAction(() => {
        this.checking = false;
        this.unavailable = true;
      });

      // Network failure (including batched requests failing at the HTTP
      // layer): surface the outage in the toolbar and schedule one delayed
      // retry, so underlines recover on their own once the service is back.
      Logger.warn("grammar check failed", {
        message: err instanceof Error ? err.message : String(err),
      });

      for (const item of batch) {
        this.queue.add(item.index);
      }

      if (!this.checkTimer) {
        this.checkTimer = setTimeout(() => {
          this.checkTimer = null;
          void this.flush();
        }, 20000);
      }
      return;
    }

    const currentDoc = this.editor?.view?.state.doc;

    if (!currentDoc) {
      return;
    }

    runInAction(() => {
      this.checking = false;
      this.unavailable = false;

      for (let i = 0; i < batch.length; i++) {
        const item = batch[i];
        const result = results[i];
        const node = currentDoc.child(item.index);

        if (!node || textHash(node.textContent) !== item.hash) {
          // Stale: the paragraph changed while the request was in flight.
          this.queue.add(item.index);
          this.scheduleCheck();
          continue;
        }

        this.sentHashByBlock.set(item.index, item.hash);

        if (!result || !result.available) {
          // Any "not available" outcome — including an open circuit breaker —
          // means the service is unreachable right now and must be surfaced
          // in the toolbar rather than silently dropping underlines.
          this.unavailable = true;
          this.matchesByBlock.delete(item.index);
          continue;
        }

        this.matchesByBlock.set(
          item.index,
          ((result.matches ?? []) as GrammarMatchDTO[])
            .filter(
              (match) =>
                match.offset >= 0 &&
                match.offset + match.length <= item.text.length &&
                !grammarIgnoredRules().includes(match.rule.id)
            )
            .map((match) => ({ match, textHash: item.hash }))
        );
      }

      this.notifyIssueCount();
    });

    this.refreshDecorations();

    // Large documents exceed one flush; keep draining the queue.
    if (this.queue.size > 0) {
      this.scheduleCheck();
    }
  }

  /**
   * Builds the decoration set from the stored matches against a document.
   *
   * @param doc The current document.
   * @returns The underline decorations for all stored matches.
   */
  private buildDecorationSet(doc: ProseMirrorNode): DecorationSet {
    if (this.matchesByBlock.size === 0) {
      return DecorationSet.empty;
    }

    const decorations: Decoration[] = [];
    const active =
      this.activeIssueIndex !== null
        ? this.listIssues()[this.activeIssueIndex]
        : null;

    for (const [index, rawMatches] of this.matchesByBlock) {
      if (index >= doc.childCount) {
        continue;
      }

      const range = blockRangeInDoc(doc, index);

      if (!range) {
        continue;
      }

      const map = buildParagraphMapFromNode(range.node, range.from);

      for (const raw of rawMatches) {
        const resolved = pmRangeForOffset(
          map,
          raw.match.offset,
          raw.match.length
        );

        if (!resolved) {
          continue;
        }

        const focused =
          !!active && active.blockIndex === index && active.match === raw.match;
        decorations.push(
          Decoration.inline(resolved.pmStart, resolved.pmEnd, {
            class: `bilingual-underline ${categoryClass(raw.match)}${
              focused ? " bilingual-grammar-focus" : ""
            }`,
          })
        );
      }
    }

    return DecorationSet.create(doc, decorations);
  }

  /**
   * Forces ProseMirror to re-evaluate the decorations prop. An empty
   * transaction carries no document change and is not undoable.
   */
  private refreshDecorations() {
    const activeView = this.editor?.view;

    if (activeView && !activeView.isDestroyed) {
      activeView.dispatch(
        activeView.state.tr.setMeta("bilingual-grammar-refresh", true)
      );
    }
  }

  /**
   * The text hash stored for a block, when known.
   *
   * @param blockIndex The block index.
   * @returns The hash, or undefined.
   */
  private textHashFor(blockIndex: number): string | undefined {
    return this.matchesByBlock.get(blockIndex)?.[0]?.textHash;
  }

  /**
   * Mounts or unmounts the floating badge and issue panel overlay so it
   * matches the current enabled state, and keeps the active-extension
   * registry in sync for UI that lives outside this editor.
   */
  private syncAssistOverlay() {
    const shouldMount = this.enabled && !!this.editor?.view;

    if (shouldMount && !this.assistOverlay) {
      setActiveGrammarExtension(this);
      this.assistOverlay = mountReactOverlay(depths.popover);
      this.assistOverlay.render(<GrammarAssist extension={this} />);
    } else if (!shouldMount && this.assistOverlay) {
      this.destroyAssistOverlay();
    }

    if (!shouldMount) {
      clearActiveGrammarExtension(this);
    }
  }

  /**
   * Unmounts the badge and panel overlay.
   */
  private destroyAssistOverlay() {
    clearActiveGrammarExtension(this);

    if (this.assistOverlay) {
      this.assistOverlay.destroy();
      this.assistOverlay = null;
    }
  }

  /**
   * Resolves the ProseMirror range of a stored match against the live
   * document.
   *
   * @param match The grammar match.
   * @param blockIndex The block index.
   * @param matchTextHash The hash of the block text at check time.
   * @returns The resolved range, or null when unmappable.
   */
  private resolveRange(
    match: GrammarMatchDTO,
    blockIndex: number,
    matchTextHash: string
  ) {
    const view = this.editor?.view;

    if (!view) {
      return null;
    }

    const range = blockRange(view, blockIndex);

    if (!range || textHash(range.node.textContent) !== matchTextHash) {
      return null;
    }

    const map = buildParagraphMapFromNode(range.node, range.from);
    return pmRangeForOffset(map, match.offset, match.length);
  }

  /**
   * Applies a replacement for a match as a normal transaction.
   *
   * @param match The grammar match.
   * @param blockIndex The block index.
   * @param matchTextHash The hash of the block text at check time.
   * @param value The replacement text.
   * @returns True when the fix was applied.
   */
  private applyFix(
    match: GrammarMatchDTO,
    blockIndex: number,
    matchTextHash: string,
    value: string
  ): boolean {
    const view = this.editor?.view;
    const resolved = this.resolveRange(match, blockIndex, matchTextHash);

    if (!view || !resolved || resolved.crossesGap) {
      return false;
    }

    const tr: Transaction = view.state.tr.replaceWith(
      resolved.pmStart,
      resolved.pmEnd,
      view.state.schema.text(value)
    );
    view.dispatch(tr);

    const remaining = (this.matchesByBlock.get(blockIndex) ?? []).filter(
      (raw) => raw.match !== match
    );
    this.matchesByBlock.set(blockIndex, remaining);
    this.notifyIssueCount();
    this.queue.add(blockIndex);
    this.scheduleCheck();
    return true;
  }

  /**
   * Removes all stored matches of a rule (after the user ignores it).
   *
   * @param ruleId The ignored rule id.
   */
  private removeMatchesByRule(ruleId: string) {
    for (const [index, rawMatches] of this.matchesByBlock) {
      const remaining = rawMatches.filter(
        (raw) => raw.match.rule.id !== ruleId
      );

      if (remaining.length !== rawMatches.length) {
        this.matchesByBlock.set(index, remaining);
      }
    }

    this.notifyIssueCount();
  }

  /**
   * Drops every stored match (used when checking is switched off) and
   * resets the review state.
   */
  private clearAllMatches() {
    if (this.matchesByBlock.size === 0 && this.queue.size === 0) {
      return;
    }

    this.matchesByBlock.clear();
    this.queue.clear();
    runInAction(() => {
      this.activeIssueIndex = null;
      this.fixedCount = 0;
    });
    this.notifyIssueCount();
    this.refreshDecorations();
  }

  /**
   * Notifies the host about the current issue count.
   */
  private notifyIssueCount() {
    let count = 0;

    for (const rawMatches of this.matchesByBlock.values()) {
      count += rawMatches.length;
    }

    runInAction(() => {
      this.issueCount = count;
      this.revision += 1;
    });
    this.options.onIssueCountChange?.(count);
  }
}
