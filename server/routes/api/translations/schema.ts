import { z } from "zod";
import { BaseSchema } from "../schema";

export const TranslationsUpdateConfigSchema = BaseSchema.extend({
  body: z.object({
    /** Base URL of an OpenAI-compatible API, without trailing slash */
    baseUrl: z.url().max(2048),
    /** Model name used for translation requests */
    model: z.string().min(1).max(200),
    /** BCP-47 tag of the language to translate into */
    targetLanguage: z.string().min(2).max(35),
    /** API key. Optional on update so the key can be kept as-is. */
    apiKey: z.string().min(1).max(400).optional(),
  }),
});

export type TranslationsUpdateConfigReq = z.infer<
  typeof TranslationsUpdateConfigSchema
>;

export const TranslationsTranslateSchema = BaseSchema.extend({
  body: z.object({
    /** The text to translate */
    text: z.string().min(1).max(5000),
    /** BCP-47 tag of the source language, auto detection when omitted */
    sourceLanguage: z.string().max(35).optional(),
    /** BCP-47 tag of the target language, workspace default when omitted */
    targetLanguage: z.string().min(2).max(35).optional(),
  }),
});

export type TranslationsTranslateReq = z.infer<
  typeof TranslationsTranslateSchema
>;
