import type { EditorView } from "prosemirror-view";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import { topLevelBlockSignatures } from "./prosemirrorText";

/** A resolved top-level block with its ProseMirror range. */
export interface BlockRange {
  /** Position before the block node. */
  from: number;
  /** Position after the block node. */
  to: number;
  /** The block node itself. */
  node: ProseMirrorNode;
  /** Index among top-level blocks. */
  index: number;
}

/** Node types whose content can be replaced wholesale with plain text. */
const TEXT_REPLACEABLE = new Set(["paragraph", "heading"]);

/**
 * Returns the range of the top-level block at the given index.
 *
 * @param view The editor view.
 * @param index The top-level block index.
 * @returns The block range, or null when the index is out of bounds.
 */
export function blockRange(view: EditorView, index: number): BlockRange | null {
  return blockRangeInDoc(view.state.doc, index);
}

/**
 * Returns the range of the top-level block at the given index of a document.
 *
 * @param doc The ProseMirror document.
 * @param index The top-level block index.
 * @returns The block range, or null when the index is out of bounds.
 */
export function blockRangeInDoc(
  doc: ProseMirrorNode,
  index: number
): BlockRange | null {
  if (index < 0 || index >= doc.childCount) {
    return null;
  }

  let from = 0;

  for (let i = 0; i < index; i++) {
    from += doc.child(i).nodeSize;
  }

  return {
    from,
    to: from + doc.child(index).nodeSize,
    node: doc.child(index),
    index,
  };
}

/**
 * Returns the plain text of the top-level block at the given index.
 *
 * @param view The editor view.
 * @param index The top-level block index.
 * @returns The block text, or an empty string when out of bounds.
 */
export function blockText(view: EditorView, index: number): string {
  const range = blockRange(view, index);
  return range ? range.node.textContent : "";
}

/**
 * Whether a block's content can be replaced with plain text while keeping
 * its node type (paragraphs and headings only).
 *
 * @param node The block node.
 * @returns True when the block is text replaceable.
 */
export function isTextReplaceable(node: ProseMirrorNode): boolean {
  return TEXT_REPLACEABLE.has(node.type.name);
}

/**
 * Replaces the content of the top-level block at the given index with plain
 * text, keeping the node type and attributes. Dispatches a single
 * transaction so undo works as expected.
 *
 * @param view The editor view to modify.
 * @param index The top-level block index.
 * @param text The replacement text.
 * @returns True when the block was replaced.
 */
export function replaceBlockText(
  view: EditorView,
  index: number,
  text: string
): boolean {
  const range = blockRange(view, index);

  if (!range || !isTextReplaceable(range.node)) {
    return false;
  }

  const schema = view.state.schema;
  const content = text ? [schema.text(text)] : [];
  const replacement = range.node.type.createChecked(range.node.attrs, content);
  const tr = view.state.tr.replaceWith(range.from, range.to, replacement);

  view.dispatch(tr);
  return true;
}

/**
 * Whether the editor's current selection intersects the given block.
 *
 * @param view The editor view.
 * @param index The top-level block index.
 * @returns True when the selection intersects the block.
 */
export function selectionIntersectsBlock(
  view: EditorView,
  index: number
): boolean {
  const range = blockRange(view, index);
  return range
    ? view.state.selection.from < range.to && view.state.selection.to > range.from
    : false;
}

/**
 * Collects the top-level block signatures of the view's document.
 *
 * @param view The editor view.
 * @returns One signature per top-level block.
 */
export function viewBlockSignatures(view: EditorView) {
  return topLevelBlockSignatures(view.state.doc);
}

/**
 * Collects the top-level block text hashes of the view's document.
 *
 * @param view The editor view.
 * @param hash The hash function to apply.
 * @returns One hash per top-level block.
 */
export function viewBlockTextHashes(
  view: EditorView,
  hash: (input: string) => string
): string[] {
  const doc = view.state.doc;
  const hashes: string[] = [];

  doc.forEach((node) => {
    hashes.push(hash(node.textContent));
  });

  return hashes;
}
