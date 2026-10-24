import type { Mark, Node as ProsemirrorNode } from "prosemirror-model";
import type { EditorState, Transaction } from "prosemirror-state";
import type { ProsemirrorData, ProsemirrorDoc } from "@shared/types";

/**
 * The slice of the editor API the translation utilities need. The real
 * editor satisfies this structurally, which keeps the utilities unit
 * testable.
 */
export interface TranslationEditor {
  view: {
    state: EditorState;
    dispatch: (tr: Transaction) => void;
  };
}

/**
 * Node types that contain translatable text and can be mirrored with
 * translated content. Everything else (code blocks, tables, images, embeds,
 * math, toggles) is left untranslated.
 */
export const TRANSLATABLE_CONTAINERS = [
  "bullet_list",
  "ordered_list",
  "checkbox_list",
  "blockquote",
  "notice",
  "list_item",
  "checkbox_item",
];

export const TRANSLATABLE_TEXT_BLOCKS = ["paragraph", "heading"];

/**
 * Returns the translation mark of the node, when its text carries one. Used
 * to clean up translated blocks that older versions of the translation
 * feature inserted into documents.
 *
 * @param node The node to inspect.
 * @returns The translation mark, or undefined.
 */
export function translationMarkOf(node: ProsemirrorNode) {
  const markType = node.type.schema.marks.translation;
  if (!markType) {
    return undefined;
  }

  let found: Mark | undefined;
  node.descendants((child) => {
    const mark = child.marks.find((item) => item.type === markType);
    if (!found && mark) {
      found = mark;
    }
    return !found;
  });
  return found;
}

/**
 * Returns whether any text within the node carries the translation mark.
 *
 * @param node The node to inspect.
 * @returns True when translated text is present.
 */
export function hasTranslationMark(node: ProsemirrorNode): boolean {
  return translationMarkOf(node) !== undefined;
}

/**
 * Collects the translatable text units of a document, one per text block.
 * Blocks that contain translated text are skipped so only source content is
 * translated.
 *
 * @param doc The current ProseMirror document.
 * @returns The text of each translatable block, trimmed.
 */
export function collectTranslationUnits(doc: ProsemirrorNode): string[] {
  const units: string[] = [];

  doc.forEach((block) => {
    if (hasTranslationMark(block)) {
      return;
    }
    collectUnits(block, units);
  });

  return units;
}

/**
 * Recursively collects translatable text blocks from a node.
 *
 * @param node The node to walk.
 * @param units The array to append text units to.
 */
function collectUnits(node: ProsemirrorNode, units: string[]): void {
  if (TRANSLATABLE_TEXT_BLOCKS.includes(node.type.name)) {
    const text = node.textContent.trim();
    if (text) {
      units.push(text);
    }
    return;
  }

  if (TRANSLATABLE_CONTAINERS.includes(node.type.name)) {
    node.forEach((child) => collectUnits(child, units));
  }
}

/**
 * Builds the JSON data of a mirror document showing the same structure as
 * the source document with every translatable text replaced by its
 * translation. Blocks without a translation are omitted. The mirror is
 * display only – nothing here is written back into the document.
 *
 * @param doc The current ProseMirror document.
 * @param translations Map from source text to translated text.
 * @returns The mirror document as ProseMirror JSON data, or null when
 * nothing is translated yet.
 */
export function buildMirrorDocJSON(
  doc: ProsemirrorNode,
  translations: Map<string, string>
): ProsemirrorDoc | null {
  const content: ProsemirrorDoc["content"] = [];

  doc.forEach((block) => {
    if (hasTranslationMark(block)) {
      return;
    }
    const mirrored = mirrorNode(block, translations);
    if (mirrored) {
      content.push(mirrored);
    }
  });

  if (content.length === 0) {
    return null;
  }

  return {
    type: "doc",
    content,
  };
}

/**
 * Builds the JSON data of a single translated block.
 *
 * @param node The source node to mirror.
 * @param translations Map from source text to translated text.
 * @returns The mirrored node data, or null when there is no translation.
 */
function mirrorNode(
  node: ProsemirrorNode,
  translations: Map<string, string>
): ProsemirrorData | null {
  if (TRANSLATABLE_TEXT_BLOCKS.includes(node.type.name)) {
    const translated = translations.get(node.textContent.trim());

    if (!translated) {
      return null;
    }

    return {
      type: node.type.name,
      ...(Object.keys(node.attrs).length > 0 ? { attrs: node.attrs } : {}),
      content: [
        {
          type: "text",
          text: translated,
        },
      ],
    };
  }

  if (TRANSLATABLE_CONTAINERS.includes(node.type.name)) {
    const content: ProsemirrorData[] = [];
    node.forEach((child) => {
      const mirrored = mirrorNode(child, translations);
      if (mirrored) {
        content.push(mirrored);
      }
    });

    if (content.length === 0) {
      return null;
    }

    return {
      type: node.type.name,
      ...(Object.keys(node.attrs).length > 0 ? { attrs: node.attrs } : {}),
      content,
    };
  }

  return null;
}

/**
 * Removes all translated blocks from the document. Older versions of the
 * translation feature inserted translations into the document body; this
 * cleans them up, since translations are display only now. The document is
 * never emptied completely.
 *
 * @param editor The document editor.
 * @returns True when the document was modified.
 */
export function removeTranslations(editor: TranslationEditor): boolean {
  const { state, dispatch } = editor.view;
  const blocks: { node: ProsemirrorNode; pos: number }[] = [];
  state.doc.forEach((child, offset) =>
    blocks.push({ node: child, pos: offset })
  );

  const ops: { pos: number; size: number }[] = [];
  blocks.forEach(({ node, pos }) => {
    if (!hasTranslationMark(node)) {
      return;
    }
    // Never empty the document when removing translations.
    if (blocks.length === 1) {
      return;
    }
    ops.push({ pos, size: node.nodeSize });
  });

  if (ops.length === 0) {
    return false;
  }

  const tr = state.tr;
  ops
    .sort((a, b) => b.pos - a.pos)
    .forEach((op) => tr.delete(op.pos, op.pos + op.size));

  if (!tr.docChanged) {
    return false;
  }

  dispatch(tr);
  return true;
}
