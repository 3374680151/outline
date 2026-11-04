import Router from "@koa/router";
import auth from "@server/middlewares/authentication";
import { rateLimiter } from "@server/middlewares/rateLimiter";
import { transaction } from "@server/middlewares/transaction";
import validate from "@server/middlewares/validate";
import Logger from "@server/logging/Logger";
import { Team, TeamModelProvider, TeamModelProviderModel } from "@server/models";
import { authorize } from "@server/policies";
import type { APIContext } from "@server/types";
import { RateLimiterStrategy } from "@server/utils/RateLimiter";
import { decryptSecret, encryptSecret } from "@server/utils/crypto";
import { executeChat, fetchUpstreamModels } from "@server/services/ai/adaptors";
import * as T from "./modelProviderSchema";

const router = new Router();

/** Timeout for the live connection test chat call. */
const TEST_TIMEOUT = 30000;

/**
 * Computes the display hint for an API key: its last four characters.
 *
 * @param apiKey The plaintext key.
 * @returns The masked hint, or null when no key is given.
 */
function keyHintOf(apiKey: string): string | null {
  return apiKey.length > 4 ? apiKey.slice(-4) : "••••";
}

/**
 * Normalizes a user-entered API key: trims whitespace and rejects keys
 * containing non-ASCII characters, which are almost certainly a mistake.
 *
 * @param apiKey The raw key.
 * @returns The cleaned key.
 */
function cleanAPIKey(apiKey: string): string {
  const trimmed = apiKey.trim();

  if (!/^[\x21-\x7e]+$/.test(trimmed)) {
    throw new Error("API key contains invalid characters");
  }

  return trimmed;
}

/**
 * Presents a provider row for API responses; the key never leaves the server.
 *
 * @param row The stored provider.
 * @param models The model rows of the provider.
 * @returns The masked view.
 */
