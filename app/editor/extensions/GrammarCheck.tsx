import { makeObservable, observable, reaction, runInAction } from "mobx";
import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorState, Transaction } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { EditorView } from "prosemirror-view";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import Extension from "@shared/editor/lib/Extension";
import depths from "@shared/styles/depths";
import type { GrammarMatchDTO } from "@shared/types/bilingual";
import BilingualStore from "~/stores/BilingualStore";
import GrammarTooltip from "~/editor/components/GrammarTooltip";
import Logger from "~/utils/Logger";
import { blockRange, blockRangeInDoc } from "~/utils/bilingual/editorBlocks";
import { textHash } from "~/utils/bilingual/hash";
import { pmRangeForOffset } from "~/utils/bilingual/offsetTable";
import {
  clampPanelPosition,
  mountReactOverlay,
} from "~/utils/bilingual/overlay";
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

/** An ordered issue reference used by the panel and prev/next navigation. */
export interface GrammarIssueRef {
  blockIndex: number;
  match: GrammarMatchDTO;
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
 * Outline grammar API (LanguageTool), and renders click-to-open underline
 * decorations. Only visible blocks are checked on mount; typing re-checks
 * changed paragraphs after a debounce. One-click fixes are ordinary
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
          return;
        }

        this.matchesByBlock.clear();
        this.sentHashByBlock.clear();
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
    );
  }

  private matchesByBlock = new Map<number, RawMatch[]>();
  private sentHashByBlock = new Map<number, string>();
  private queue = new Set<number>();
  private checkTimer: ReturnType<typeof setTimeout> | null = null;
  private tooltipOverlay: ReturnType<typeof mountReactOverlay> | null = null;
  private tooltipAnchor: {
    match: GrammarMatchDTO;
    blockIndex: number;
    textHash: string;
  } | null = null;
  private repositionRaf = 0;
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
        issues.push({ blockIndex: index, match: raw.match });
      }
    }

    return issues;
  }

  /**
   * Scrolls an issue into view and opens its card.
   *
   * @param issue The issue to reveal.
   */
  revealIssue(issue: GrammarIssueRef) {
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

    const hash =
      this.textHashFor(issue.blockIndex) ?? textHash(range.node.textContent);
    this.openTooltip(issue.match, issue.blockIndex, hash);
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
              // Typing immediately leaves review mode: the card would
              // otherwise drift away from the text it describes.
              this.closeTooltip();
              this.scheduleRecheck(oldState, newState);
            }

            return value;
          },
        },
        props: {
          decorations: (state: EditorState) =>
            this.enabled ? this.buildDecorationSet(state.doc) : DecorationSet.empty,
          handleDOMEvents: {
            // Clicking an underline opens its issue card.
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
                  event.preventDefault();
                  event.stopPropagation();
                  this.openTooltip(raw.match, blockIndex, raw.textHash);
                  return true;
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

          if (this.enabled) {
            this.visibilityObserver = observeBlockVisibility(
              editorView,
              (indexes) => {
                for (const index of indexes) {
                  this.queue.add(index);
                }
                this.scheduleCheck();
              },
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
              this.closeTooltip();
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
      const oldText = i < oldDoc.childCount ? oldDoc.child(i).textContent : null;
      const newText = i < newDoc.childCount ? newDoc.child(i).textContent : null;

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
    queued.slice(MAX_BLOCKS_PER_FLUSH).forEach((index) => this.queue.add(index));

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
        items: batch.map((item) => ({ id: String(item.index), text: item.text })),
        language: this.options.language,
        level: currentLevel,
        mode: "all",
        disabledRules: ignored || undefined,
      });
    } catch (err) {
      runInAction(() => {
        this.checking = false;
      });

      // Network failure: drop this round quietly; the next edit re-queues
      // the blocks and the server-side breaker protects the sidecar.
      Logger.warn("grammar check failed", {
        message: err instanceof Error ? err.message : String(err),
      });
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
          if (result?.reason && result.reason !== "circuit-open") {
            this.unavailable = true;
          }
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
        const resolved = pmRangeForOffset(map, raw.match.offset, raw.match.length);

        if (!resolved) {
          continue;
        }

        decorations.push(
          Decoration.inline(resolved.pmStart, resolved.pmEnd, {
            class: `bilingual-underline ${categoryClass(raw.match)}`,
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
   * Opens the issue card for a match, anchored to the match inside the
   * editor and repositioned as the surrounding pane scrolls.
   *
   * @param match The grammar match.
   * @param blockIndex The block the match belongs to.
   * @param matchTextHash Hash of the block text at check time.
   */
  private openTooltip(match: GrammarMatchDTO, blockIndex: number, matchTextHash: string) {
    const view = this.editor?.view;
    const resolved = this.resolveRange(match, blockIndex, matchTextHash);

    if (!view || !resolved) {
      return;
    }

    this.closeTooltip();

    const overlay = mountReactOverlay(depths.tooltip);
    this.tooltipOverlay = overlay;
    this.tooltipAnchor = { match, blockIndex, textHash: matchTextHash };

    const issues = this.listIssues();
    const position = issues.findIndex(
      (issue) => issue.blockIndex === blockIndex && issue.match === match
    );

    const handleClose = () => this.closeTooltip();

    const handleSkip = () => {
      this.skipIssue({ blockIndex, match });
      handleClose();
    };

    const handleIgnore = () => {
      addGrammarIgnoredRule(match.rule.id);
      this.removeMatchesByRule(match.rule.id);
      this.refreshDecorations();
      handleClose();
    };

    const handleFix = (value: string) => {
      const applied = this.applyFix(match, blockIndex, matchTextHash, value);

      if (applied) {
        // Auto-advance to the next open issue, mirroring the review flow of
        // LanguageTool's fix card.
        const next = issues[position + 1];

        if (next) {
          // Let the fix transaction render before moving the card.
          setTimeout(() => this.revealIssue(next), 0);
        } else {
          handleClose();
        }
      }
    };

    overlay.render(
      <GrammarTooltip
        match={match}
        canFix={!resolved.crossesGap}
        replacements={match.replacements.map((replacement) => replacement.value)}
        positionLabel={
          position >= 0 ? `${position + 1}/${issues.length}` : undefined
        }
        onFix={handleFix}
        onSkip={handleSkip}
        onIgnore={handleIgnore}
        onClose={handleClose}
      />
    );

    this.positionTooltip(view, resolved.pmStart);
    this.listenForReposition();
  }

  /**
   * Positions the open card against an editor position.
   *
   * @param view The editor view.
   * @param pos The position to anchor to.
   */
  private positionTooltip(view: EditorView, pos: number) {
    if (!this.tooltipOverlay) {
      return;
    }

    let anchor;

    try {
      anchor = view.coordsAtPos(pos);
    } catch (_err) {
      // The position can be invalid while the document is changing.
      return;
    }

    const position = clampPanelPosition(
      {
        left: anchor.left,
        right: anchor.right,
        top: anchor.top,
        bottom: anchor.bottom,
      },
      { width: 360, height: 200 }
    );
    this.tooltipOverlay.container.style.left = `${position.left}px`;
    this.tooltipOverlay.container.style.top = `${position.top}px`;
  }

  /**
   * Keeps the open card glued to its anchor while any scroll container or
   * the window changes size. Frames are merged with a rAF.
   */
  private listenForReposition() {
    const reposition = () => {
      if (this.repositionRaf) {
        return;
      }

      this.repositionRaf = window.requestAnimationFrame(() => {
        this.repositionRaf = 0;
        const view = this.editor?.view;
        const anchor = this.tooltipAnchor;

        if (!view || !anchor || view.isDestroyed) {
          return;
        }

        const resolved = this.resolveRange(
          anchor.match,
          anchor.blockIndex,
          anchor.textHash
        );

        if (!resolved) {
          // The text the card described is gone; close rather than drift.
          this.closeTooltip();
          return;
        }

        this.positionTooltip(view, resolved.pmStart);
      });
    };

    window.addEventListener("scroll", reposition, { capture: true, passive: true });
    window.addEventListener("resize", reposition);

    const detach = () => {
      window.removeEventListener("scroll", reposition, { capture: true });
      window.removeEventListener("resize", reposition);
    };

    // The overlay destroy callback runs after unmount; piggyback the
    // listener teardown on the overlay handle.
    const originalDestroy = this.tooltipOverlay?.destroy.bind(this.tooltipOverlay);

    if (this.tooltipOverlay && originalDestroy) {
      this.tooltipOverlay.destroy = () => {
        detach();
        originalDestroy();
      };
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
   * Drops every stored match (used when checking is switched off).
   */
  private clearAllMatches() {
    if (this.matchesByBlock.size === 0 && this.queue.size === 0) {
      return;
    }

    this.matchesByBlock.clear();
    this.queue.clear();
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
    });
    this.options.onIssueCountChange?.(count);
  }

  /**
   * Closes and unmounts the tooltip overlay.
   */
  closeTooltip() {
    if (this.repositionRaf) {
      window.cancelAnimationFrame(this.repositionRaf);
      this.repositionRaf = 0;
    }

    if (this.tooltipOverlay) {
      this.tooltipAnchor = null;
      this.tooltipOverlay.destroy();
      this.tooltipOverlay = null;
    }
  }
}
