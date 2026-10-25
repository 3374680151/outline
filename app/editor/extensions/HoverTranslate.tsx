import { action, observable } from "mobx";
import { Plugin } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import Extension from "@shared/editor/lib/Extension";
import depths from "@shared/styles/depths";
import TranslatePopover, {
  type TranslatePopoverProps,
} from "~/editor/components/TranslatePopover";
import { mountReactOverlay, VIEWPORT_INSET } from "~/utils/bilingual/overlay";
import { wordAtOffset } from "~/utils/bilingual/wordNormalize";

/**
 * Options for the hover translate extension.
 */
interface HoverTranslateOptions {
  /** When the translate dot should appear. */
  mode: "off" | "dot" | "hover";
  /** Called to write a translation into the mirror document block. */
  onInsertText?: (blockIndex: number, text: string) => void;
}

/** Anchor rect of the dot, in viewport coordinates. */
interface DotAnchor {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Presentation delay after the selection settles, in milliseconds. */
const SELECTION_DELAY_MS = 250;

/** Delay before a hovered word shows the dot, in milliseconds. */
const HOVER_DELAY_MS = 500;

/** Delay before a hidden dot after the pointer leaves a word. */
const HOVER_HIDE_DELAY_MS = 300;

/**
 * Floating translate affordance ported from the FluentRead selection
 * translator: a small dot appears next to the selection (or the hovered
 * word) and opens a translation popover on click.
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
  } | null = null;

  private hoverTimer: ReturnType<typeof setTimeout> | null = null;
  private selectionTimer: ReturnType<typeof setTimeout> | null = null;
  private popoverOverlay: ReturnType<typeof mountReactOverlay> | null = null;
  private rafHandle = 0;
  private lastMouseEvent: MouseEvent | null = null;

  get defaultOptions(): HoverTranslateOptions {
    return { mode: "dot" };
  }

  get name() {
    return "hover-translate";
  }

  get allowInReadOnly() {
    return true;
  }

  get plugins() {
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            mousemove: action((view: EditorView, event: MouseEvent) => {
              if (this.options.mode !== "hover") {
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
        view: (editorView) => {
          const handleScroll = action(() => {
            // The anchor is frozen once shown; hide on scroll rather than
            // risk pointing at the wrong text.
            this.hideDot();
          });

          editorView.dom.addEventListener("scroll", handleScroll, {
            passive: true,
          });

          return {
            update: (view, prevState) => {
              if (!view.state.selection.eq(prevState.selection)) {
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
              editorView.dom.removeEventListener("scroll", handleScroll);
              this.closePopover();

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
    const { selection } = view.state;

    if (selection.empty || this.options.mode === "off") {
      this.hideDot();
      return;
    }

    const anchor = view.coordsAtPos(selection.to);
    const text = view.state.doc.textBetween(selection.from, selection.to, " ");

    if (!text.trim()) {
      this.hideDot();
      return;
    }

    this.dot = {
      left: anchor.right + 14,
      top: anchor.bottom - 4,
      anchor,
      text,
      blockIndex: selection.$from.index(0),
      isWord: false,
    };
  });

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
          left: anchor.right + 14,
          top: anchor.bottom - 4,
          anchor,
          text: word,
          blockIndex: $pos.index(0),
          isWord: true,
        };
      }),
      HOVER_DELAY_MS
    );
  };

  /**
   * Schedules hiding the hovered dot shortly after the pointer moves away.
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
   * Hides the floating dot.
   */
  hideDot = action(() => {
    this.dot = null;
  });

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

    this.hideDot();
    this.closePopover();

    const props: TranslatePopoverProps = {
      text: dot.text,
      isWord: dot.isWord,
      blockIndex: dot.blockIndex,
      documentId,
      anchor: dot.anchor,
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

  widget = () => {
    if (this.options.mode === "off" || !this.dot) {
      return undefined;
    }

    const dot = this.dot;

    return (
      <button
        type="button"
        aria-label="Translate"
        onClick={() => {
          if (this.editor) {
            this.openPopover(this.editor.props.id as string);
          }
        }}
        style={{
          position: "fixed",
          left: Math.min(
            Math.max(VIEWPORT_INSET, dot.left),
            window.innerWidth - VIEWPORT_INSET - 24
          ),
          top: Math.min(
            Math.max(VIEWPORT_INSET, dot.top),
            window.innerHeight - VIEWPORT_INSET - 24
          ),
          width: 8,
          height: 8,
          minWidth: 8,
          minHeight: 8,
          padding: 0,
          borderRadius: "50%",
          border: "1px solid rgba(255, 255, 255, 0.8)",
          background: "#0366d6",
          cursor: "pointer",
        }}
        className="bilingual-translate-dot"
      />
    );
  };
}
