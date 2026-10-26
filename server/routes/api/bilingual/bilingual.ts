import Router from "@koa/router";
import auth from "@server/middlewares/authentication";
import { rateLimiter } from "@server/middlewares/rateLimiter";
import { transaction } from "@server/middlewares/transaction";
import validate from "@server/middlewares/validate";
import bilingualCreator from "@server/commands/bilingualCreator";
import { BilingualPair, Document } from "@server/models";
import { authorize } from "@server/policies";
import {
  presentBilingualPair,
  presentDocument,
  presentPolicies,
} from "@server/presenters";
import type { APIContext } from "@server/types";
import { RateLimiterStrategy } from "@server/utils/RateLimiter";
import * as T from "./schema";

const router = new Router();

router.post(
  "bilingual.create",
  auth(),
  rateLimiter(RateLimiterStrategy.TenPerMinute),
  validate(T.BilingualCreateSchema),
  transaction(),
  async (ctx: APIContext<T.BilingualCreateReq>) => {
    const { documentId, title, collectionId, parentDocumentId, publish } =
      ctx.input.body;

    const { pair, source, target } = await bilingualCreator(ctx, {
      documentId,
      title,
      collectionId,
      parentDocumentId,
      publish,
    });

    ctx.body = {
      data: {
        pair: presentBilingualPair(pair),
        source: await presentDocument(ctx, source),
        target: await presentDocument(ctx, target),
      },
      policies: presentPolicies(ctx.state.auth.user, [source, target]),
    };
  }
);

router.post(
  "bilingual.info",
  auth(),
  rateLimiter(RateLimiterStrategy.OneHundredPerMinute),
  validate(T.BilingualInfoSchema),
  async (ctx: APIContext<T.BilingualInfoReq>) => {
    const { documentId } = ctx.input.body;
    const { user } = ctx.state.auth;

    const document = await Document.findByPk(documentId, {
      userId: user.id,
      rejectOnEmpty: true,
    });
    authorize(user, "read", document);

    const pair = await BilingualPair.findForDocument(document.id);
    let source: Document | null = null;
    let target: Document | null = null;

    if (pair) {
      source = await Document.findByPk(pair.sourceDocumentId, {
        userId: user.id,
        rejectOnEmpty: false,
      });
      target = await Document.findByPk(pair.targetDocumentId, {
        userId: user.id,
        rejectOnEmpty: false,
      });
    }

    ctx.body = {
      data: {
        pair: pair && source && target ? presentBilingualPair(pair) : null,
        source: source ? await presentDocument(ctx, source) : null,
        target: target ? await presentDocument(ctx, target) : null,
      },
      policies: presentPolicies(
        user,
        [document, source, target].filter(Boolean) as Document[]
      ),
    };
  }
);

router.post(
  "bilingual.list",
  auth(),
  rateLimiter(RateLimiterStrategy.OneHundredPerMinute),
  validate(T.BilingualListSchema),
  async (ctx: APIContext<T.BilingualListReq>) => {
    const { user } = ctx.state.auth;

    const pairs = await BilingualPair.findAll({
      where: { teamId: user.teamId },
      order: [["updatedAt", "DESC"]],
    });

    // Titles are resolved with a separate query rather than an eager load,
    // which would drag in the Document model's default scopes. The userId
    // scope restricts results to documents the requesting user can read, so
    // titles of private documents never leak to other members.
    const documentIds = [
      ...new Set(
        pairs.flatMap((pair) => [pair.sourceDocumentId, pair.targetDocumentId])
      ),
    ];
    const documents = await Document.findByIds(documentIds, {
      userId: user.id,
      includeState: false,
      includeViews: false,
      attributes: ["id", "title", "collectionId"],
    });
    const documentsById = new Map(documents.map((doc) => [doc.id, doc]));

    ctx.body = {
      data: {
        pairs: pairs.map((pair) => ({
          ...presentBilingualPair(pair),
          sourceTitle:
            documentsById.get(pair.sourceDocumentId)?.title ?? "",
          targetTitle:
            documentsById.get(pair.targetDocumentId)?.title ?? "",
          sourceCollectionId:
            documentsById.get(pair.sourceDocumentId)?.collectionId ?? null,
        })),
      },
    };
  }
);

router.post(
  "bilingual.updateState",
  auth(),
  rateLimiter(RateLimiterStrategy.OneHundredPerMinute),
  validate(T.BilingualUpdateStateSchema),
  transaction(),
  async (ctx: APIContext<T.BilingualUpdateStateReq>) => {
    const { pairId, blockStates } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;

    const pair = await BilingualPair.findByPk(pairId, {
      transaction,
      rejectOnEmpty: true,
    });

    const source = await Document.findByPk(pair.sourceDocumentId, {
      userId: user.id,
      transaction,
      rejectOnEmpty: true,
    });
    authorize(user, "update", source);

    // Replace the array rather than mutating it in place.
    pair.set("blockStates", blockStates);
    await pair.save({ transaction });

    ctx.body = {
      data: { pair: presentBilingualPair(pair) },
    };
  }
);

router.post(
  "bilingual.realign",
  auth(),
  rateLimiter(RateLimiterStrategy.TenPerMinute),
  validate(T.BilingualRealignSchema),
  transaction(),
  async (ctx: APIContext<T.BilingualRealignReq>) => {
    const { pairId } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;

    const pair = await BilingualPair.findByPk(pairId, {
      transaction,
      rejectOnEmpty: true,
    });

    const source = await Document.findByPk(pair.sourceDocumentId, {
      userId: user.id,
      transaction,
      rejectOnEmpty: true,
    });
    authorize(user, "update", source);

    // Count the top-level blocks of the source document's stored content and
    // rebuild the state array, preserving state for surviving indices.
    const sourceBlocks = source.content?.content?.length ?? 0;
    const existing = pair.blockStates ?? [];
    const blockStates = Array.from({ length: sourceBlocks }, (_, index) =>
      existing[index] ?? {
        status: "empty",
        sourceHash: "",
        autoText: "",
      }
    );

    pair.set("blockStates", blockStates);
    await pair.save({ transaction });

    ctx.body = {
      data: { pair: presentBilingualPair(pair) },
    };
  }
);

export default router;
