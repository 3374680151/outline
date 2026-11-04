import { z } from "zod";
import { BaseSchema } from "@server/routes/api/schema";

export const ProofreadCheckSchema = BaseSchema.extend({
  body: z.object({
    /** The text to check; one block of English writing. */
    text: z.string().min(1).max(5000),
  }),
});

export type ProofreadCheckReq = z.infer<typeof ProofreadCheckSchema>;
