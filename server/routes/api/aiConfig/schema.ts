import { z } from "zod";
import { BaseSchema } from "@server/routes/api/schema";

/** Provider ids that accept workspace level configuration. */
export const AI_CONFIG_PROVIDER_IDS = [
  "openai-compatible",
  "deepl",
  "languagetool",
] as const;

const providerIdSchema = z.enum(AI_CONFIG_PROVIDER_IDS);

export const AiConfigInfoSchema = BaseSchema.extend({
  body: z.object({}),
});

export type AiConfigInfoReq = z.infer<typeof AiConfigInfoSchema>;

export const AiConfigUpdateSchema = BaseSchema.extend({
  body: z.object({
    /** The service to configure. */
    providerId: providerIdSchema,

    /** Base URL override for the service. */
    baseUrl: z
      .string()
      .max(2048)
      .refine(
        (value) => value === "" || /^https?:\/\//.test(value),
        { error: "Base URL must be an http(s) URL" }
      )
      .optional(),

    /** Plaintext API key to store; it is encrypted at rest. */
    apiKey: z.string().max(2000).optional(),

    /** Whether to remove the stored API key. */
    clearApiKey: z.boolean().optional(),

    /** Model name override. */
    model: z.string().max(255).optional(),

    /** Whether this provider becomes the workspace's preferred provider. */
    isDefault: z.boolean().optional(),
  }),
});

export type AiConfigUpdateReq = z.infer<typeof AiConfigUpdateSchema>;

export const AiConfigTestSchema = BaseSchema.extend({
  body: z.object({
    /** The service to test. */
    providerId: providerIdSchema,

    /** Base URL to test instead of the stored one. */
    baseUrl: z.string().max(2048).optional(),

    /** API key to test instead of the stored one. */
    apiKey: z.string().max(2000).optional(),

    /** Model name to test instead of the stored one. */
    model: z.string().max(255).optional(),
  }),
});

export type AiConfigTestReq = z.infer<typeof AiConfigTestSchema>;

export const AiConfigModelsSchema = BaseSchema.extend({
  body: z.object({
    /** Base URL of the OpenAI-compatible endpoint. */
    baseUrl: z
      .string()
      .max(2048)
      .refine((value) => /^https?:\/\//.test(value), {
        error: "Base URL must be an http(s) URL",
      }),

    /** API key; omitted uses the stored key. */
    apiKey: z.string().max(2000).optional(),
  }),
});

export type AiConfigModelsReq = z.infer<typeof AiConfigModelsSchema>;
