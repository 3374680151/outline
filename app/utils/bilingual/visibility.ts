import type { EditorView } from "prosemirror-view";

/**
 * Watches the top-level blocks of an editor for viewport visibility so that
 * expensive work (translation, grammar checks) can be restricted to the
 * content the user can actually see.
 */
export interface BlockVisibilityObserver {
  /** Re-binds the observer to the current top-level blocks. */
  sync: () => void;
  /** Stops watching. */
  disconnect: () => void;
}

/** Margin around the viewport treated as visible, in CSS pixels. */
const VISIBILITY_MARGIN = "600px 0px";

/**
 * Creates a visibility observer over an editor's top-level blocks.
 *
 * @param view The editor view to watch.
 * @param onBlocksVisible Called with the indexes of blocks that entered the
 * viewport (or its margin).
 * @returns The observer handle.
 */
export function observeBlockVisibility(
  view: EditorView,
  onBlocksVisible: (indexes: number[]) => void
): BlockVisibilityObserver {
  const indexFor = (element: Element): number =>
    Array.prototype.indexOf.call(view.dom.children, element);

  const observer = new IntersectionObserver(
    (entries) => {
      const visible: number[] = [];

      for (const entry of entries) {
        if (entry.isIntersecting) {
          const index = indexFor(entry.target);

          if (index >= 0) {
            visible.push(index);
          }
        }
      }

      if (visible.length > 0) {
        onBlocksVisible(visible);
      }
    },
    { rootMargin: VISIBILITY_MARGIN }
  );

  const sync = () => {
    observer.disconnect();
    const children = Array.from(view.dom.children);
    children.forEach((child) => observer.observe(child));
  };

  sync();

  return {
    sync,
    disconnect: () => observer.disconnect(),
  };
}
