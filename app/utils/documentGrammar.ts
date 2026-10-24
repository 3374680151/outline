import type { Mark, Node as ProsemirrorNode } from "prosemirror-model";
import type { EditorState, Transaction } from "prosemirror-state";
import {
  TRANSLATABLE_CONTAINERS,
  TRANSLATABLE_TEXT_BLOCKS,
} from "./documentTranslation";

/**
 * The slice of the editor API the grammar utilities need. The real editor
 * satisfies this structurally, which keeps the utilities unit testable.
 */
export interface GrammarEditor {
  view: {
    state: EditorState;
    dispatch: (tr: Transaction) => void;
  };
}

/** A single grammar, spelling or style issue as returned by the server. */
export interface GrammarMatch {
  message: string;
  shortMessage?: string;
  /** Offset of the issue within the checked text, in UTF-16 code units */
  offset: number;
  length: number;
  /** Suggested corrections, best first */
  replacements: { value: string }[];
  /** The issue shown within its surrounding text */
  context?: { text: string; offset: number; length: number };
  issueType?: string;
  ruleId?: string;
  categoryName?: string;
}

/** A pending replacement of a checked span. */
export interface GrammarFix {
  /** The checked block text the offset and length refer to */
  unitText: string;
  offset: number;
  length: number;
  replacement: string;
}

/** A text node of the document mapped to the checked block text. */
interface TextSegment {
  from: number;
  to: number;
  marks: readonly Mark[];
}

/**
 * Collects the text of every text node within the node. This is the text
 * grammar checking runs on and the coordinate system the offsets of the
 * returned matches refer to.
 *
 * @param node The block to read.
 * @returns The concatenated text of all text nodes.
 */
export function collectBlockText(node: ProsemirrorNode): string {
  let text = "";

  node.descendants((child) => {
    if (child.isText && child.text) {
      text += child.text;
    }
    return true;
  });

  return text;
}

/**
 * Collects the checkable text units of a document, one per text block, in
 * document order. Code blocks, tables, images and embeds are skipped as they
 * are not prose.
 *
 * @param doc The current ProseMirror document.
 * @returns The text of each checkable block, trimmed.
 */
export function collectGrammarUnits(doc: ProsemirrorNode): string[] {
  const units: string[] = [];

  doc.forEach((block) => collectUnits(block, units));

  return units;
}

/**
 * Recursively collects checkable text blocks from a node.
 *
 * @param node The node to walk.
 * @param units The array to append text units to.
 */
function collectUnits(node: ProsemirrorNode, units: string[]): void {
  if (TRANSLATABLE_TEXT_BLOCKS.includes(node.type.name)) {
    const text = collectBlockText(node).trim();
    if (text) {
      units.push(text);
    }
    return;
  }

  if (TRANSLATABLE_CONTAINERS.includes(node.type.name)) {
    node.forEach((child) => collectUnits(child, units));
  }
}

const LATIN_LETTER_RE = /[A-Za-z]/g;

const CJK_TEST_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/;

/**
 * Returns whether the text contains enough Latin letters to be worth a
 * grammar check. Purely CJK text is skipped so it is never sent to the
 * English grammar service.
 *
 * @param text The block text to inspect.
 * @returns True when the text looks like prose in a Latin script.
 */
export function isCheckableText(text: string): boolean {
  return (text.match(LATIN_LETTER_RE) ?? []).length >= 3;
}

/**
 * Filters out matches that point at CJK characters. LanguageTool is asked to
 * check English, so in mixed language text every CJK character would be
 * reported as a misspelling – those matches are noise.
 *
 * @param text The text that was checked.
 * @param matches The matches reported for the text.
 * @returns The matches that point at Latin text only.
 */
export function filterGrammarMatches(
  text: string,
  matches: GrammarMatch[]
): GrammarMatch[] {
  return matches.filter((match) => {
    const span = text.slice(match.offset, match.offset + match.length);
    return !CJK_TEST_RE.test(span);
  });
}

/**
 * Applies a replacement suggestion to the document. The first text block
 * matching the checked unit text is located and the flagged span is replaced,
 * keeping the marks of the replaced text. Nothing happens when the document
 * changed since the check and the flagged text can no longer be found.
 *
 * @param editor The document editor.
 * @param fix The replacement to apply.
 * @returns True when the document was modified.
 */
export function applyGrammarFix(
  editor: GrammarEditor,
  fix: GrammarFix
): boolean {
  const { state, dispatch } = editor.view;
  const blocks: { node: ProsemirrorNode; pos: number }[] = [];
  collectTextBlocks(state.doc, 0, blocks);

  for (const { node, pos } of blocks) {
    const raw = collectBlockText(node);

    if (raw.trim() !== fix.unitText) {
      continue;
    }

    // Offsets refer to the trimmed unit text; shift back into the raw text.
    const lead = raw.length - raw.trimStart().length;
    const start = lead + fix.offset;
    const end = start + fix.length;

    if (start < 0 || end > raw.length) {
      continue;
    }

    const segment = findSegment(node, pos, start, end);

    if (!segment) {
      continue;
    }

    const tr = state.tr;
    tr.replaceWith(
      segment.from,
      segment.to,
      state.schema.text(fix.replacement, [...segment.marks])
    );

    if (!tr.docChanged) {
      return false;
    }

    dispatch(tr);
    return true;
  }

  return false;
}

/**
 * Collects checkable text blocks with the absolute position of each block.
 *
 * @param node The parent node to walk.
 * @param contentStart The absolute position of the parent's content start.
 * @param out The array to append blocks to.
 */
function collectTextBlocks(
  node: ProsemirrorNode,
  contentStart: number,
  out: { node: ProsemirrorNode; pos: number }[]
): void {
  node.forEach((child, offset) => {
    const pos = contentStart + offset;

    if (TRANSLATABLE_TEXT_BLOCKS.includes(child.type.name)) {
      out.push({ node: child, pos });
      return;
    }

    if (TRANSLATABLE_CONTAINERS.includes(child.type.name)) {
      collectTextBlocks(child, pos + 1, out);
    }
  });
}

/**
 * Finds the document range covering the [start, end) character range of the
 * block's text, along with the marks of the text at the start of the range.
 *
 * @param node The block node.
 * @param blockPos The absolute position of the block node.
 * @param start The first character index of the range within the block text.
 * @param end The character index after the range within the block text.
 * @returns The range and marks, or undefined when out of bounds.
 */
function findSegment(
  node: ProsemirrorNode,
  blockPos: number,
  start: number,
  end: number
): TextSegment | undefined {
  let consumed = 0;
  let result: TextSegment | undefined;

  node.descendants((child, childPos) => {
    if (result) {
      return false;
    }
    if (!child.isText || !child.text) {
      return true;
    }

    const from = blockPos + 1 + childPos;
    const segmentStart = consumed;
    const segmentEnd = consumed + child.text.length;
    consumed = segmentEnd;

    if (start >= segmentStart && start < segmentEnd) {
      result = {
        from: from + (start - segmentStart),
        // The range may extend past this text node into the adjacent one.
        to: Math.max(
          from + (start - segmentStart),
          from + (end - segmentStart)
        ),
        marks: child.marks,
      };
      return false;
    }

    return true;
  });

  return result;
}
