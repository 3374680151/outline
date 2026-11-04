import { z } from "zod";
import { BaseSchema } from "@server/routes/api/schema";
import { aiVendorTemplates } from "@shared/aiVendorTemplates";

/** The vendor slugs available for quick-fill. */
const VENDOR_SLUGS = aiVendorTemplates.map((template) => template.vendor);

const protocolSchema = z.enum(["openai", "anthropic", "gemini"]);

const baseUrlField = z
  .string()
  .max(2048)
  .refine((value) => /^https?:\/\//.test(value.trim()), {
    error: "Base URL must be an http(s) URL",
  });

export const ModelProviderInfoSchema = BaseSchema.extend({
  body: z.object({}),
});

export type ModelProviderInfoReq = z.infer<typeof ModelProviderInfoSchema>;

export const ModelProviderCreateSchema = BaseSchema.extend({
  body: z.object({
    /** Display name of the provider. */
    name: z.string().min(1).max(100),

    /** The vendor template slug the provider came from, when any. */
    vendor: z.string().max(50).optional(),

    /** The wire protocol of the endpoint. */
    protocol: protocolSchema.default("openai"),

    /** The endpoint base URL. */
    baseUrl: baseUrlField,

    /** Plaintext API key; it is encrypted at rest. */
    apiKey: z.string().max(2000).optional(),

    /** The default model name. */
    model: z.string().max(255).optional(),

    /** Whether the provider may serve requests. Defaults to true. */
    enabled: z.boolean().optional(),
  }),
});

export type ModelProviderCreateReq = z.infer<typeof ModelProviderCreateSchema>;

export const ModelProviderUpdateSchema = BaseSchema.extend({
  body: z.object({
    /** The provider to update. */
    id: z.string().uuid(),

    /** New display name. */
    name: z.string().min(1).max(100).optional(),

    /** New vendor template slug; empty string clears the association. */
    vendor: z.string().max(50).optional(),

    /** New wire protocol. */
    protocol: protocolSchema.optional(),

    /** New endpoint base URL. */
    baseUrl: baseUrlField.optional(),

    /** Plaintext API key to store; it is encrypted at rest. */
    apiKey: z.string().max(2000).optional(),

    /** Whether to remove the stored API key. */
    clearApiKey: z.boolean().optional(),

    /** New default model name. */
    model: z.string().max(255).optional(),

    /** Whether the provider may serve requests. */
    enabled: z.boolean().optional(),
  }),
});

export type ModelProviderUpdateReq = z.infer<typeof ModelProviderUpdateSchema>;

export const ModelProviderSetModelsSchema = BaseSchema.extend({
  body: z.object({
    /** The provider whose enabled model set is replaced. */
    id: z.string().uuid(),

    /** The full list of enabled model ids. */
    models: z.array(z.string().min(1).max(255)).max(500),
  }),
});

export type ModelProviderSetModelsReq = z.infer<
  typeof ModelProviderSetModelsSchema
>;

export const ModelProviderAddModelSchema = BaseSchema.extend({
  body: z.object({
    /** The provider to add the model to. */
    id: z.string().uuid(),

    /** The model id to add; it is stored enabled with source "manual". */
    model: z.string().min(1).max(255),
  }),
});

export type ModelProviderAddModelReq = z.infer<
  typeof ModelProviderAddModelSchema
>;

export const ModelProviderDeleteSchema = BaseSchema.extend({
  body: z.object({
    /** The provider to delete. */
    id: z.string().uuid(),
  }),
});

export type ModelProviderDeleteReq = z.infer<typeof ModelProviderDeleteSchema>;

export const ModelProviderTestSchema = BaseSchema.extend({
  body: z.object({
    /** The provider to test with its stored credentials. */
    id: z.string().uuid().optional(),

    /** Protocol to test when testing unsaved credentials. */
    protocol: protocolSchema.optional(),

    /** Base URL to test instead of the stored one. */
    baseUrl: baseUrlField.optional(),

    /** API key to test instead of the stored one. */
    apiKey: z.string().max(2000).optional(),

    /** Model name to test instead of the stored default. */
    model: z.string().max(255).optional(),
  }),
});

export type ModelProviderTestReq = z.infer<typeof ModelProviderTestSchema>;

export const ModelProviderModelsSchema = BaseSchema.extend({
  body: z.object({
    /** The provider whose stored credentials should be used. */
    id: z.string().uuid().optional(),

    /** Protocol when testing unsaved credentials. */
    protocol: protocolSchema.optional(),

    /** Base URL to fetch models from. */
    baseUrl: baseUrlField.optional(),

    /** API key to use; omitted uses the stored key. */
    apiKey: z.string().max(2000).optional(),
  }),
});

export type ModelProviderModelsReq = z.infer<typeof ModelProviderModelsSchema>;

/** Kept for reference: the vendor slugs the UI can quick-fill. */
export const MODEL_PROVIDER_VENDOR_SLUGS = VENDOR_SLUGS;
