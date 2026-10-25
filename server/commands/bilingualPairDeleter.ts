import { Document } from "@server/models";
import type BilingualPair from "@server/models/BilingualPair";
import { authorize } from "@server/policies";
import type { APIContext } from "@server/types";

/**
 * Cascades the deletion of one side of a bilingual pair to the other side and
 * the pair row itself, within the caller's transaction. Used by the
 * documents.delete route so that deleting a bilingual document never leaves a
 * dangling mirror document behind.
 *
 * @param ctx the API context containing the acting user and transaction.
 * @param pair The pair to cascade from.
 * @param deletedDocumentId The document id that is about to be deleted.
 */
export default async function bilingualPairDeleter(
  ctx: APIContext,
  pair: BilingualPair,
  deletedDocumentId: string
): Promise<void> {
  const { user } = ctx.state.auth;
  const { transaction } = ctx.state;
  const twinId =
    pair.sourceDocumentId === deletedDocumentId
      ? pair.targetDocumentId
      : pair.sourceDocumentId;

  const twin = await Document.findByPk(twinId, { userId: user.id, transaction });

  if (twin) {
    authorize(user, "delete", twin);
    await twin.destroyWithCtx(ctx);
  }

  await pair.destroy({ transaction });
}
