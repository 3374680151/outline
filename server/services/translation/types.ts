/**
 * Translation provider abstraction for the server-side translation proxy.
 * Modeled after the FluentRead project's provider interface (see
 * FluentRead/src/services/translation/types.ts) with credentials resolved
 * server-side only.
 */

/** A batch translation request. */
export interface TranslationRequest {
  /** Texts to translate, in order. */
  texts: string[];
  /** Source language hint, ISO 639-1, or undefined to auto-detect. */
  from?: string;
  /** Target language, ISO 639-1. */
  to: string;
  /** Signal to abort the upstream request. */
  signal: AbortSignal;
}

/** The result of a batch translation. */
export interface TranslationResult {
  /** Translated texts, index parallel to the request texts. */
  results: string[];
  /** The detected source language, when the provider reports it. */
  detectedFrom?: string;
}

/**
 * Workspace level credential override for one provider, loaded from the
 * encrypted TeamAiConfig rows. When a field is unset the provider falls back
 * to its environment variable.
 */
export interface TeamProviderConfig {
  /** Base URL override, when the provider accepts one. */
  baseUrl?: string | null;
  /** API key override, encrypted at rest. */
  apiKey?: string | null;
  /** Model name override, when the provider uses models. */
  model?: string | null;
}

/** The AI service configuration of one workspace. */
export interface TeamTranslationConfig {
  /** Per-provider overrides by provider id. */
  configs: Map<string, TeamProviderConfig>;
  /** The provider the workspace marked as its preferred one, if any. */
  defaultProviderId?: string | null;
}

/** A single translation service. */
export interface TranslationProvider {
  /** Stable provider identifier used in settings and the API. */
  id: string;
  /** Human readable provider name. */
  label: string;
  /** Maximum number of texts accepted in one batch. */
  maxBatch: number;
  /**
   * Whether the provider has the credentials it needs.
   *
   * @param config Workspace level credential override, when present.
   * @returns True when the provider can be used.
   */
  isConfigured(config?: TeamProviderConfig | null): boolean;
  /**
   * Translates a batch of texts.
   *
   * @param req The translation request.
   * @param config Workspace level credential override, when present.
   * @returns The translation result.
   * @throws Error when the upstream service fails.
   */
  translate(
    req: TranslationRequest,
    config?: TeamProviderConfig | null
  ): Promise<TranslationResult>;
}
