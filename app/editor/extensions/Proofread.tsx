import { action, makeObservable, observable, reaction } from "mobx";
import * as React from "react";
import i18next from "i18next";
import { toast } from "sonner";
import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorState } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { EditorView } from "prosemirror-view";
import Extension from "@shared/editor/lib/Extension";
import { errToString } from "@shared/utils/error";
import type { ProofreadSuggestion } from "@shared/types/proofread";
import depths from "@shared/styles/depths";
import { ProofreadPanel } from "~/editor/components/ProofreadPanel";
import BilingualStore from "~/stores/BilingualStore";
import { client } from "~/utils/ApiClient";
import {
  clampPanelPosition,
  mountReactOverlay,
  type ReactOverlay,
} from "~/utils/bilingual/overlay";
import { findFragmentRange } from "~/utils/proofread/findFragment";

/** Options for the proofread extension. */
interface ProofreadOptions {
  /**
   * An additional live gate, e.g. "not the mirror pane", read at event time
   * so pane changes apply without remounting.
   */
  gate?: () => boolean;
}

/** Internal state of the open proofread panel. */
interface ProofreadPanelState {
  /** Absolute position just before the checked block node. */
  blockFrom: number;
  /** 1-based index of the block, for the panel title. */
  blockIndex: number;
  /** The text that was checked. */
  text: string;
  /** Whether the check is running, finished, or failed. */
  status: "loading" | "done" | "error";
  /** The validated suggestions. */
  suggestions: ProofreadSuggestion[];
  /** Error message when status is "error". */
  error?: string;
  /** Whether the workspace has no proofread model configured. */
  unconfigured?: boolean;
  /** How many suggestions were applied in this session. */
  appliedCount: number;
}

/** How long the applied-replacement highlight stays visible, in ms. */
const FLASH_MS = 600;

/** Decoration set holding the applied-replacement highlight. */
const flashKey = new PluginKey<DecorationSet>("proofread-flash");

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

