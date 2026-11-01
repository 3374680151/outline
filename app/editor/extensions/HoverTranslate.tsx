import { action, observable } from "mobx";
import i18next from "i18next";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Plugin, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import styled from "styled-components";
import Extension from "@shared/editor/lib/Extension";
import type { WordLookupDTO } from "@shared/types/bilingual";
import { s } from "@shared/styles";
import depths from "@shared/styles/depths";
import TranslatePopover, {
  type TranslatePopoverProps,
} from "~/editor/components/TranslatePopover";
import BilingualStore from "~/stores/BilingualStore";
import {
  editorPaneRect,
  mountReactOverlay,
  type ReactOverlay,
  VIEWPORT_INSET,
} from "~/utils/bilingual/overlay";
import {
  normalizeEnglishWord,
  sentenceAtOffset,
  wordAtOffset,
} from "~/utils/bilingual/wordNormalize";
import { translationTrigger } from "~/utils/bilingual/prefs";
import { reaction } from "mobx";

/**
 * Options for the hover translate extension.
 */
interface HoverTranslateOptions {
  /** When the translate dot should appear. */
  mode: "off" | "dot" | "hover";
  /** Called to write a translation into the mirror document block. */
  onInsertText?: (blockIndex: number, text: string) => void;
  /**
   * An additional live gate, e.g. "not the mirror pane", read at event time
   * so pane changes apply without remounting.
   */
  gate?: () => boolean;
}

/** Anchor rect of the dot, in viewport coordinates. */
interface DotAnchor {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Presentation delay after the selection settles, in milliseconds. */
const SELECTION_DELAY_MS = 120;

/**
 * Window during which a selection change right after a press on the dot is
 * ignored, in milliseconds. Some browsers still clear the selection on a
 * press over body-level UI despite a prevented default; without the guard
 * the dot would be removed before its own click fires.
 */
const DOT_PRESS_GUARD_MS = 250;

/** Delay before a hovered word shows the dot, in milliseconds. */
const HOVER_DELAY_MS = 500;

/** Delay before a hidden dot after the pointer leaves a word. */
const HOVER_HIDE_DELAY_MS = 300;

/**
 * Floating translate affordance ported from the FluentRead selection
 * translator: a small dot appears next to the selection (or the hovered
 * word) and opens a translation popover on click.
 *
 * The dot renders through an extension-owned body overlay rather than the
 * editor widget system, so its visibility never depends on React render
 * timing inside the editor.
 */
export default class HoverTranslateExtension extends Extension<HoverTranslateOptions> {
  /** The floating dot state, or null when hidden. */
  @observable
  dot: {
    left: number;
    top: number;
    anchor: DotAnchor;
    text: string;
    blockIndex: number;
    isWord: boolean;
    sentence?: string;
  } | null = null;

  private hoverTimer: ReturnType<typeof setTimeout> | null = null;
  private selectionTimer: ReturnType<typeof setTimeout> | null = null;
  private dotOverlay: ReactOverlay | null = null;
  private toolbarRequestDisposer: (() => void) | null = null;
  private peekOverlay: ReactOverlay | null = null;
  private popoverOverlay: ReactOverlay | null = null;
  private rafHandle = 0;
  private lastMouseEvent: MouseEvent | null = null;
  private dotPointerDownAt = 0;

  get defaultOptions(): HoverTranslateOptions {
    return { mode: "dot" };
  }

  get name() {
    return "hover-translate";
  }

  get allowInReadOnly() {
    return true;
  }

  /**
   * The trigger mode, read live from the user's preferences so toggling it
   * takes effect without remounting the editor.
   *
   * @returns The configured trigger mode.
   */
  private get mode(): "off" | "dot" | "hover" {
    if (this.options.gate?.() === false) {
      return "off";
    }

    return translationTrigger();
  }

