import { z } from "zod";
import { BaseSchema } from "@server/routes/api/schema";

export const ProofreadCheckSchema = BaseSchema.extend({
  body: z.object({
    /** The text to check; one block of English writing. */
    text: z.string().min(1).max(5000),
  }),
});

export type ProofreadCheckReq = z.infer<typeof ProofreadCheckSchema>;

export const ProofreadCheckBatchSchema = BaseSchema.extend({
  body: z.object({
    /** The texts to check, one entry per selected block. */
    items: z
      .array(
        z.object({
          /** Client-assigned identifier echoed back per result. */
          id: z.string().max(64),
          /** The text to check; one block of English writing. */
          text: z.string().min(1).max(5000),
        })
      )
      .min(1)
      .max(20),
  }),
});

export type ProofreadCheckBatchReq = z.infer<typeof ProofreadCheckBatchSchema>;