/** Injects the flash style once per document. */
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
    @media (prefers-reduced-motion: reduce) {
      .proofread-flash { animation-duration: 1ms; }
    }
  `;
  document.head.appendChild(style);
}

/**
 * LLM grammar checking for one block, following the FluentRead-Go proofread
 * design: the selection toolbar (or the header button) checks the text at
 * the cursor, a floating panel lists validated suggestions with teaching
 * reasons, and accepting one replaces the fragment in the document.
 */
export default class ProofreadExtension extends Extension<ProofreadOptions> {
  /** The open panel state, or null when closed. */
  @observable
  panel: ProofreadPanelState | null = null;

  private overlay: ReactOverlay | null = null;
  private requestSeq = 0;
  private scrollRaf = 0;

  constructor(options: Partial<ProofreadOptions> = {}) {
    super(options);
    makeObservable(this);
    ensureProofreadStyles();
  }

  get name() {
    return "proofread";
  }

  get plugins() {
    return [
      flashPlugin,
      new Plugin({
        view: () => {
          // Both panes listen: the pane side is often unknown at mount time,
          // and only the extension whose gate passes answers the request.
          const disposer = reaction(
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

          return {
            update: (view, prevState) => {
              if (!this.panel) {
                return;
              }

              if (!prevState.doc.eq(view.state.doc)) {
                this.handleDocChanged(view);
              }
            },
            destroy: () => disposer(),
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
   * Starts a check for the block (or selection) at the current cursor.
   *
   * @param state The editor state to read the selection from.
   */
  @action
  private checkAtSelection(state: EditorState) {
    const { selection } = state;

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

    if (!block) {
      return;
    }

    // When the selection is non-empty and contained in this block, only the
    // selected text is checked; otherwise (cursor, whole-document selection,
    // selection spanning blocks) the whole block is checked.
    const selectionInside =
      !selection.empty &&
      selection.from >= blockFrom + 1 &&
      selection.to <= blockFrom + block.nodeSize - 1;

    let text: string;

    if (selectionInside) {
      text = state.doc.textBetween(selection.from, selection.to, "\n");
    } else {
      text = block.textContent;
    }

    text = text.trim();

    if (!text) {
      return;
    }

    void this.check(blockFrom, $pos.index(0) + 1, text);
  }

  /**
   * Runs the check request for one block and opens the panel.
   *
   * @param blockFrom The position before the checked block.
   * @param blockIndex The 1-based block index for the title.
   * @param text The text to check.
   */
  private async check(blockFrom: number, blockIndex: number, text: string) {
    const seq = ++this.requestSeq;

    this.panel = {
      blockFrom,
      blockIndex,
      text,
      status: "loading",
      suggestions: [],
      appliedCount: 0,
    };
    this.renderPanel();

    try {
      const res = await client.post("/proofread.check", {
        text,
      });
      const data = res.data as {
        suggestions: ProofreadSuggestion[];
        unconfigured?: boolean;
      };

      if (seq !== this.requestSeq || !this.panel) {
        return;
      }

      this.panel = {
        ...this.panel,
        status: "done",
        suggestions: data.suggestions ?? [],
        unconfigured: !!data.unconfigured,
      };
    } catch (err) {
      if (seq !== this.requestSeq || !this.panel) {
        return;
      }

      this.panel = {
        ...this.panel,
        status: "error",
        error: errToString(err),
      };
    }

    this.renderPanel();
  }

  /**
   * Applies one suggestion: replaces the first occurrence of the fragment in
   * the block, re-validates the remaining suggestions against the new text,
   * and closes the panel when nothing is left.
   *
   * @param suggestion The suggestion to apply.
   */
  @action
  applySuggestion = (suggestion: ProofreadSuggestion) => {
    const panel = this.panel;

    if (!panel) {
      return;
    }

    const view = this.editor.view;
    const block = view.state.doc.nodeAt(panel.blockFrom);

    if (!block) {
      this.close();
      return;
    }

    const range = findFragmentRange(block, panel.blockFrom, suggestion.original);

    if (!range) {
      this.dismiss(suggestion);
      return;
    }

    const marks = view.state.doc.resolve(range.from).marks();
    const tr = view.state.tr.replaceWith(
      range.from,
      range.to,
      view.state.schema.text(suggestion.suggestion, marks)
    );
    tr.setMeta(flashKey, {
      add: {
        from: range.from,
        to: range.from + suggestion.suggestion.length,
      },
    });
    view.dispatch(tr);

    window.setTimeout(() => {
      const current = this.editor.view;

      if (current && !current.isDestroyed) {
        current.dispatch(current.state.tr.setMeta(flashKey, { clear: true }));
      }
    }, FLASH_MS);

    const appliedCount = panel.appliedCount + 1;
    const newBlock = view.state.doc.nodeAt(panel.blockFrom);
    const remaining = panel.suggestions.filter(
      (entry) =>
        entry !== suggestion &&
        !!newBlock &&
        newBlock.textContent.includes(entry.original)
    );

    if (remaining.length === 0) {
      toast.success(
        i18next.t("Applied {{count}} suggestions", {
          count: appliedCount,
        })
      );
      this.close();
      return;
    }

    this.panel = {
      ...panel,
      suggestions: remaining,
      appliedCount,
    };
    this.renderPanel();
  };

  /** Dismisses one suggestion without changing the text. */
  @action
  dismiss = (suggestion: ProofreadSuggestion) => {
    const panel = this.panel;

    if (!panel) {
      return;
    }

    const remaining = panel.suggestions.filter(
      (entry) => entry !== suggestion
    );

    if (remaining.length === 0) {
      this.close();
      return;
    }

    this.panel = {
      ...panel,
      suggestions: remaining,
    };
    this.renderPanel();
  };

  /** Re-runs the check for the same block. */
  @action
  retry = () => {
    const panel = this.panel;

    if (!panel) {
      return;
    }

    void this.check(panel.blockFrom, panel.blockIndex, panel.text);
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
    this.detachScrollFollow();

    const view = this.editor?.view;

    if (view && !view.isDestroyed) {
      view.focus();
    }
  };

  /**
   * Reacts to document changes while the panel is open: the panel follows
   * its block, and suggestions that no longer match the block text are
   * dropped so a stale "accept" can never corrupt the document.
   *
   * @param view The editor view.
   */
  @action
  private handleDocChanged(view: EditorView) {
    const panel = this.panel;

    if (!panel) {
      return;
    }

    const block = view.state.doc.nodeAt(panel.blockFrom);

    if (!block) {
      this.close();
      return;
    }

    if (panel.status === "done" && panel.suggestions.length > 0) {
      const remaining = panel.suggestions.filter((entry) =>
        block.textContent.includes(entry.original)
      );

      if (remaining.length === 0) {
        this.close();
        return;
      }

      if (remaining.length !== panel.suggestions.length) {
        this.panel = {
          ...panel,
          suggestions: remaining,
        };
      }
    }

    this.positionPanel();
  }

  /** Renders (or re-renders) the floating panel overlay. */
  private renderPanel() {
    if (!this.panel) {
      this.destroyOverlay();
      return;
    }

    if (this.editor.view.isDestroyed) {
      return;
    }

    if (!this.overlay) {
      this.overlay = mountReactOverlay(depths.popover);
      this.attachScrollFollow();

      // Place the container immediately at the estimated spot so the panel
      // does not flash at the viewport origin before measurement.
      const anchor = this.blockRect();

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
        suggestions={panel.suggestions}
        error={panel.error}
        unconfigured={panel.unconfigured}
        blockIndex={panel.blockIndex}
        onAccept={this.applySuggestion}
        onIgnore={this.dismiss}
        onRetry={this.retry}
        onClose={this.close}
      />
    );

    // Position once the panel has a measurable size.
    window.requestAnimationFrame(() => this.positionPanel());
  }

  /** Positions the overlay against the current block rect. */
  private positionPanel() {
    if (!this.overlay || !this.panel) {
      return;
    }

    const anchor = this.blockRect();

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
   * The viewport rect of the checked block's DOM node.
   *
   * @returns The rect, or null when the block is gone.
   */
  private blockRect(): DOMRect | null {
    const panel = this.panel;
    const view = this.editor?.view;

    if (!panel || !view || view.isDestroyed) {
      return null;
    }

    try {
      const dom = view.nodeDOM(panel.blockFrom);

      if (!(dom instanceof HTMLElement)) {
        return null;
      }

      return dom.getBoundingClientRect();
    } catch (_err) {
      return null;
    }
  }

  /** Keeps the panel pinned to its block while scrolling. */
  private attachScrollFollow() {
    document.addEventListener("scroll", this.handleScroll, {
      capture: true,
      passive: true,
    });
  }

  private detachScrollFollow() {
    document.removeEventListener("scroll", this.handleScroll, {
      capture: true,
    });
  }

  private handleScroll = () => {
    if (!this.overlay || !this.panel || this.scrollRaf) {
      return;
    }

    this.scrollRaf = window.requestAnimationFrame(() => {
      this.scrollRaf = 0;
      this.positionPanel();
    });
  };

  private destroyOverlay() {
    this.overlay?.destroy();
    this.overlay = null;
  }
}
