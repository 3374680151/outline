import { z } from "zod";
import { BaseSchema } from "@server/routes/api/schema";
import { zodIdType } from "@server/utils/zod";

const BilingualBlockStateSchema = z.object({
  /** Translation status of the block. */
  status: z.enum([
    "empty",
    "pending",
    "auto",
    "manual",
    "stale",
    "failed",
    "skipped",
  ]),

  /** Hash of the source text at the time of the last translation attempt. */
  sourceHash: z.string().max(32).default(""),

  /** The last text automatically written into the mirror document. */
  autoText: z.string().max(100000).default(""),

  /** Failure reason when status is "failed". */
  error: z.string().max(500).optional(),
});

export const BilingualCreateSchema = BaseSchema.extend({
  body: z.object({
    /** Id of an existing document to turn into the source of a pair. */
    documentId: zodIdType().optional(),

    /** Title for a newly created source document. */
    title: z.string().max(100).optional(),

    /** Collection to create the source document in. */
    collectionId: zodIdType().optional(),

    /** Parent document to nest the source document under. */
    parentDocumentId: zodIdType().optional(),

    /** Whether a newly created source document should be published. */
    publish: z.boolean().optional(),
  }),
});

export type BilingualCreateReq = z.infer<typeof BilingualCreateSchema>;

export const BilingualInfoSchema = BaseSchema.extend({
  body: z.object({
    /** Id of a document on either side of a pair. */
    documentId: zodIdType(),
  }),
});

export type BilingualInfoReq = z.infer<typeof BilingualInfoSchema>;

export const BilingualListSchema = BaseSchema.extend({
  body: z.object({}),
});

export type BilingualListReq = z.infer<typeof BilingualListSchema>;

export const BilingualUpdateStateSchema = BaseSchema.extend({
  body: z.object({
    /** The pair to update. */
    pairId: zodIdType(),

    /** The full replacement block state array, index parallel to source blocks. */
    blockStates: z.array(BilingualBlockStateSchema).max(5000),
  }),
});

export type BilingualUpdateStateReq = z.infer<typeof BilingualUpdateStateSchema>;

export const BilingualRealignSchema = BaseSchema.extend({
  body: z.object({
    /** The pair to realign block state for. */
    pairId: zodIdType(),
  }),
});

export type BilingualRealignReq = z.infer<typeof BilingualRealignSchema>;
