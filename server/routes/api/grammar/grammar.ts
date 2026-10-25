import Router from "@koa/router";
import { Hour } from "@shared/utils/time";
import { TeamPreference } from "@shared/types";
import auth from "@server/middlewares/authentication";
import { rateLimiter } from "@server/middlewares/rateLimiter";
import validate from "@server/middlewares/validate";
import { Team } from "@server/models";
import { CacheHelper } from "@server/utils/CacheHelper";
import { createHash } from "node:crypto";
import languageToolClient from "@server/utils/LanguageToolClient";
import type { APIContext } from "@server/types";
import { RateLimiterStrategy } from "@server/utils/RateLimiter";
import * as T from "./schema";

const router = new Router();

/** Cache expiry for text-level grammar results. */
const GRAMMAR_CACHE_TTL = Hour.seconds;

/**
 * Computes the cache key for a grammar check.
 *
 * @param language The language long code.
 * @param level The rule level.
 * @param disabledRules The disabled rule ids.
 * @param text The checked text.
 * @returns The cache key.
 */
function grammarCacheKey(
  language: string,
  level: string,
  disabledRules: string,
  text: string
): string {
  const hash = createHash("sha256")
    .update(`${language}:${level}:${disabledRules}:${text}`)
    .digest("hex");
  return `grammar:${hash}`;
}

router.post(
  "grammar.check",
  auth(),
  rateLimiter(RateLimiterStrategy.OneHundredPerMinute),
  validate(T.GrammarCheckSchema),
  async (ctx: APIContext<T.GrammarCheckReq>) => {
    const { user } = ctx.state.auth;
    const { text, language, level, mode, disabledRules } = ctx.input.body;

    const team = await Team.findByPk(user.teamId, {
      attributes: ["id", "preferences"],
    });
    const teamDisabled = team?.getPreference(TeamPreference.GrammarDisabledRules) ?? "";
    const allDisabled = [teamDisabled, disabledRules]
      .filter((entry) => !!entry)
      .join(",");

    const cacheKey = grammarCacheKey(language, level, allDisabled, text);
    const cached = await CacheHelper.getData<{
      available: boolean;
      reason?: string;
      matches?: unknown[];
      language?: string;
    }>(cacheKey);

    if (cached) {
      ctx.body = { data: cached };
      return;
    }

    const result = await languageToolClient.check({
      text,
      language,
      level,
      mode,
      disabledRules: allDisabled || undefined,
    });

    if (result.available) {
      await CacheHelper.setData(
        cacheKey,
        { available: true, matches: result.matches, language: result.language },
        GRAMMAR_CACHE_TTL
      );
      ctx.body = {
        data: {
          available: true,
          matches: result.matches,
          language: result.language,
        },
      };
      return;
    }

    ctx.body = { data: { available: false, reason: result.reason } };
  }
);

router.post(
  "grammar.status",
  auth(),
  rateLimiter(RateLimiterStrategy.OneHundredPerMinute),
  validate(T.GrammarStatusSchema),
  async (ctx: APIContext<T.GrammarStatusReq>) => {
    const { user } = ctx.state.auth;
    const team = await Team.findByPk(user.teamId, {
      attributes: ["id", "preferences"],
    });
    const enabled = team?.getPreference(TeamPreference.GrammarChecking) ?? true;

    ctx.body = {
      data: {
        configured: languageToolClient.isConfigured,
        enabled,
      },
    };
  }
);

export default router;
