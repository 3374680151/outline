import { observable, runInAction } from "mobx";
import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorState, Transaction } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
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
import { ensureBilingualStyles } from "~/utils/bilingual/styles";

/**
 * Options for the grammar check extension.
 */
interface GrammarCheckOptions {
  /** Whether checking is enabled for this editor. */
  enabled: boolean;
  /** Rule level, "default" or "picky". */
  level: "default" | "picky";
  /** Language long code, e.g. en-US. */
  language: string;
  /** Notified when the total issue count changes. */
  onIssueCountChange?: (count: number) => void;
}

/** A stored raw match relative to its paragraph text. */
interface RawMatch {
  match: GrammarMatchDTO;
  /** Hash of the paragraph text at check time. */
  textHash: string;
}

/** Debounce for grammar checks after typing, in milliseconds. */
const CHECK_DEBOUNCE_MS = 700;

/** Minimum text length before a block is checked. */
const MIN_CHECK_LENGTH = 8;

/** Maximum blocks checked in one flush. */
const MAX_BLOCKS_PER_FLUSH = 40;

/** localStorage key holding ignored rule ids. */
const IGNORED_RULES_KEY = "bilingual-grammar-ignored-rules";

/** Visual class per LanguageTool category. */
function categoryClass(match: GrammarMatchDTO): string {
  const category = match.rule.category.id.toUpperCase();

  if (category === "TYPO") {
    return "bilingual-grammar-typo";
  }

  if (category === "GRAMMAR") {
    return "bilingual-grammar-grammar";
  }

  return "bilingual-grammar-style";
}

/**
 * Grammar check extension: extracts paragraph text, proxies it through the
 * Outline grammar API (LanguageTool), and renders underline decorations plus
 * clickable sentence issue dots. One-click fixes are ordinary transactions
 * so they participate in undo.
 */
export default class GrammarCheckExtension extends Extension<GrammarCheckOptions> {
  /** Total open issue count across the document. */
  @observable
  issueCount = 0;

  /** Whether the grammar service is currently unavailable. */
  @observable
  unavailable = false;

  private key = new PluginKey<DecorationSet>("bilingual-grammar");
  private matchesByBlock = new Map<number, RawMatch[]>();
  private sentHashByBlock = new Map<number, string>();
  private queue = new Set<number>();
  private checkTimer: ReturnType<typeof setTimeout> | null = null;
  private tooltipOverlay: ReturnType<typeof mountReactOverlay> | null = null;

  get defaultOptions(): GrammarCheckOptions {
    return { enabled: false, level: "default", language: "en-US" };
  }

  get name() {
    return "bilingual-grammar-check";
  }

  get allowInReadOnly() {
    return false;
  }

