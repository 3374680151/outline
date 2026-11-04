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

router.post(
  "proofread.check",
  auth(),
  rateLimiter(RateLimiterStrategy.TwentyFivePerMinute),
  validate(T.ProofreadCheckSchema),
  async (ctx: APIContext<T.ProofreadCheckReq>) => {
    const { text } = ctx.input.body;
    const { user } = ctx.state.auth;

    // Results are scoped to the bound proofread model so switching models
    // never serves the previous model's suggestions from the cache.
    const team = await Team.findByPk(user.teamId, { rejectOnEmpty: true });
    const binding = team.getPreference(TeamPreference.ProofreadModel);
    const scope =
      typeof binding === "string" && binding ? binding : "auto";

    const hash = createHash("sha256").update(text.trim()).digest("hex");
    const cacheKey = `proofread:${scope}:${hash}`;
    const cached = await CacheHelper.getData<{
      suggestions: unknown;
      unconfigured?: boolean;
    }>(cacheKey);

    if (cached) {
      ctx.body = {
        data: cached,
      };
      return;
    }

    let result: {
      suggestions: unknown;
      unconfigured?: boolean;
    };

    try {
      const response = await proofread({
        teamId: user.teamId,
        text,
      });
      result = {
        suggestions: response.suggestions,
      };
    } catch (err) {
      if (err instanceof Error && err.name === PROOFREAD_NOT_CONFIGURED) {
        result = {
          suggestions: [],
          unconfigured: true,
        };
      } else {
        Logger.error("proofread.check failed", err as Error);
        throw InternalError(
          err instanceof Error
            ? err.message
            : "Proofread failed, please try again later"
        );
      }
    }

    await CacheHelper.setData(cacheKey, result, PROOFREAD_CACHE_TTL);

    ctx.body = {
      data: result,
    };
  }
);

export default router;
