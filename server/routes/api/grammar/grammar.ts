import Router from "@koa/router";
import { Hour } from "@shared/utils/time";
import { TeamPreference } from "@shared/types";
import auth from "@server/middlewares/authentication";
import { rateLimiter } from "@server/middlewares/rateLimiter";
import validate from "@server/middlewares/validate";
import Logger from "@server/logging/Logger";
import { Team, TeamAiConfig } from "@server/models";
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
 * Loads the workspace configured LanguageTool server URL, if any.
 *
 * @param teamId The workspace to load the override for.
 * @returns The configured base URL, or null.
 */
async function languageToolBaseUrl(teamId: string): Promise<string | null> {
  const row = await TeamAiConfig.findOne({
    where: { teamId, providerId: "languagetool" },
    attributes: ["baseUrl"],
  });
  return row?.baseUrl ?? null;
}

/**
 * Computes the cache key for a grammar check.
 *
 * @param language The language long code.
 * @param level The rule level.
 * @param mode The rule mode.
 * @param disabledRules The disabled rule ids.
 * @param text The checked text.
 * @returns The cache key.
 */
function grammarCacheKey(
  language: string,
  level: string,
  mode: string,
  disabledRules: string,
  text: string
): string {
  const hash = createHash("sha256")
    .update(`${language}:${level}:${mode}:${disabledRules}:${text}`)
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

    const cacheKey = grammarCacheKey(language, level, mode, allDisabled, text);
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

    const result = await languageToolClient.check(
      {
        text,
        language,
        level,
        mode,
        disabledRules: allDisabled || undefined,
      },
      { baseUrl: await languageToolBaseUrl(user.teamId) }
    );

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
        configured: languageToolClient.isConfiguredFor(
          await languageToolBaseUrl(user.teamId)
        ),
        enabled,
      },
    };
  }
);

/** Result entry for one item of a batch check. */
interface BatchResult {
  id: string;
  available: boolean;
  reason?: string;
  matches?: unknown[];
}

/**
 * Runs up to five LanguageTool checks concurrently, so a batch of blocks
 * costs one HTTP round trip from the client without stampeding the sidecar.
 *
 * @param items The cache misses to check.
 * @param params The shared check parameters.
 * @param disabledRules The merged disabled rule ids.
 * @returns One result per item, in input order.
 */
async function checkConcurrently(
  items: { id: string; text: string; cacheKey: string }[],
  params: { language: string; level: string; mode: string; baseUrl: string | null },
  disabledRules: string
): Promise<BatchResult[]> {
  const results = new Map<number, BatchResult>();
  const concurrency = 5;
  let cursor = 0;

  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index];

      try {
        const result = await languageToolClient.check(
          {
            text: item.text,
            language: params.language,
            level: params.level,
            mode: params.mode,
            disabledRules: disabledRules || undefined,
          },
          { baseUrl: params.baseUrl }
        );

        if (result.available) {
          await CacheHelper.setData(
            item.cacheKey,
            {
              available: true,
              matches: result.matches,
              language: result.language,
            },
            GRAMMAR_CACHE_TTL
          );
          results.set(index, {
            id: item.id,
            available: true,
            matches: result.matches,
          });
        } else {
          results.set(index, {
            id: item.id,
            available: false,
            reason: result.reason,
          });
        }
      } catch (err) {
        Logger.warn("grammar batch check failed", { err });
        results.set(index, {
          id: item.id,
          available: false,
          reason: "unavailable",
        });
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker)
  );

  return items.map((item, index) =>
    results.get(index) ?? { id: item.id, available: false, reason: "unavailable" }
  );
}

router.post(
  "grammar.checkBatch",
  auth(),
  rateLimiter(RateLimiterStrategy.TwentyFivePerMinute),
  validate(T.GrammarCheckBatchSchema),
  async (ctx: APIContext<T.GrammarCheckBatchReq>) => {
    const { user } = ctx.state.auth;
    const { items, language, level, mode, disabledRules } = ctx.input.body;

    const team = await Team.findByPk(user.teamId, {
      attributes: ["id", "preferences"],
    });
    const teamDisabled = team?.getPreference(TeamPreference.GrammarDisabledRules) ?? "";
    const allDisabled = [teamDisabled, disabledRules]
      .filter((entry) => !!entry)
      .join(",");

    const misses: { id: string; text: string; cacheKey: string }[] = [];
    const results: BatchResult[] = [];

    await Promise.all(
      items.map(async (item) => {
        const cacheKey = grammarCacheKey(
          language,
          level,
          mode,
          allDisabled,
          item.text
        );
        const cached = await CacheHelper.getData<{
          available: boolean;
          reason?: string;
          matches?: unknown[];
        }>(cacheKey);

        if (cached) {
          results.push({ id: item.id, ...cached });
          return;
        }

        misses.push({ id: item.id, text: item.text, cacheKey });
      })
    );

    if (misses.length > 0) {
      const checked = await checkConcurrently(
        misses,
        { language, level, mode, baseUrl: await languageToolBaseUrl(user.teamId) },
        allDisabled
      );
      results.push(...checked);
    }

    ctx.body = { data: { results } };
  }
);

export default router;
