import { z } from "zod";
import { BaseSchema } from "../schema";

export const GrammarCheckSchema = BaseSchema.extend({
  body: z.object({
    /** The text to check */
    text: z.string().min(1).max(5000),
    /** BCP-47 tag of the language to check against, auto to detect, auto when omitted */
    language: z.string().min(2).max(35).optional(),
    /** The user's native language, enables false-friend hints */
    motherTongue: z.string().min(2).max(35).optional(),
    /** Preferred language variants when the language is auto-detected */
    preferredVariants: z.array(z.string().min(2).max(35)).max(10).optional(),
    /** The check level, picky enables strict style rules */
    level: z.enum(["default", "picky"]).optional(),
    /** Category IDs to disable for this check */
    disabledCategories: z.array(z.string().min(1).max(100)).max(100).optional(),
    /** Rule IDs to disable for this check */
    disabledRules: z.array(z.string().min(1).max(200)).max(1000).optional(),
  }),
});

export type GrammarCheckReq = z.infer<typeof GrammarCheckSchema>;

export const GrammarConfigSchema = BaseSchema.extend({
  body: z.object({
    /** BCP-47 tag of the language to list the rules of */
    language: z.string().min(2).max(35),
  }),
});

export type GrammarConfigReq = z.infer<typeof GrammarConfigSchema>;
