/**
 * Mapping between a flat paragraph text (what LanguageTool receives) and
 * ProseMirror positions.
 *
 * Both LanguageTool match offsets and ProseMirror text offsets are UTF-16
 * code units, so no code point conversion is ever required. The mapping
 * exists because a paragraph's inline content may contain non-text nodes
 * (hard breaks, mentions, inline images) that occupy ProseMirror positions
 * but contribute nothing to the flat text.
 */

/** One inline child of a paragraph, in document order. */
export type InlineItem =
  | { kind: "text"; text: string; pmPos: number }
  | { kind: "gap"; pmPos: number };

/** One mapping entry between flat text offsets and ProseMirror positions. */
export interface OffsetEntry {
  /** "text" entries come from text nodes, "gap" entries from inline nodes. */
  kind: "text" | "gap";
  /** ProseMirror position of the start of the node this entry was built from. */
  pmPos: number;
  /** Inclusive start offset into the flat paragraph text. */
  strStart: number;
  /** Exclusive end offset into the flat paragraph text ("gap" is zero width). */
  strEnd: number;
}

/** The flat text of a paragraph plus the entries mapping it back to positions. */
export interface ParagraphTextMap {
  /** The flat text that should be sent to the grammar checker. */
  text: string;
  /** Entries in ascending flat-text order. */
  entries: OffsetEntry[];
}

/** A resolved ProseMirror range for a checker match. */
export interface PMRange {
  /** ProseMirror position of the first character of the match. */
  pmStart: number;
  /** ProseMirror position just after the last character of the match. */
  pmEnd: number;
  /** True when the match spans a non-text inline node and cannot be auto-fixed. */
  crossesGap: boolean;
}

/**
 * Builds the paragraph text map from the ordered inline items of a paragraph.
 *
 * @param items The inline children in document order; text items contribute
 * characters, gap items occupy ProseMirror positions only.
 * @returns The concatenated text and ascending offset entries.
 */
export function buildParagraphTextMap(items: InlineItem[]): ParagraphTextMap {
  const entries: OffsetEntry[] = [];
  const textParts: string[] = [];
  let strIndex = 0;

  for (const item of items) {
    if (item.kind === "text") {
      entries.push({
        kind: "text",
        pmPos: item.pmPos,
        strStart: strIndex,
        strEnd: strIndex + item.text.length,
      });
      textParts.push(item.text);
      strIndex += item.text.length;
    } else {
      entries.push({
        kind: "gap",
        pmPos: item.pmPos,
        strStart: strIndex,
        strEnd: strIndex,
      });
    }
  }

  return {
    text: textParts.join(""),
    entries,
  };
}

/**
 * Resolves the ProseMirror range for a checker match given as an offset and
 * length into the flat paragraph text.
 *
 * @param map The paragraph text map built for the same text.
 * @param offset UTF-16 start offset of the match into the flat text.
 * @param length UTF-16 length of the match.
 * @returns The resolved range, or null when the match cannot be mapped.
 */
export function pmRangeForOffset(
  map: ParagraphTextMap,
  offset: number,
  length: number
): PMRange | null {
  if (length < 0) {
    return null;
  }

  const end = offset + length;
  const textEntries = map.entries.filter((entry) => entry.kind === "text");

  let startEntry: OffsetEntry | undefined;

  for (const entry of textEntries) {
    if (entry.strStart <= offset && offset < entry.strEnd) {
      startEntry = entry;
      break;
    }
  }

  if (!startEntry) {
    return null;
  }

  let endEntry: OffsetEntry | undefined;

  for (const entry of textEntries) {
    if (entry.strStart < end && end <= entry.strEnd) {
      endEntry = entry;
      break;
    }
  }

  if (!endEntry) {
    return null;
  }

  let crossesGap = false;

  for (const entry of map.entries) {
    if (entry.kind === "gap" && entry.strStart > offset && entry.strStart < end) {
      crossesGap = true;
      break;
    }
  }

  const pmStart = startEntry.pmPos + (offset - startEntry.strStart);
  const pmEnd = endEntry.pmPos + (end - endEntry.strStart);

  if (pmEnd < pmStart) {
    return null;
  }

  return {
    pmStart,
    pmEnd,
    crossesGap,
  };
}