function presentProvider(
  row: TeamModelProvider,
  models: TeamModelProviderModel[]
) {
  return {
    id: row.id,
    name: row.name,
    vendor: row.vendor ?? "",
    protocol: row.protocol,
    baseUrl: row.baseUrl,
    model: row.model,
    hasApiKey: !!row.apiKeyEncrypted,
    keyHint: row.keyHint ?? undefined,
    enabled: row.enabled,
    models: models
      .sort((a, b) => a.modelId.localeCompare(b.modelId))
      .map((model) => ({
        id: model.modelId,
        enabled: model.enabled,
        source: model.source,
      })),
    modelCount: models.filter((model) => model.enabled).length,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Loads the model rows of a workspace grouped by provider.
 *
 * @param teamId The workspace id.
 * @returns Model rows keyed by provider id.
 */
async function mapModelsForTeam(teamId: string) {
  const grouped = new Map<string, TeamModelProviderModel[]>();
  const providers = await TeamModelProvider.findAll({
    where: { teamId },
    attributes: ["id"],
  });

  if (providers.length === 0) {
    return grouped;
  }

  const modelRows = await TeamModelProviderModel.findAll({
    where: {
      providerId: providers.map((provider) => provider.id),
    },
  });

  for (const row of modelRows) {
    const list = grouped.get(row.providerId) ?? [];
    list.push(row);
    grouped.set(row.providerId, list);
  }

  return grouped;
}

/**
 * Resolves the credentials for a test or model listing attempt: explicit
 * overrides first, then the stored provider row.
 *
 * @param ctx The API context.
 * @param teamId The workspace id.
 * @param props The request fields.
 * @param props.id Optional stored provider id.
 * @param props.protocol Optional protocol override.
 * @param props.baseUrl Optional base URL override.
 * @param props.apiKey Optional API key override.
 * @param props.model Optional model override.
 * @returns The effective credentials.
 */
async function resolveCredentials(
  teamId: string,
  props: {
    id?: string;
    protocol?: string;
    baseUrl?: string;
    apiKey?: string;
    model?: string;
  }
): Promise<{
  protocol: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}> {
  const row = props.id
    ? await TeamModelProvider.findOne({
        where: {
          id: props.id,
          teamId,
        },
      })
    : undefined;

  const protocol = props.protocol ?? row?.protocol ?? "openai";
  const baseUrl = (props.baseUrl ?? row?.baseUrl ?? "").trim();
  let apiKey = props.apiKey?.trim() ?? "";

  if (!apiKey && row?.apiKeyEncrypted) {
    try {
      apiKey = decryptSecret(row.apiKeyEncrypted);
    } catch (err) {
      Logger.warn("Failed to decrypt model provider key", { err });
    }
  }

  return {
    protocol,
    baseUrl,
    apiKey,
    model: props.model ?? row?.model ?? "",
  };
}

router.post(
  "aiModelProviders.info",
  auth(),
  rateLimiter(RateLimiterStrategy.OneHundredPerMinute),
  validate(T.ModelProviderInfoSchema),
  async (ctx: APIContext<T.ModelProviderInfoReq>) => {
    const { user } = ctx.state.auth;
    const team = await Team.findByPk(user.teamId, { rejectOnEmpty: true });
    authorize(user, "update", team);

    const rows = await TeamModelProvider.findAll({
      where: { teamId: user.teamId },
      order: [
        ["createdAt", "ASC"],
        ["id", "ASC"],
      ],
    });
    const models = await mapModelsForTeam(user.teamId);

    ctx.body = {
      data: {
        providers: rows.map((row) => presentProvider(row, models.get(row.id) ?? [])),
      },
    };
  }
);

router.post(
  "aiModelProviders.create",
  auth(),
  rateLimiter(RateLimiterStrategy.TenPerMinute),
  validate(T.ModelProviderCreateSchema),
  transaction(),
  async (ctx: APIContext<T.ModelProviderCreateReq>) => {
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;
    const { name, vendor, protocol, baseUrl, apiKey, model, enabled } =
      ctx.input.body;

    const team = await Team.findByPk(user.teamId, {
      rejectOnEmpty: true,
      transaction,
    });
    authorize(user, "update", team);

    const cleanedKey = apiKey ? cleanAPIKey(apiKey) : "";

    const row = await TeamModelProvider.create(
      {
        teamId: user.teamId,
        name: name.trim(),
        vendor: vendor?.trim() || null,
        protocol,
        baseUrl: baseUrl.trim(),
        apiKeyEncrypted: cleanedKey ? encryptSecret(cleanedKey) : null,
        keyHint: cleanedKey ? keyHintOf(cleanedKey) : null,
        model: model?.trim() || null,
        enabled: enabled ?? true,
      },
      { transaction }
    );

    ctx.body = {
      data: {
        provider: presentProvider(row, []),
      },
    };
  }
);

router.post(
  "aiModelProviders.update",
  auth(),
  rateLimiter(RateLimiterStrategy.TenPerMinute),
  validate(T.ModelProviderUpdateSchema),
  transaction(),
  async (ctx: APIContext<T.ModelProviderUpdateReq>) => {
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;
    const { id, name, vendor, protocol, baseUrl, apiKey, clearApiKey, model, enabled } =
      ctx.input.body;

    const team = await Team.findByPk(user.teamId, {
      rejectOnEmpty: true,
      transaction,
    });
    authorize(user, "update", team);

    const row = await TeamModelProvider.findOne({
      where: {
        id,
        teamId: user.teamId,
      },
      rejectOnEmpty: true,
      transaction,
    });

    if (name !== undefined) {
      row.name = name.trim();
    }

    if (vendor !== undefined) {
      row.vendor = vendor.trim() || null;
    }

    if (protocol !== undefined) {
      row.protocol = protocol;
    }

    if (baseUrl !== undefined) {
      row.baseUrl = baseUrl.trim();
    }

    if (clearApiKey) {
      row.apiKeyEncrypted = null;
      row.keyHint = null;
    } else if (apiKey !== undefined && apiKey !== "") {
      const cleanedKey = cleanAPIKey(apiKey);
      row.apiKeyEncrypted = encryptSecret(cleanedKey);
      row.keyHint = keyHintOf(cleanedKey);
    }

    if (model !== undefined) {
      row.model = model.trim() || null;
    }

    if (enabled !== undefined) {
      row.enabled = enabled;
    }

    await row.save({ transaction });

    const models = await TeamModelProviderModel.findAll({
      where: { providerId: row.id },
    });

    ctx.body = {
      data: {
        provider: presentProvider(row, models),
      },
    };
  }
);

router.post(
  "aiModelProviders.delete",
  auth(),
  rateLimiter(RateLimiterStrategy.TenPerMinute),
  validate(T.ModelProviderDeleteSchema),
  transaction(),
  async (ctx: APIContext<T.ModelProviderDeleteReq>) => {
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;
    const { id } = ctx.input.body;

    const team = await Team.findByPk(user.teamId, {
      rejectOnEmpty: true,
      transaction,
    });
    authorize(user, "update", team);

    const row = await TeamModelProvider.findOne({
      where: {
        id,
        teamId: user.teamId,
      },
      rejectOnEmpty: true,
      transaction,
    });

    await row.destroy({ transaction });

    ctx.body = {
      data: {
        id,
      },
    };
  }
);

router.post(
  "aiModelProviders.setModels",
  auth(),
  rateLimiter(RateLimiterStrategy.TwentyFivePerMinute),
  validate(T.ModelProviderSetModelsSchema),
  transaction(),
  async (ctx: APIContext<T.ModelProviderSetModelsReq>) => {
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;
    const { id, models } = ctx.input.body;

    const team = await Team.findByPk(user.teamId, {
      rejectOnEmpty: true,
      transaction,
    });
    authorize(user, "update", team);

    const row = await TeamModelProvider.findOne({
      where: {
        id,
        teamId: user.teamId,
      },
      rejectOnEmpty: true,
      transaction,
    });

    const existing = await TeamModelProviderModel.findAll({
      where: { providerId: row.id },
      transaction,
    });
    const enabledSet = new Set(models);

    // Rows not in the incoming set are disabled rather than deleted so the
    // model history stays readable (FluentRead-Go semantics).
    for (const model of existing) {
      const nextEnabled = enabledSet.has(model.modelId);
      if (model.enabled !== nextEnabled) {
        model.enabled = nextEnabled;
        await model.save({ transaction });
      }
      enabledSet.delete(model.modelId);
    }

    // Remaining ids are new upstream models; store them enabled.
    for (const modelId of enabledSet) {
      await TeamModelProviderModel.create(
        {
          providerId: row.id,
          modelId,
          enabled: true,
          source: "auto",
        },
        { transaction }
      );
    }

    const all = await TeamModelProviderModel.findAll({
      where: { providerId: row.id },
      transaction,
    });

    ctx.body = {
      data: {
        provider: presentProvider(row, all),
      },
    };
  }
);

router.post(
  "aiModelProviders.addModel",
  auth(),
  rateLimiter(RateLimiterStrategy.TwentyFivePerMinute),
  validate(T.ModelProviderAddModelSchema),
  transaction(),
  async (ctx: APIContext<T.ModelProviderAddModelReq>) => {
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;
    const { id, model } = ctx.input.body;

    const team = await Team.findByPk(user.teamId, {
      rejectOnEmpty: true,
      transaction,
    });
    authorize(user, "update", team);

    const row = await TeamModelProvider.findOne({
      where: {
        id,
        teamId: user.teamId,
      },
      rejectOnEmpty: true,
      transaction,
    });

    const existing = await TeamModelProviderModel.findOne({
      where: {
        providerId: row.id,
        modelId: model.trim(),
      },
      transaction,
    });

    if (existing) {
      existing.enabled = true;
      existing.source = "manual";
      await existing.save({ transaction });
    } else {
      await TeamModelProviderModel.create(
        {
          providerId: row.id,
          modelId: model.trim(),
          enabled: true,
          source: "manual",
        },
        { transaction }
      );
    }

    const all = await TeamModelProviderModel.findAll({
      where: { providerId: row.id },
      transaction,
    });

    ctx.body = {
      data: {
        provider: presentProvider(row, all),
      },
    };
  }
);

/**
 * Runs a minimal live chat request against the resolved credentials.
 *
 * @param credentials The credentials to test.
 * @returns The latency, the model used, or an error message.
 */
async function runConnectionTest(credentials: {
  protocol: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}): Promise<{
  ok: boolean;
  latencyMs: number;
  model?: string;
  error?: string;
}> {
  const started = Date.now();

  if (!credentials.baseUrl || !credentials.apiKey) {
    return {
      ok: false,
      latencyMs: 0,
      error: "not-configured",
    };
  }

  if (!credentials.model) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: "no-model",
    };
  }

  try {
    await executeChat({
      baseUrl: credentials.baseUrl,
      apiKey: credentials.apiKey,
      protocol: credentials.protocol,
      timeout: TEST_TIMEOUT,
      req: {
        model: credentials.model,
        messages: [
          {
            role: "user",
            content: "Reply with the word OK",
          },
        ],
        temperature: 0,
        maxTokens: 5,
      },
    });

    return {
      ok: true,
      latencyMs: Date.now() - started,
      model: credentials.model,
    };
  } catch (err) {
    Logger.warn("aiModelProviders test failed", { err });
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

router.post(
  "aiModelProviders.test",
  auth(),
  rateLimiter(RateLimiterStrategy.TwentyFivePerMinute),
  validate(T.ModelProviderTestSchema),
  async (ctx: APIContext<T.ModelProviderTestReq>) => {
    const { user } = ctx.state.auth;
    const { id, protocol, baseUrl, apiKey, model } = ctx.input.body;

    const team = await Team.findByPk(user.teamId, { rejectOnEmpty: true });
    authorize(user, "update", team);

    const credentials = await resolveCredentials(user.teamId, {
      ...(id ? { id } : {}),
      ...(protocol ? { protocol } : {}),
      ...(baseUrl ? { baseUrl } : {}),
      ...(apiKey ? { apiKey } : {}),
      ...(model ? { model } : {}),
    });

    ctx.body = {
      data: await runConnectionTest(credentials),
    };
  }
);

router.post(
  "aiModelProviders.models",
  auth(),
  rateLimiter(RateLimiterStrategy.TwentyFivePerMinute),
  validate(T.ModelProviderModelsSchema),
  async (ctx: APIContext<T.ModelProviderModelsReq>) => {
    const { user } = ctx.state.auth;
    const { id, protocol, baseUrl, apiKey } = ctx.input.body;

    const team = await Team.findByPk(user.teamId, { rejectOnEmpty: true });
    authorize(user, "update", team);

    const credentials = await resolveCredentials(user.teamId, {
      ...(id ? { id } : {}),
      ...(protocol ? { protocol } : {}),
      ...(baseUrl ? { baseUrl } : {}),
      ...(apiKey ? { apiKey } : {}),
    });

    if (!credentials.baseUrl) {
      ctx.body = {
        data: {
          models: [],
          error: "not-configured",
        },
      };
      return;
    }

    try {
      const models = await fetchUpstreamModels({
        baseUrl: credentials.baseUrl,
        apiKey: credentials.apiKey,
        protocol: credentials.protocol,
      });

      ctx.body = {
        data: {
          models,
        },
      };
    } catch (err) {
      ctx.body = {
        data: {
          models: [],
          error: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }
);

export default router;
