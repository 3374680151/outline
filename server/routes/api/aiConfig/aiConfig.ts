import Router from "@koa/router";
import auth from "@server/middlewares/authentication";
import { rateLimiter } from "@server/middlewares/rateLimiter";
import { transaction } from "@server/middlewares/transaction";
import validate from "@server/middlewares/validate";
import Logger from "@server/logging/Logger";
import { Team, TeamAiConfig } from "@server/models";
import { authorize } from "@server/policies";
import type { APIContext } from "@server/types";
import { RateLimiterStrategy } from "@server/utils/RateLimiter";
import env from "@server/env";
import fetch from "@server/utils/fetch";
import { decryptSecret, encryptSecret } from "@server/utils/crypto";
import languageToolClient from "@server/utils/LanguageToolClient";
import { loadTeamTranslationConfig } from "@server/services/translation/teamConfig";
import * as T from "./schema";

const router = new Router();

/** Provider ids that can be listed with metadata for the settings UI. */
const PROVIDER_LABELS: Record<string, string> = {
  "openai-compatible": "OpenAI Compatible",
  deepl: "DeepL",
  languagetool: "LanguageTool",
};

/** Whitelisted provider ids for configuration, in display order. */
const CONFIGURABLE = ["openai-compatible", "deepl", "languagetool"] as const;

/** The tail of an API key that is safe to show as a reminder. */
function keyHint(apiKeyEncrypted: string | null): string | undefined {
  if (!apiKeyEncrypted) {
    return undefined;
  }

  try {
    const key = decryptSecret(apiKeyEncrypted);
    return key.length > 4 ? key.slice(-4) : "••••";
  } catch (_err) {
    return "••••";
  }
}

/**
 * Resolves the effective credentials for a test attempt: explicit overrides
 * first, then the stored workspace configuration, then environment variables.
 *
 * @param ctx the API context.
 * @param providerId The provider to resolve.
 * @param overrides Optional overrides from the request body.
 * @returns The effective base URL, API key, and model.
 */
async function resolveTestCredentials(
  ctx: APIContext<T.AiConfigTestReq>,
  providerId: string,
  overrides: { baseUrl?: string; apiKey?: string; model?: string }
): Promise<{ baseUrl?: string; apiKey?: string; model?: string }> {
  const { user } = ctx.state.auth;
  const teamConfig = await loadTeamTranslationConfig(user.teamId);
  const stored = teamConfig.configs.get(providerId);

  return {
    baseUrl:
      overrides.baseUrl ||
      stored?.baseUrl ||
      (providerId === "openai-compatible" ? env.OPENAI_BASE_URL ?? undefined : undefined),
    apiKey:
      overrides.apiKey ||
      stored?.apiKey ||
      (providerId === "deepl" ? env.DEEPL_API_KEY ?? undefined : undefined) ||
      (providerId === "openai-compatible" ? env.OPENAI_API_KEY ?? undefined : undefined),
    model: overrides.model || stored?.model || env.OPENAI_TRANSLATION_MODEL,
  };
}

router.post(
  "aiConfig.info",
  auth(),
  rateLimiter(RateLimiterStrategy.OneHundredPerMinute),
  validate(T.AiConfigInfoSchema),
  async (ctx: APIContext<T.AiConfigInfoReq>) => {
    const { user } = ctx.state.auth;
    const team = await Team.findByPk(user.teamId, { rejectOnEmpty: true });
    authorize(user, "update", team);

    const rows = await TeamAiConfig.mapForTeam(user.teamId);
    const providers = CONFIGURABLE.map((providerId) => {
      const row = rows.get(providerId);

      return {
        providerId,
        label: PROVIDER_LABELS[providerId],
        baseUrl: row?.baseUrl ?? null,
        model: row?.model ?? null,
        hasApiKey: !!row?.apiKeyEncrypted,
        keyHint: keyHint(row?.apiKeyEncrypted ?? null),
        isDefault: row?.isDefault ?? false,
        fromEnvironment: {
          "openai-compatible":
            !!env.OPENAI_BASE_URL && !!env.OPENAI_API_KEY,
          deepl: !!env.DEEPL_API_KEY,
          languagetool: !!env.LANGUAGETOOL_URL,
        }[providerId],
      };
    });

    ctx.body = {
      data: {
        providers,
        languageTool: {
          configured: languageToolClient.isConfiguredFor(
            rows.get("languagetool")?.baseUrl ?? null
          ),
        },
      },
    };
  }
);

router.post(
  "aiConfig.update",
  auth(),
  rateLimiter(RateLimiterStrategy.TenPerMinute),
  validate(T.AiConfigUpdateSchema),
  transaction(),
  async (ctx: APIContext<T.AiConfigUpdateReq>) => {
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;
    const { providerId, baseUrl, apiKey, clearApiKey, model, isDefault } =
      ctx.input.body;

    const team = await Team.findByPk(user.teamId, {
      rejectOnEmpty: true,
      transaction,
    });
    authorize(user, "update", team);

    const [row] = await TeamAiConfig.findOrBuild({
      where: { teamId: user.teamId, providerId },
      defaults: { teamId: user.teamId, providerId },
      transaction,
    });

    if (baseUrl !== undefined) {
      row.baseUrl = baseUrl === "" ? null : baseUrl;
    }

    if (clearApiKey) {
      row.apiKeyEncrypted = null;
    } else if (apiKey !== undefined && apiKey !== "") {
      row.apiKeyEncrypted = encryptSecret(apiKey);
    }

    if (model !== undefined) {
      row.model = model === "" ? null : model;
    }

    if (isDefault === true) {
      await TeamAiConfig.update(
        { isDefault: false },
        { where: { teamId: user.teamId }, transaction }
      );
      row.isDefault = true;
    } else if (isDefault === false) {
      row.isDefault = false;
    }

    await row.save({ transaction });

    ctx.body = {
      data: {
        provider: {
          providerId,
          baseUrl: row.baseUrl,
          model: row.model,
          hasApiKey: !!row.apiKeyEncrypted,
          keyHint: keyHint(row.apiKeyEncrypted),
          isDefault: row.isDefault,
        },
      },
    };
  }
);

