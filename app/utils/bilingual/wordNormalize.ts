/**
 * English word extraction for hover translation, ported from the FluentRead
 * project's word normalization logic (see
 * FluentRead/src/features/selection-translation/services/wordNormalization.ts).
 */

/** Maximum length of a single word lookup. */
const MAX_WORD_LENGTH = 64;

/** Curly quotes and dashes are folded to their ASCII equivalents. */
const CURLY_APOSTROPHES = /[\u2018\u2019\u02BC]/g;

/** A word is letters joined by apostrophes or hyphens, e.g. "don't", "well-known". */
const WORD_PATTERN = /^[A-Za-z]+(?:['-][A-Za-z]+)*$/;

/**
 * Normalizes a candidate word for dictionary lookup.
 *
 * @param input The raw text around the cursor.
 * @returns The normalized word, or null when the input is not a single English word.
 */
export function normalizeEnglishWord(input: string): string | null {
  if (!input || input.length > MAX_WORD_LENGTH) {
    return null;
  }

  const folded = input.trim().replace(CURLY_APOSTROPHES, "'");

  if (!WORD_PATTERN.test(folded)) {
    return null;
  }

  return folded;
}

/**
 * Finds the English word containing a given character offset in a text.
 *
 * @param text The text to search.
 * @param offset The UTF-16 offset of interest (may point at a boundary).
 * @returns The raw matched word span, or null when no word contains the offset.
 */
export function wordAtOffset(text: string, offset: number): string | null {
  if (!text || offset < 0 || offset > text.length) {
    return null;
  }

  const pattern = /[A-Za-z]+(?:['\u2019-][A-Za-z]+)*/g;
  let match: RegExpExecArray | null = pattern.exec(text);

  while (match) {
    if (match.index <= offset && offset < match.index + match[0].length) {
      return match[0];
    }

    match = pattern.exec(text);
  }

  return null;
}
