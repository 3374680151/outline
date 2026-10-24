/**
 * Failure categories assigned by providers, mirroring the semantics of the
 * FluentRead free translation pool.
 *
 * - "request": the text itself cannot be handled (unsupported language pair,
 *   untranslated echo) – no cooldown, the provider is simply skipped.
 * - "rate-limit": the provider asked to slow down (HTTP 429).
 * - "blocked": the provider is challenging or refusing the client (CAPTCHA,
 *   auth failure) – long cooldown.
 * - "quota": the anonymous daily allowance is exhausted – very long cooldown.
 * - "unavailable": any other network or protocol failure.
 */
export type FreeProviderErrorCategory =
  | "request"
  | "rate-limit"
  | "blocked"
  | "quota"
  | "unavailable";

/**
 * An error raised by a free translation provider, carrying the failure
 * category used by the pool to compute the cooldown.
 */
export class FreeProviderError extends Error {
  category: FreeProviderErrorCategory;

  /**
   * Creates a provider error.
   *
   * @param message The error description.
   * @param category The failure category, defaults to "unavailable".
   */
  constructor(
    message: string,
    category: FreeProviderErrorCategory = "unavailable"
  ) {
    super(message);
    this.category = category;
  }
}

/** The translation engines available in the free provider pool. */
export type FreeTranslationEngine =
  | "microsoft"
  | "google"
  | "transmart"
  | "volcengine"
  | "alibaba"
  | "youdao"
  | "bilibili"
  | "mymemory";

export interface FreeTranslationResult {
  /** The translated text. */
  text: string;
  /** The engine that produced the translation. */
  engine: FreeTranslationEngine;
}

/**
 * A single free translation provider. Implementations translate one text per
 * call and throw `FreeProviderError` on failure.
 */
export interface FreeProvider {
  id: FreeTranslationEngine;
  /** Relative scheduling weight used by the balanced pool selection. */
  weight: number;
  translate: (
    text: string,
    sourceLanguage: string,
    targetLanguage: string,
    signal: AbortSignal
  ) => Promise<string>;
}