  get plugins() {
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            mousemove: action((view: EditorView, event: MouseEvent) => {
              if (this.mode !== "hover") {
                return false;
              }

              this.lastMouseEvent = event;

              if (!this.rafHandle) {
                this.rafHandle = window.requestAnimationFrame(() => {
                  this.rafHandle = 0;
                  const mouseEvent = this.lastMouseEvent;

                  if (mouseEvent) {
                    this.handleHover(view, mouseEvent);
                  }
                });
              }

              return false;
            }),
            mouseleave: action(() => {
              this.scheduleHoverHide();
              return false;
            }),
          },
        },
        view: () => {
          const handleScroll = action(() => {
            // The anchor is frozen once shown; hide on scroll rather than
            // risk pointing at the wrong text. Capture phase is required:
            // the scrolling container is an ancestor of the editor, and
            // scroll events do not bubble.
            this.hideDot();
          });

          document.addEventListener("scroll", handleScroll, {
            capture: true,
            passive: true,
          });

          // Both panes listen: the pane side is often unknown at mount
          // time, and only the editor actually holding the user's selection
          // opens the card. The toolbar entry must work regardless of the
          // trigger preference, so the explicit request bypasses it while
          // the pane gate still applies inside the state builder.
          this.toolbarRequestDisposer = reaction(
            () => BilingualStore.translateSelectionRequest,
            () => {
              if (this.openForCurrentSelection(true)) {
                BilingualStore.markTranslateSelectionHandled();
              }
            },
            { fireImmediately: false }
          );

          return {
            update: (view, prevState) => {
              if (!view.state.selection.eq(prevState.selection)) {
                // A press on the dot can briefly clear the selection before
                // the click fires; ignore that window so the dot is not
                // removed under the cursor.
                if (Date.now() - this.dotPointerDownAt < DOT_PRESS_GUARD_MS) {
                  return;
                }

                this.hideDot();

                if (this.selectionTimer) {
                  clearTimeout(this.selectionTimer);
                }

                this.selectionTimer = setTimeout(() => {
                  this.selectionTimer = null;
                  this.showForSelection(view);
                }, SELECTION_DELAY_MS);
              }
            },
            destroy: () => {
              document.removeEventListener("scroll", handleScroll, {
                capture: true,
              });
              this.removeDot();
              this.removePeek();
              this.closePopover();
              this.toolbarRequestDisposer?.();
              this.toolbarRequestDisposer = null;
              if (this.hoverTimer) {
                clearTimeout(this.hoverTimer);
              }

              if (this.selectionTimer) {
                clearTimeout(this.selectionTimer);
              }
            },
          };
        },
      }),
    ];
  }

  /**
   * Shows the dot for the current selection after it settles.
   *
   * @param view The editor view.
   */
  showForSelection = action((view: EditorView) => {
    const state = this.buildSelectionState(view);

    if (!state) {
      this.hideDot();
      return;
    }

    this.dot = state;
    this.renderDot();

    // FluentRead "direct mode": in hover-triggered flows the word card opens
    // immediately. With the (default) dot trigger the card waits for an
    // explicit click so nothing appears without a user action.
    if (state.isWord && this.mode === "hover" && this.editor) {
      this.openPopover(this.editor.props.id as string);
    }
  });

  /**
   * Opens the translation card for the editor's current selection, however
   * the selection was made. Used by the bilingual toolbar as an
   * always-reachable entry that does not depend on the floating trigger.
   *
   * @param explicit Whether the request comes from an explicit affordance
   * such as the toolbar button; explicit requests ignore the trigger
   * preference while still respecting the pane gate.
   * @returns True when a card was opened.
   */
  openForCurrentSelection = action((explicit = false): boolean => {
    const view = this.editor?.view;
    const state = view ? this.buildSelectionState(view, { explicit }) : null;

    if (!state || !this.editor) {
      return false;
    }

    this.dot = state;
    this.openPopover(this.editor.props.id as string);
    return true;
  });

  /**
   * Builds the translation state (text, anchor, block index) for the
   * editor's current selection, or null when the selection cannot be
   * translated (empty, whitespace, gated off).
   *
   * @param view The editor view.
   * @param options Explicit requests bypass the trigger preference.
   * @returns The state for the floating trigger and card, or null.
   */
  private buildSelectionState(
    view: EditorView,
    options?: { explicit?: boolean }
  ) {
    const { selection } = view.state;

    if (selection.empty) {
      return null;
    }

    // The pane gate always applies (the mirror pane never translates), but
    // an explicit request from the toolbar ignores the trigger preference.
    if (this.options.gate?.() === false) {
      return null;
    }

    if (!options?.explicit && this.mode === "off") {
      return null;
    }

    const anchor = view.coordsAtPos(selection.to);
    const text = view.state.doc.textBetween(selection.from, selection.to, " ");

    if (!text.trim()) {
      return null;
    }

    // A single-word selection behaves like the hovered-word flow: the card
    // with meaning and sentence grammar opens directly. Longer selections
    // keep the click-to-translate dot.
    const isWord =
      !!normalizeEnglishWord(text) && text.trim().split(/\s+/).length === 1;
    const parentText = selection.$from.parent.textContent;
    const sentence = isWord
      ? sentenceAtOffset(parentText, selection.$from.parentOffset)
      : undefined;

    return {
      // FluentRead-style placement: just below the right edge of the
      // selection's last line.
      left: anchor.right + 10,
      top: anchor.bottom + 6,
      anchor,
      text,
      blockIndex: selection.$from.index(0),
      isWord,
      sentence,
    };
  }

  /**
   * Handles pointer hover for the word translation mode.
   *
   * @param view The editor view.
   * @param event The mouse event.
   */
  private handleHover = (view: EditorView, event: MouseEvent) => {
    const { selection } = view.state;

    if (!selection.empty || !(event.target instanceof HTMLElement)) {
      return;
    }

    if (!view.dom.contains(event.target)) {
      return;
    }

    const result = view.posAtCoords({
      left: event.clientX,
      top: event.clientY,
    });

    if (!result) {
      return;
    }

    const $pos = view.state.doc.resolve(result.pos);

    if (!$pos.parent.isTextblock) {
      return;
    }

    const word = wordAtOffset($pos.parent.textContent, $pos.parentOffset);

    if (!word) {
      this.scheduleHoverHide();
      return;
    }

    if (this.dot?.isWord && this.dot.text === word) {
      return;
    }

    if (this.hoverTimer) {
      clearTimeout(this.hoverTimer);
    }

    this.hoverTimer = setTimeout(
      action(() => {
        this.hoverTimer = null;
        const anchor = view.coordsAtPos(result.pos);

        this.dot = {
          left: anchor.right + 10,
          top: anchor.bottom + 6,
          anchor,
          text: word,
          blockIndex: $pos.index(0),
          isWord: true,
          sentence: sentenceAtOffset(
            $pos.parent.textContent,
            $pos.parentOffset
          ),
        };

        // FluentRead-style peek: hovering shows a lightweight preview card
        // (word, phonetic, first sense); clicking it expands the full card.
        this.showPeek();
      }),
      HOVER_DELAY_MS
    );
  };

  /**
   * Schedules hiding the hovered dot shortly after the pointer leaves a word.
   */
  private scheduleHoverHide = action(() => {
    if (this.hoverTimer) {
      clearTimeout(this.hoverTimer);
    }

    this.hoverTimer = setTimeout(
      action(() => {
        this.hoverTimer = null;
        this.hideDot();
      }),
      HOVER_HIDE_DELAY_MS
    );
  });

  /**
   * Cancels a scheduled hover hide, used when the pointer reaches the peek
   * card so the card does not disappear before it can be clicked.
   */
  private cancelHoverHide = action(() => {
    if (this.hoverTimer) {
      clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
  });

  /**
   * Hides the floating dot.
   */
  hideDot = action(() => {
    this.dot = null;
    this.removeDot();
    this.removePeek();
  });

  /**
   * Renders (or re-renders) the floating dot overlay.
   */
  private renderDot() {
    const dot = this.dot;

    if (!dot || !this.editor) {
      return;
    }

    this.removeDot();

    const documentId = this.editor.props.id as string;
    const { left, top } = clampDot(dot.left, dot.top, this.editor?.view);
    this.dotOverlay = mountReactOverlay(depths.popover);
    this.dotOverlay.render(
      <DotButton
        $left={left}
        $top={top}
        aria-label={i18next.t("Translate")}
        // Preventing the default keeps the browser from clearing the text
        // selection on press, which would destroy this very overlay through
        // the selection-change listener before the click can fire.
        onMouseDown={(event) => {
          event.preventDefault();
          this.dotPointerDownAt = Date.now();
        }}
        // Reaching the dot crosses whitespace, which schedules a hover hide;
        // arriving on the dot itself cancels it so the button stays put long
        // enough to be clicked.
        onMouseEnter={() => this.cancelHoverHide()}
        onClick={() => this.openPopover(documentId)}
      >
        译
      </DotButton>
    );
  }

  /**
   * Removes the floating dot overlay.
   */
  private removeDot() {
    if (this.dotOverlay) {
      this.dotOverlay.destroy();
      this.dotOverlay = null;
    }
  }

  /**
   * Shows the lightweight word preview card near the hovered word.
   */
  showPeek = action(() => {
    const dot = this.dot;
    const view = this.editor?.view;

    if (!dot || !view) {
      return;
    }

    this.removePeek();

    const { left, top } = clampDot(dot.left, dot.top, view);
    this.peekOverlay = mountReactOverlay(depths.popover);
    this.peekOverlay.render(
      <WordPeekCard
        word={dot.text}
        left={left}
        top={top}
        onExpand={() => this.openPopover(this.editor?.props.id as string)}
        onEnter={() => this.cancelHoverHide()}
      />
    );
  });

  /**
   * Removes the word preview card overlay.
   */
  removePeek() {
    if (this.peekOverlay) {
      this.peekOverlay.destroy();
      this.peekOverlay = null;
    }
  }

  /**
   * Opens the translation popover for the current dot.
   *
   * @param documentId The document the text belongs to.
   */
  openPopover = (documentId: string) => {
    const dot = this.dot;

    if (!dot) {
      return;
    }

    this.removeDot();
    this.removePeek();
    this.closePopover();

    // Collapse the editor selection so the markdown formatting toolbar
    // disappears: with the card open it would be two competing floating
    // toolbars over the same text. The card carries the original text, and
    // the mirror block index is already captured.
    const view = this.editor?.view;

    if (view && !view.state.selection.empty) {
      const to = view.state.selection.to;
      view.dispatch(
        view.state.tr
          .setSelection(TextSelection.create(view.state.doc, to))
          .setMeta("bilingual-translate-open", true)
      );
      view.focus();
    }

    const props: TranslatePopoverProps = {
      text: dot.text,
      isWord: dot.isWord,
      blockIndex: dot.blockIndex,
      documentId,
      anchor: dot.anchor,
      ...(this.editor?.view
        ? { paneBounds: editorPaneRect(this.editor.view) ?? undefined }
        : {}),
      sentence: dot.sentence,
      onInsertText: this.options.onInsertText,
      onClose: action(() => this.closePopover()),
    };

    this.popoverOverlay = mountReactOverlay(depths.popover);
    this.popoverOverlay.render(<TranslatePopover {...props} />);
  };

  /**
   * Closes and unmounts the translation popover.
   */
  closePopover = action(() => {
    if (this.popoverOverlay) {
      this.popoverOverlay.destroy();
      this.popoverOverlay = null;
    }
  });
}

