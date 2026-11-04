import type { Node as PMNode } from "prosemirror-model";

/** One top-level block range selected for proofreading. */
export interface SelectionBlockText {
  /** Absolute position just before the block node. */
  blockFrom: number;
  /** 0-based index of the block among the document's top-level children. */
  blockIndex: number;
  /**
   * The text to check: the selected text when the selection stays inside one
   * block, otherwise the selected overlap of the block's text.
   */
  text: string;
}

/**
 * Whether a top-level node is eligible for grammar checking. Containers such
 * as blockquotes and lists are skipped: their text belongs to nested blocks
 * that a top-level check cannot address.
 *
 * @param node The top-level node.
 * @returns True when the node can be checked.
 */
function isCheckableBlock(node: PMNode): boolean {
  return (
    (node.type.name === "paragraph" || node.type.name === "heading") &&
    node.textContent.trim().length > 0
  );
}

/**
 * Splits a selection into the per-block texts to check. A selection that
 * stays inside one block yields just the selected text; a selection spanning
 * blocks yields each checkable block's overlapping text, so one selection
 * can check several paragraphs in a single batch request.
 *
 * @param doc The document containing the selection.
 * @param from The start of the selection.
 * @param to The end of the selection.
 * @returns The block texts, or null when the selection covers nothing
 *   checkable.
 */
export function selectionBlocks(
  doc: PMNode,
  from: number,
  to: number
): SelectionBlockText[] | null {
  const start = Math.min(from, to);
  const end = Math.max(from, to);

  if (start >= end) {
    return null;
  }

  const blocks: SelectionBlockText[] = [];

  doc.forEach((node, offset, index) => {
    const blockFrom = offset;
    const contentStart = blockFrom + 1;
    const contentEnd = blockFrom + node.nodeSize - 1;

    if (end <= contentStart || start >= contentEnd) {
      return;
    }

    if (!isCheckableBlock(node)) {
      return;
    }

    const overlapFrom = Math.max(start, contentStart);
    const overlapTo = Math.min(end, contentEnd);
    const text = doc
      .textBetween(overlapFrom, overlapTo, "\n")
      .trim();

    if (text) {
      blocks.push({
        blockFrom,
        blockIndex: index,
        text,
      });
    }
  });

  return blocks.length > 0 ? blocks : null;
}
