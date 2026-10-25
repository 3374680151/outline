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
  /** Human description of the rule the issue was reported by */
  ruleDescription?: string;
  /** External pages explaining the rule */
  ruleUrls: string[];
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

/** A text block of the document with its position and checked text. */
export interface GrammarBlock {
  /** The block node */
  node: ProsemirrorNode;
  /** The absolute position of the block node */
  pos: number;
  /** The concatenated text of all text nodes of the block */
  raw: string;
  /** The trimmed text of the block, the unit grammar checking runs on */
  text: string;
}

/** The document range of a flagged span. */
export interface GrammarRange {
  from: number;
  to: number;
}

/** A located flagged span, with the marks of the text at its start. */
export interface GrammarSegment extends GrammarRange {
  marks: readonly Mark[];
}

/** The visual kind of an issue, following the official client colors. */
export type GrammarIssueKind = "danger" | "success" | "accent";

const STYLE_ISSUE_TYPES = ["style", "register", "typographical"];
const STYLE_CATEGORY_NAMES = ["style", "typography"];

/**
 * Returns the visual kind of an issue, following the official client colors:
 * spelling mistakes are red, style hints green and other issues blue.
 *
 * @param match The reported match.
 * @returns The issue kind.
 */
export function grammarIssueKind(match: GrammarMatch): GrammarIssueKind {
  if (match.issueType === "misspelling") {
    return "danger";
  }

  if (
    STYLE_ISSUE_TYPES.includes(match.issueType ?? "") ||
    STYLE_CATEGORY_NAMES.includes((match.categoryName ?? "").toLowerCase())
  ) {
    return "success";
  }

  return "accent";
}

/**
 * Returns the English label of an issue's category, for translation.
 *
 * @param match The reported match.
 * @returns The category label key.
 */
export function grammarCategoryLabel(match: GrammarMatch): string {
  switch (match.issueType) {
    case "misspelling":
      return "Spelling";
    case "style":
    case "register":
      return "Style";
    case "whitespace":
    case "typographical":
    case "characters":
    case "formatting":
      return "Punctuation";
    case "grammar":
      return "Grammar";
    default:
      return "Other";
  }
}

const LETTER_RE = /\p{L}/u;

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
  return collectGrammarBlocks(doc).map((block) => block.text);
}

/**
 * Collects the checkable text blocks of a document with their absolute
 * positions, in document order.
 *
 * @param doc The current ProseMirror document.
 * @returns The text blocks of the document, empty blocks excluded.
 */
export function collectGrammarBlocks(doc: ProsemirrorNode): GrammarBlock[] {
  const found: { node: ProsemirrorNode; pos: number }[] = [];
  collectTextBlocks(doc, 0, found);

  const blocks: GrammarBlock[] = [];

  for (const { node, pos } of found) {
    const raw = collectBlockText(node);
    const text = raw.trim();

    if (text) {
      blocks.push({ node, pos, raw, text });
    }
  }

  return blocks;
}

/**
 * Returns whether the text contains enough letters to be worth a grammar
 * check, in any script. Blocks of pure numbers or punctuation are skipped.
 *
 * @param text The block text to inspect.
 * @returns True when the text looks like prose.
 */
export function isCheckableText(text: string): boolean {
  return LETTER_RE.test(text);
}

/** Options controlling which reported matches are shown to the user. */
export interface GrammarFilterOptions {
  /** Words the user added to their personal dictionary. */
  dictionary?: string[];
  /** Rule IDs the user has turned off. */
  disabledRules?: string[];
}

/**
 * Filters reported matches down to those the user wants to see: dictionary
 * words are never misspellings and disabled rules are never shown.
 *
 * @param text The text that was checked.
 * @param matches The matches reported for the text.
 * @param options The user's dictionary and disabled rules.
 * @returns The matches to display.
 */
export function filterGrammarMatches(
  text: string,
  matches: GrammarMatch[],
  options: GrammarFilterOptions = {}
): GrammarMatch[] {
  const dictionary = new Set(
    (options.dictionary ?? []).map((word) => word.toLowerCase())
  );
  const disabledRules = new Set(options.disabledRules ?? []);

  return matches.filter((match) => {
    if (match.ruleId && disabledRules.has(match.ruleId)) {
      return false;
    }

    if (match.issueType !== "misspelling" || dictionary.size === 0) {
      return true;
    }

    const span = text
      .slice(match.offset, match.offset + match.length)
      .toLowerCase();

    return !dictionary.has(span);
  });
}

/**
 * Locates the document range of a flagged span within a checked block.
 *
 * @param block The block the match offsets refer to.
 * @param offset The offset of the flagged span within the trimmed block text.
 * @param length The length of the flagged span.
 * @returns The range and marks, or undefined when out of bounds.
 */
export function locateInBlock(
  block: GrammarBlock,
  offset: number,
  length: number
): GrammarSegment | undefined {
  // Offsets refer to the trimmed text; shift back into the raw text.
  const lead = block.raw.length - block.raw.trimStart().length;
  const start = lead + offset;
  const end = start + length;

  if (start < 0 || end > block.raw.length) {
    return undefined;
  }

  return findSegment(block.node, block.pos, start, end);
}

/**
 * Locates the document range of a flagged span within the first text block
 * matching the checked unit text. Nothing is found when the document changed
 * since the check and the flagged text can no longer be located.
 *
 * @param doc The current ProseMirror document.
 * @param fix The flagged span to locate.
 * @returns The range and marks, or undefined when not found.
 */
export function locateGrammarRange(
  doc: ProsemirrorNode,
  fix: Pick<GrammarFix, "unitText" | "offset" | "length">
): GrammarSegment | undefined {
  for (const block of collectGrammarBlocks(doc)) {
    if (block.text !== fix.unitText) {
      continue;
    }

    const segment = locateInBlock(block, fix.offset, fix.length);

    if (segment) {
      return segment;
    }
  }

  return undefined;
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
  const segment = locateGrammarRange(state.doc, fix);

  if (!segment) {
    return false;
  }

  const tr = state.tr;

  if (fix.replacement) {
    tr.replaceWith(
      segment.from,
      segment.to,
      state.schema.text(fix.replacement, [...segment.marks])
    );
  } else {
    tr.delete(segment.from, segment.to);
  }

  if (!tr.docChanged) {
    return false;
  }

  dispatch(tr);
  return true;
}

/**
 * Collects checkable text blocks from a node.
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
): GrammarSegment | undefined {
  let consumed = 0;
  let result: GrammarSegment | undefined;

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