/** Size of the translate trigger button, in pixels. */
const TRIGGER_SIZE = 24;

/**
 * Clamps a trigger button position into the viewport and inside the
 * editing pane, so the button can never land over the mirror pane or
 * outside the visible area.
 *
 * @param left The unclamped left position.
 * @param top The unclamped top position.
 * @param view The editor view, used to resolve the pane bounds.
 * @returns The clamped position for the button's top-left corner.
 */
function clampDot(
  left: number,
  top: number,
  view?: EditorView
): { left: number; top: number } {
  const pane = view ? editorPaneRect(view) : null;
  const rightBound = Math.min(
    window.innerWidth - VIEWPORT_INSET - TRIGGER_SIZE,
    (pane?.right ?? window.innerWidth) - VIEWPORT_INSET - TRIGGER_SIZE
  );
  const bottomBound = Math.min(
    window.innerHeight - VIEWPORT_INSET - TRIGGER_SIZE,
    (pane?.bottom ?? window.innerHeight) - VIEWPORT_INSET - TRIGGER_SIZE
  );

  return {
    left: Math.min(
      Math.max(VIEWPORT_INSET, left),
      Math.max(VIEWPORT_INSET, rightBound)
    ),
    top: Math.min(
      Math.max(VIEWPORT_INSET, top),
      Math.max(VIEWPORT_INSET, bottomBound)
    ),
  };
}

