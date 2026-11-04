/**
 * Types shared between the server and the client for the LLM proofread
 * (grammar checking) feature, following the FluentRead-Go proofread
 * protocol: the model reports verbatim source fragments and the server
 * validates them against the original text.
 */

/** The category of one proofread suggestion. */
export type ProofreadCategory =
  | "spelling"
  | "grammar"
  | "punctuation"
  | "style"
  | "word_choice";

/** One correction suggestion for a verbatim fragment of the source text. */
export interface ProofreadSuggestion {
  /** The fragment, which must appear verbatim in the source text. */
  original: string;
  /** The suggested replacement. */
  suggestion: string;
  /** The error category. */
  category: ProofreadCategory;
  /** A teaching explanation of the rule behind the correction. */
  reason: string;
}

/** Response of `proofread.check`. */
export interface ProofreadResponseDTO {
  /** The validated suggestions, possibly empty. */
  suggestions: ProofreadSuggestion[];
}
