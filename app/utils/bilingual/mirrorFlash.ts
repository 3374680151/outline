/**
 * Registry connecting the mirror engine's writes to the decoration that
 * highlights the freshly written mirror block. The engine announces the
 * block index; the mirror extension (which owns the target editor's
 * plugins) renders it as a ProseMirror node decoration, so the highlight
 * survives ProseMirror's DOM redraws.
 */

type MirrorFlashListener = (index: number) => void;

const listeners = new Set<MirrorFlashListener>();

/**
 * Subscribes to mirror write flashes. Only the target pane's mirror
 * extension registers.
 *
 * @param listener Called with the source block index that was written.
 * @returns An unsubscribe function.
 */
export function registerMirrorFlashListener(
  listener: MirrorFlashListener
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Announces that a mirror block was just written and should be highlighted.
 *
 * @param index The source block index that was written.
 */
export function flashMirrorBlock(index: number): void {
  listeners.forEach((listener) => listener(index));
}