/**
 * The floating translate trigger: a round "译" icon button rendered just
 * below the selection's last line, mirroring the FluentRead indicator. It
 * sits clear of the editor's selection toolbar, which occupies the space
 * above the selection.
 */
const DotButton = styled.button<{ $left: number; $top: number }>`
  position: fixed;
  left: ${(props) => props.$left}px;
  top: ${(props) => props.$top}px;
  width: ${TRIGGER_SIZE}px;
  height: ${TRIGGER_SIZE}px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: ${s("accent")};
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 99px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  font-family: inherit;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.3);
  cursor: pointer;
  user-select: none;
  z-index: 1;
`;

/**
 * The lightweight word preview shown while hovering: word, phonetic, and
 * the first sense. Clicking it expands the full translation card.
 */
function WordPeekCard({
  word,
  left,
  top,
  onExpand,
  onEnter,
}: {
  word: string;
  left: number;
  top: number;
  onExpand: () => void;
  onEnter: () => void;
}) {
  const { t } = useTranslation();
  const [entry, setEntry] = React.useState<WordLookupDTO | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    void BilingualStore.lookupWord(word).then((result) => {
      if (!cancelled) {
        setEntry(result);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [word]);

  const first = entry?.senses[0];

  return (
    <PeekCard
      $left={left}
      $top={top}
      onClick={onExpand}
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={onEnter}
      data-testid="word-peek"
    >
      <PeekHead>
        {word}
        {entry?.phonetic && <PeekPhonetic>/{entry.phonetic}/</PeekPhonetic>}
      </PeekHead>
      {first ? (
        <PeekSense>
          {first.pos && <PeekPos>{first.pos}</PeekPos>}
          {first.meaning}
        </PeekSense>
      ) : (
        <PeekSense>…</PeekSense>
      )}
      <PeekMore>{t("Click to expand the full word card")}</PeekMore>
    </PeekCard>
  );
}

const PeekCard = styled.div<{ $left: number; $top: number }>`
  position: fixed;
  left: ${(props) => props.$left}px;
  top: ${(props) => props.$top}px;
  max-width: 280px;
  background: ${s("background")};
  color: ${s("text")};
  border: 1px solid ${s("divider")};
  border-radius: 9px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  padding: 9px 12px;
  font-size: 13px;
  line-height: 1.5;
  cursor: pointer;
  z-index: 1;
`;

const PeekHead = styled.div`
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 14.5px;
  font-weight: 600;
`;

const PeekPhonetic = styled.span`
  font-weight: 400;
  font-size: 12px;
  color: ${s("textSecondary")};
`;

const PeekSense = styled.div`
  font-size: 12.5px;
  margin-top: 2px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
`;

const PeekPos = styled.span`
  color: ${s("accent")};
  font-style: italic;
  font-size: 11.5px;
  margin-right: 6px;
`;

const PeekMore = styled.div`
  margin-top: 6px;
  padding-top: 5px;
  border-top: 1px dashed ${s("divider")};
  color: ${s("textSecondary")};
  font-size: 11px;
`;