/**
 * Runs a minimal live request against a configured service.
 *
 * @param providerId The service to test.
 * @param credentials The effective credentials to use.
 * @returns The latency in milliseconds, or an error message.
 */
async function runConnectionTest(
  providerId: string,
  credentials: { baseUrl?: string; apiKey?: string; model?: string }
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = Date.now();

  try {
    if (providerId === "openai-compatible") {
      if (!credentials.baseUrl || !credentials.apiKey) {
        return { ok: false, latencyMs: 0, error: "not-configured" };
      }

      const response = await fetch(
        `${credentials.baseUrl.replace(/\/$/, "")}/chat/completions`,
        {
          method: "POST",
          timeout: 30000,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${credentials.apiKey}`,
          },
          body: JSON.stringify({
            model: credentials.model,
            max_tokens: 5,
            messages: [{ role: "user", content: "Reply with the word OK" }],
          }),
        }
      );

      if (!response.ok) {
        return {
          ok: false,
          latencyMs: Date.now() - started,
          error: `HTTP ${response.status}`,
        };
      }
    } else if (providerId === "deepl") {
      if (!credentials.apiKey) {
        return { ok: false, latencyMs: 0, error: "not-configured" };
      }

      const host = credentials.apiKey.endsWith(":fx")
        ? "https://api-free.deepl.com"
        : "https://api.deepl.com";

      const response = await fetch(`${host}/v2/usage`, {
        method: "GET",
        timeout: 30000,
        headers: {
          Authorization: `DeepL-Auth-Key ${credentials.apiKey}`,
        },
      });

      if (!response.ok) {
        return {
          ok: false,
          latencyMs: Date.now() - started,
          error: `HTTP ${response.status}`,
        };
      }
    } else if (providerId === "languagetool") {
      const baseUrl = credentials.baseUrl || env.LANGUAGETOOL_URL;

      if (!baseUrl) {
        return { ok: false, latencyMs: 0, error: "not-configured" };
      }

      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/v2/check`, {
        method: "POST",
        timeout: 30000,
        allowPrivateIPAddress: true,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          text: "Hello world.",
          language: "en-US",
        }).toString(),
      });

      if (!response.ok) {
        return {
          ok: false,
          latencyMs: Date.now() - started,
          error: `HTTP ${response.status}`,
        };
      }
    }

    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    Logger.warn("aiConfig test failed", { err });
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

router.post(
  "aiConfig.test",
  auth(),
  rateLimiter(RateLimiterStrategy.TwentyFivePerMinute),
  validate(T.AiConfigTestSchema),
  async (ctx: APIContext<T.AiConfigTestReq>) => {
    const { user } = ctx.state.auth;
    const { providerId, baseUrl, apiKey, model } = ctx.input.body;

    const team = await Team.findByPk(user.teamId, { rejectOnEmpty: true });
    authorize(user, "update", team);

    const credentials = await resolveTestCredentials(
      ctx as APIContext<T.AiConfigTestReq>,
      providerId,
      {
        ...(baseUrl !== undefined ? { baseUrl } : {}),
        ...(apiKey !== undefined ? { apiKey } : {}),
        ...(model !== undefined ? { model } : {}),
      }
    );

    ctx.body = {
      data: await runConnectionTest(providerId, credentials),
    };
  }
);

router.post(
  "aiConfig.models",
  auth(),
  rateLimiter(RateLimiterStrategy.TwentyFivePerMinute),
  validate(T.AiConfigModelsSchema),
  async (ctx: APIContext<T.AiConfigModelsReq>) => {
    const { user } = ctx.state.auth;
    const { baseUrl, apiKey } = ctx.input.body;

    const team = await Team.findByPk(user.teamId, { rejectOnEmpty: true });
    authorize(user, "update", team);

    let key = apiKey;

    if (!key) {
      const row = await TeamAiConfig.findOne({
        where: { teamId: user.teamId, providerId: "openai-compatible" },
        attributes: ["apiKeyEncrypted"],
      });

      if (row?.apiKeyEncrypted) {
        try {
          key = decryptSecret(row.apiKeyEncrypted);
        } catch (_err) {
          key = undefined;
        }
      }
    }

    const response = await fetch(
      `${baseUrl.replace(/\/$/, "")}/models`,
      {
        method: "GET",
        timeout: 15000,
        ...(key ? { headers: { Authorization: `Bearer ${key}` } } : {}),
      }
    );

    if (!response.ok) {
      ctx.body = { data: { models: [], error: `HTTP ${response.status}` } };
      return;
    }

    const data = (await response.json()) as { data?: { id?: string }[] };
    const models = (data.data ?? [])
      .map((entry) => entry.id)
      .filter((id): id is string => !!id)
      .sort();

    ctx.body = { data: { models } };
  }
);

export default router;
