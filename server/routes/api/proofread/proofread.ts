import { createHash } from "node:crypto";
import Router from "@koa/router";
import { Hour } from "@shared/utils/time";
import { TeamPreference } from "@shared/types";
import auth from "@server/middlewares/authentication";
import { rateLimiter } from "@server/middlewares/rateLimiter";
import validate from "@server/middlewares/validate";
import Logger from "@server/logging/Logger";
import { Team } from "@server/models";
import { CacheHelper } from "@server/utils/CacheHelper";
import { InternalError } from "@server/errors";
import type { APIContext } from "@server/types";
import { RateLimiterStrategy } from "@server/utils/RateLimiter";
import { PROOFREAD_NOT_CONFIGURED, proofread } from "@server/services/proofread";
import * as T from "./schema";

const router = new Router();

/** Cache expiry for proofread results. */
const PROOFREAD_CACHE_TTL = Hour.seconds;

/** Upstream concurrency for one batch request. */
const BATCH_CONCURRENCY = 5;

/** The validated outcome of checking one text. */
interface ProofreadResult {
  suggestions: unknown;
  unconfigured?: boolean;
}

/** One batch result entry as returned to the client. */
interface BatchResult {
  id: string;
  suggestions?: unknown;
  unconfigured?: boolean;
  error?: string;
}

/**
 * The cache scope from the workspace's bound proofread model, so switching
 * models never serves the previous model's suggestions from the cache.
 *
 * @param teamId The workspace id.
 * @returns The binding string, or "auto" when unbound.
 */
async function resolveScope(teamId: string): Promise<string> {
  const team = await Team.findByPk(teamId, { rejectOnEmpty: true });
  const binding = team.getPreference(TeamPreference.ProofreadModel);
  return typeof binding === "string" && binding ? binding : "auto";
}

/**
 * The proofread cache key for one text.
 *
 * @param scope The cache scope from the bound proofread model.
 * @param text The checked text.
 * @returns The cache key.
 */
function proofreadCacheKey(scope: string, text: string): string {
  const hash = createHash("sha256").update(text.trim()).digest("hex");
  return `proofread:${scope}:${hash}`;
}

/**
 * Checks one text, serving and refreshing the shared result cache. A missing
 * proofread model is cached like an empty result so repeated checks do not
 * re-resolve the channel every time.
 *
 * @param teamId The workspace id.
 * @param scope The cache scope from the bound proofread model.
 * @param text The text to check.
 * @returns The validated suggestions.
 * @throws InternalError when the upstream call fails.
 */
async function checkText(
  teamId: string,
  scope: string,
  text: string
): Promise<ProofreadResult> {
  const cacheKey = proofreadCacheKey(scope, text);
  const cached = await CacheHelper.getData<ProofreadResult>(cacheKey);

  if (cached) {
    return cached;
  }

  try {
    const response = await proofread({
      teamId,
      text,
    });
    const result: ProofreadResult = {
      suggestions: response.suggestions,
    };

    await CacheHelper.setData(cacheKey, result, PROOFREAD_CACHE_TTL);
    return result;
  } catch (err) {
    if (err instanceof Error && err.name === PROOFREAD_NOT_CONFIGURED) {
      const result: ProofreadResult = {
        suggestions: [],
        unconfigured: true,
      };

      await CacheHelper.setData(cacheKey, result, PROOFREAD_CACHE_TTL);
      return result;
    }

    Logger.error("proofread.check failed", err as Error);
    throw InternalError(
      err instanceof Error
        ? err.message
        : "Proofread failed, please try again later"
    );
  }
}

/**
 * Checks a set of items with bounded concurrency, preserving the input
 * order. Failed items surface per-entry errors instead of failing the whole
 * batch, so one bad block never blocks the others.
 *
 * @param teamId The workspace id.
 * @param scope The cache scope from the bound proofread model.
 * @param items The texts to check, with client-assigned identifiers.
 * @returns One result per input item, in input order.
 */
async function checkBatchItems(
  teamId: string,
  scope: string,
  items: {
    id: string;
    text: string;
  }[]
): Promise<BatchResult[]> {
  const results: BatchResult[] = new Array(items.length);
  let cursor = 0;

  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];

      try {
        const result = await checkText(teamId, scope, item.text);
        results[index] = {
          id: item.id,
          suggestions: result.suggestions,
          ...(result.unconfigured
            ? {
                unconfigured: true,
              }
            : {}),
        };
      } catch (err) {
        results[index] = {
          id: item.id,
          error:
            err instanceof Error
              ? err.message
              : "Proofread failed, please try again later",
        };
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(BATCH_CONCURRENCY, items.length) }, () =>
      worker()
    )
  );

  return results;
}

router.post(
  "proofread.check",
  auth(),
  rateLimiter(RateLimiterStrategy.TwentyFivePerMinute),
  validate(T.ProofreadCheckSchema),
  async (ctx: APIContext<T.ProofreadCheckReq>) => {
    const { text } = ctx.input.body;
    const { user } = ctx.state.auth;

    const scope = await resolveScope(user.teamId);
    const result = await checkText(user.teamId, scope, text);

    ctx.body = {
      data: result,
    };
  }
);

router.post(
  "proofread.checkBatch",
  auth(),
  rateLimiter(RateLimiterStrategy.TwentyFivePerMinute),
  validate(T.ProofreadCheckBatchSchema),
  async (ctx: APIContext<T.ProofreadCheckBatchReq>) => {
    const { items } = ctx.input.body;
    const { user } = ctx.state.auth;

    const scope = await resolveScope(user.teamId);
    const results = await checkBatchItems(user.teamId, scope, items);

    ctx.body = {
      data: {
        results,
      },
    };
  }
);

export default router;
