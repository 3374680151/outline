import type { Node as ProseMirrorNode } from "prosemirror-model";

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
