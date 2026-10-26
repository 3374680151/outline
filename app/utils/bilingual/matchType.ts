import type { GrammarMatchDTO } from "@shared/types/bilingual";

/** Display categories for grammar issues, mirroring the grammar web workbench. */
export const GRAMMAR_TYPES = ["typo", "grammar", "punct", "style", "other"] as const;

export type GrammarType = (typeof GRAMMAR_TYPES)[number];

/** Human label per type. */
export const GRAMMAR_TYPE_LABEL: Record<GrammarType, string> = {
  typo: "Spelling",
  grammar: "Grammar",
  punct: "Punctuation",
  style: "Style",
  other: "Other",
};

/** Card accent color per issue type, matching the grammar web workbench. */
export const GRAMMAR_TYPE_COLOR: Record<GrammarType, string> = {
  typo: "#dc2626",
  grammar: "#d97706",
  punct: "#2563eb",
  style: "#7c3aed",
  other: "#64748b",
};

/**
 * Classifies a LanguageTool match into the workbench categories, ported from
 * the grammar web editor's typeOf() (languagetool/web-editor/index.html):
 * category id and rule id are matched against the same rule-name patterns.
 *
 * @param match The LanguageTool match.
 * @returns The display category.
 */
export function matchType(match: GrammarMatchDTO): GrammarType {
  const cat = match.rule.category.id.toUpperCase();
  const rid = match.rule.id.toUpperCase();
  const key = `${cat} ${rid}`;

  if (/MORFOLOGIK|HUNSPELL|SPELL|CONFUSION|^TYPO|_TYPO|TYPO_/.test(key) && !/TYPOGRAPHY/.test(cat)) {
    return "typo";
  }

  if (/STYLE|REDUNDANCY|WORDINESS|PLAIN_ENGLISH|COLLOCATION|PLEONASM|INFORMAL|SIMPLIFY|PASSIVE/.test(key)) {
    return "style";
  }

  if (/PUNCT|TYPOGRAPHY|CASING|SPACES|DASH|QUOT|COMMA|HYPHEN/.test(key)) {
    return "punct";
  }

  if (
    /GRAMMAR|AGREEMENT|VERB|TENSE|NOUN|PRONOUN|ARTICLE|DETERMINER|SENTENCE|WORD_ORDER|MISSING|PREPOSITION|COMPARATIVE|PLURAL/.test(
      key
    )
  ) {
    return "grammar";
  }

  return "other";
}
