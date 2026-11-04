import type { ProofreadCategory, ProofreadSuggestion } from "@shared/types/proofread";

/** All valid suggestion categories. */
const CATEGORIES: ProofreadCategory[] = [
  "spelling",
  "grammar",
  "punctuation",
  "style",
  "word_choice",
];

/** Maximum number of suggestions kept from one check. */
export const MAX_SUGGESTIONS = 20;

/**
 * Whether a category string is one of the known categories.
 *
 * @param category The category to check.
 * @returns True when valid.
 */
export function isValidCategory(
  category: string
): category is ProofreadCategory {
  return CATEGORIES.includes(category as ProofreadCategory);
}

/**
 * Extracts the first JSON array from a model response, tolerating markdown
 * code fences and surrounding prose.
 *
 * @param raw The raw model response.
 * @returns The parsed array, or null when none could be parsed.
 */
export function extractJsonArray(raw: string): unknown[] | null {
  const start = raw.indexOf("[");

  if (start === -1) {
    return null;
  }

  const end = raw.lastIndexOf("]");

  if (end <= start) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch (_err) {
    return null;
  }
}

/**
 * Parses a raw model response into validated suggestions. Every item must
 * pass the server-side contract: the fragment must appear verbatim in the
 * source (the model is never trusted with offsets), the category must be one
 * of the known values, suggestion and reason must be non-empty, and
 * duplicate original+suggestion pairs are dropped.
 *
 * @param raw The raw model response.
 * @param source The source text the fragments are validated against.
 * @returns The validated suggestions, at most MAX_SUGGESTIONS.
 */
export function parseAndValidate(
  raw: string,
  source: string
): ProofreadSuggestion[] {
  const candidates = extractJsonArray(raw);

  if (!candidates) {
    return [];
  }

  const out: ProofreadSuggestion[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    if (out.length >= MAX_SUGGESTIONS) {
      break;
    }

    if (typeof candidate !== "object" || candidate === null) {
      continue;
    }

    const item = candidate as Record<string, unknown>;
    const original =
      typeof item.original === "string" ? item.original.trim() : "";
    const suggestion =
      typeof item.suggestion === "string" ? item.suggestion.trim() : "";
    const category =
      typeof item.category === "string" ? item.category.trim() : "";
    const reason = typeof item.reason === "string" ? item.reason.trim() : "";

    // The fragment must exist verbatim in the source text.
    if (!original || !source.includes(original)) {
      continue;
    }

    if (!suggestion || !reason || !isValidCategory(category)) {
      continue;
    }

    if (suggestion === original) {
      continue;
    }

    const key = `${original}→${suggestion}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    out.push({
      original,
      suggestion,
      category,
      reason,
    });
  }

  return out;
}

/**
 * Matches text that contains only CJK characters, CJK punctuation, digits,
 * and whitespace – proofreading it as English does not apply.
 */
const PURE_CJK =
  /^[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef\s\d.,!?;:'"()\-—–…·]+$/;

/**
 * Whether a text is pure CJK content and can be skipped without an upstream
 * call.
 *
 * @param text The text to check.
 * @returns True when the text has no latin script.
 */
export function isPureCJK(text: string): boolean {
  return PURE_CJK.test(text.trim());
}
