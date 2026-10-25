import { z } from "zod";
import { BaseSchema } from "@server/routes/api/schema";

/** Maximum number of texts per request. */
export const TRANSLATION_MAX_TEXTS = 50;

/** Maximum length of a single text. */
export const TRANSLATION_MAX_TEXT_LENGTH = 8000;

export const TranslationsProvidersSchema = BaseSchema.extend({
  body: z.object({}),
});

export type TranslationsProvidersReq = z.infer<
  typeof TranslationsProvidersSchema
>;

export const TranslationsTranslateSchema = BaseSchema.extend({
  body: z.object({
    /** A single text to translate (shorthand for a one element batch). */
    text: z.string().max(TRANSLATION_MAX_TEXT_LENGTH).optional(),

    /** A batch of texts to translate. */
    texts: z
      .array(z.string().max(TRANSLATION_MAX_TEXT_LENGTH))
      .max(TRANSLATION_MAX_TEXTS)
      .optional(),

    /** Source language hint, ISO 639-1. Omit to auto-detect. */
    from: z.string().max(5).optional(),

    /** Target language, ISO 639-1. Defaults to "zh". */
    to: z.string().max(5).default("zh"),

    /** Provider to use; omitted uses the configured fallback chain. */
    provider: z.string().max(64).optional(),
  }),
});

export type TranslationsTranslateReq = z.infer<
  typeof TranslationsTranslateSchema
>;