  /**
   * The rule ids the user has chosen to ignore.
   *
   * @returns The ignored rule ids.
   */
  static ignoredRules(): string[] {
    try {
      const raw = localStorage.getItem(IGNORED_RULES_KEY);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  }

  /**
   * Persists an ignored rule id.
   *
   * @param ruleId The rule id to ignore.
   * @returns The updated ignored rule ids.
   */
  static addIgnoredRule(ruleId: string): string[] {
    const rules = [...new Set([...GrammarCheckExtension.ignoredRules(), ruleId])];
    localStorage.setItem(IGNORED_RULES_KEY, JSON.stringify(rules));
    return rules;
  }

  get plugins() {
    if (!this.options.enabled) {
      return [];
    }

    return [
      new Plugin<DecorationSet>({
        key: this.key,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, value, oldState, newState) => {
            if (tr.docChanged) {
              this.scheduleRecheck(oldState, newState);
            }

            return value;
          },
        },
        props: {
          decorations: (state: EditorState) =>
            this.buildDecorationSet(state.doc),
        },
        view: (editorView) => {
          // Underlines and issue dots render through raw DOM decorations, so
          // the stylesheet is injected from here rather than from a scene.
          ensureBilingualStyles();

          // Check the initial document content.
          for (let i = 0; i < editorView.state.doc.childCount; i++) {
            this.queue.add(i);
          }
          void this.flush();

          return {
            destroy: () => {
              if (this.checkTimer) {
                clearTimeout(this.checkTimer);
              }

              this.closeTooltip();
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
    if (this.checkTimer) {
      clearTimeout(this.checkTimer);
    }

    this.checkTimer = setTimeout(() => {
      this.checkTimer = null;
      void this.flush();
    }, CHECK_DEBOUNCE_MS);
  }

  /**
   * Sends queued paragraphs to the grammar proxy and applies the results.
   */
  private async flush() {
    const view = this.editor?.view;

    if (!view) {
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

    const ignored = GrammarCheckExtension.ignoredRules().join(",");

    let results: {
      item: { index: number; text: string; hash: string };
      result: { available: boolean; reason?: string; matches?: unknown[] };
    }[];

    try {
      results = await Promise.all(
        batch.map(async (item) => {
          const result = await BilingualStore.grammarCheck({
            text: item.text,
            language: this.options.language,
            level: this.options.level,
            mode: "all",
            disabledRules: ignored || undefined,
          });
          return { item, result };
        })
      );
    } catch (err) {
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
      this.unavailable = false;

      for (const { item, result } of results) {
        const node = currentDoc.child(item.index);

        if (!node || textHash(node.textContent) !== item.hash) {
          // Stale: the paragraph changed while the request was in flight.
          this.queue.add(item.index);
          this.scheduleCheck();
          continue;
        }

        this.sentHashByBlock.set(item.index, item.hash);

        if (!result.available) {
          this.unavailable = true;
          this.matchesByBlock.delete(item.index);
          continue;
        }

        this.matchesByBlock.set(
          item.index,
          (result.matches as GrammarMatchDTO[])
            .filter(
              (match) =>
                match.offset >= 0 &&
                match.offset + match.length <= item.text.length &&
                !GrammarCheckExtension.ignoredRules().includes(match.rule.id)
            )
            .map((match) => ({ match, textHash: item.hash }))
        );
      }

      this.notifyIssueCount();
    });

    // Large documents exceed one flush; keep draining the queue.
    if (this.queue.size > 0) {
      this.scheduleCheck();
    }
  }

  /**
   * Builds the decoration set from the stored matches against a document.
   *
   * @param doc The current document.
   * @returns The decorations for all stored matches.
   */
  private buildDecorationSet(doc: ProseMirrorNode): DecorationSet {
    if (this.matchesByBlock.size === 0) {
      return DecorationSet.empty;
    }

    const decorations: Decoration[] = [];
    const widgetDecorations: Decoration[] = [];

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

      const dotsClass = "bilingual-issue-dots";
      const matches = rawMatches;

      widgetDecorations.push(
        Decoration.widget(range.to, () => {
          const container = document.createElement("span");
          container.className = dotsClass;

          matches.slice(0, 8).forEach((raw) => {
            const dot = document.createElement("button");
            dot.type = "button";
            dot.className = `bilingual-issue-dot ${categoryClass(raw.match)}`;
            dot.setAttribute("aria-label", raw.match.message);
            dot.setAttribute("title", raw.match.shortMessage ?? raw.match.message);
            dot.addEventListener("mousedown", (event) => {
              event.preventDefault();
              event.stopPropagation();
              this.openTooltip(raw.match, index, raw.textHash);
            });
            container.appendChild(dot);
          });

          return container;
        }, { key: `issues-${index}-${rawMatches[0]?.textHash ?? ""}`, side: 1 })
      );
    }

    return DecorationSet.create(doc, [...decorations, ...widgetDecorations]);
  }

  /**
   * Opens the issue tooltip for a match.
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

    const anchor = view.coordsAtPos(resolved.pmStart);
    const overlay = mountReactOverlay(depths.tooltip);
    this.tooltipOverlay = overlay;

    const handleClose = () => this.closeTooltip();

    const handleIgnore = () => {
      GrammarCheckExtension.addIgnoredRule(match.rule.id);
      this.removeMatchesByRule(match.rule.id);
      handleClose();
    };

    overlay.render(
      <GrammarTooltip
        match={match}
        canFix={!resolved.crossesGap}
        replacements={match.replacements.map((replacement) => replacement.value)}
        onFix={(value) => {
          const applied = this.applyFix(match, blockIndex, matchTextHash, value);

          if (applied) {
            handleClose();
          }
        }}
        onIgnore={handleIgnore}
        onClose={handleClose}
      />
    );

    const position = clampPanelPosition(
      { left: anchor.left, right: anchor.right, top: anchor.top, bottom: anchor.bottom },
      { width: 320, height: 180 }
    );
    overlay.container.style.left = `${position.left}px`;
    overlay.container.style.top = `${position.top}px`;
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
  private closeTooltip() {
    if (this.tooltipOverlay) {
      this.tooltipOverlay.destroy();
      this.tooltipOverlay = null;
    }
  }
}
