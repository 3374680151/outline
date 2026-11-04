import type { Node as PMNode } from "prosemirror-model";

/** A range inside the document, resolved against block text content. */
export interface FragmentRange {
  /** Absolute position of the first character. */
  from: number;
  /** Absolute position just past the last character. */
  to: number;
}

/**
 * Finds the range of a verbatim text fragment inside a block node's plain
 * text content. The block's text is assembled by walking its descendant text
 * nodes in document order, which mirrors what the proofread model saw when
 * it quoted the fragment. The fragment may span several text nodes (e.g.
 * across inline marks); boundaries inside the match are fine because the
 * replacement re-applies the first character's marks.
 *
 * @param block The block node to search.
 * @param blockFrom The absolute position just before the block node.
 * @param fragment The text fragment to locate.
 * @returns The absolute range, or null when the fragment is not found.
 */
export function findFragmentRange(
  block: PMNode,
  blockFrom: number,
  fragment: string
): FragmentRange | null {
  if (!fragment) {
    return null;
  }

  const segments: {
    text: string;
    nodeStart: number;
  }[] = [];

  block.descendants((child, pos) => {
    if (child.isText && child.text) {
      // Descendant positions are relative to the block's content start,
      // which sits one position inside the node's own boundary.
      segments.push({
        text: child.text,
        nodeStart: blockFrom + 1 + pos,
      });
    }

    return true;
  });

  const full = segments.map((segment) => segment.text).join("");
  const index = full.indexOf(fragment);

  if (index === -1) {
    return null;
  }

  const startOffset = index;
  const endOffset = index + fragment.length;

  let seen = 0;
  let from = -1;
  let to = -1;

  for (const segment of segments) {
    const segmentEnd = seen + segment.text.length;

    if (from === -1 && startOffset < segmentEnd) {
      from = segment.nodeStart + (startOffset - seen);
    }

    if (from !== -1 && endOffset <= segmentEnd) {
      to = segment.nodeStart + (endOffset - seen);
      break;
    }

    seen = segmentEnd;
  }

  if (from === -1 || to === -1) {
    return null;
  }

  return {
    from,
    to,
  };
}
