import { z } from "zod";
import { BaseSchema } from "@server/routes/api/schema";

/** Maximum length of text accepted in one check request. */
export const GRAMMAR_MAX_TEXT_LENGTH = 20000;

export const GrammarCheckSchema = BaseSchema.extend({
  body: z.object({
    /** The plain text to check. */
    text: z.string().min(1).max(GRAMMAR_MAX_TEXT_LENGTH),

    /** Language long code, e.g. en-US or en-GB. */
    language: z
      .enum(["en-US", "en-GB", "en-AU", "en-CA", "en-NZ", "en-ZA"])
      .default("en-US"),

    /** Rule level. */
    level: z.enum(["default", "picky"]).default("default"),

    /** Rule mode; textLevelOnly is faster while typing. */
    mode: z
      .enum(["all", "allButTextLevelOnly", "textLevelOnly"])
      .default("all"),

    /** Additional rule ids to disable for this request. */
    disabledRules: z.string().max(2000).optional(),
  }),
});

export type GrammarCheckReq = z.infer<typeof GrammarCheckSchema>;

export const GrammarStatusSchema = BaseSchema.extend({
  body: z.object({}),
});

export type GrammarStatusReq = z.infer<typeof GrammarStatusSchema>;
