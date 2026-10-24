import { z } from "zod";
import { BaseSchema } from "../schema";

export const GrammarCheckSchema = BaseSchema.extend({
  body: z.object({
    /** The text to check */
    text: z.string().min(1).max(5000),
    /** BCP-47 tag of the language to check against, en-US when omitted */
    language: z.string().min(2).max(35).optional(),
  }),
});

export type GrammarCheckReq = z.infer<typeof GrammarCheckSchema>;
