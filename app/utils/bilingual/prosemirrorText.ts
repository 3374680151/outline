import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { InlineItem, ParagraphTextMap } from "./offsetTable";
import { buildParagraphTextMap } from "./offsetTable";

/**
 * Adapter that builds a paragraph text map from a ProseMirror paragraph-like
 * node. Text nodes contribute characters; every other inline child (hard
 * break, mention, inline image, …) contributes a zero-width gap entry that
 * occupies ProseMirror positions but no characters.
 */

/**
 * Builds the flat text and position mapping for a block node's inline
 * content.
 *
 * @param node The block node (paragraph, heading, list item, …).
 * @param basePos The ProseMirror position just before the node.
 * @returns The paragraph text map, with an empty text when the node has no
 * inline text content.
 */
export function buildParagraphMapFromNode(
  node: ProseMirrorNode,
  basePos: number
): ParagraphTextMap {
  const items: InlineItem[] = [];
  // Enter the node's content: the first child starts at basePos + 1.
  let pos = basePos + 1;

  node.content.forEach((child) => {
    if (child.isText && child.text) {
      items.push({
        kind: "text",
        text: child.text,
        pmPos: pos,
      });
    } else if (!child.isText) {
      items.push({
        kind: "gap",
        pmPos: pos,
      });
    }

    pos += child.nodeSize;
  });

  return buildParagraphTextMap(items);
}

/**
 * Collects the top-level block signatures of a document, used as the input
 * of the structural diff for the bilingual mirror engine.
 *
 * @param doc The ProseMirror document.
 * @returns One signature per top-level block, in document order.
 */
export function topLevelBlockSignatures(
  doc: ProseMirrorNode
): { type: string; level?: number }[] {
  const signatures: { type: string; level?: number }[] = [];

  doc.forEach((node) => {
    signatures.push(
      node.type.name === "heading"
        ? { type: node.type.name, level: node.attrs.level as number }
        : { type: node.type.name }
    );
  });

  return signatures;
}
