import env from "@server/env";
import Logger from "@server/logging/Logger";
import {
  TeamAiConfig,
  TeamModelProvider,
  TeamModelProviderModel,
} from "@server/models";
import { decryptSecret } from "@server/utils/crypto";
import {
  type ModelBinding,
  modelBinding as encodeBinding,
  parseModelBinding as parseBinding,
} from "@shared/utils/aiModelBinding";

/**
 * Resolves the effective model of a provider row: the default model when
 * set, otherwise the first enabled model of the row.
 *
 * @param row The provider row.
 * @param override Optional model name that wins over both.
 * @returns The model id, or an empty string when the provider has none.
 */
async function resolveModel(
  row: TeamModelProvider,
  override?: string
): Promise<string> {
  if (override) {
    return override;
  }

  if (row.model) {
    return row.model;
  }

  const firstEnabled = await TeamModelProviderModel.findOne({
    where: {
      providerId: row.id,
      enabled: true,
    },
    order: [["modelId", "ASC"]],
  });

  return firstEnabled?.modelId ?? "";
}

/** A resolved chat channel: where to send a completion request. */
export interface ChatChannel {
  /** The provider row id, or null for the environment fallback. */
  providerId: string | null;
  /** The display name of the channel, for logging and errors. */
  label: string;
  /** The wire protocol. */
  protocol: string;
  /** The endpoint base URL. */
  baseUrl: string;
  /** The decrypted API key. */
  apiKey: string;
  /** The model to invoke. */
  model: string;
}

/**
 * Encodes a model binding value for storage in team preferences.
 *
 * @param providerId The provider row id.
 * @param model Optional model name overriding the provider default.
 * @returns The binding value, e.g. "mp:{uuid}:{model}".
 */
export function modelBinding(providerId: string, model?: string): string {
  return encodeBinding(providerId, model);
}

/**
 * Parses a model binding value from team preferences.
 *
 * @param binding The stored binding value.
 * @returns The provider id and optional model, or null when malformed.
 */
export function parseModelBinding(binding: string): ModelBinding | null {
  return parseBinding(binding);
}

/**
 * Decrypts a provider row's API key, returning null on failure so the caller
 * can skip the provider rather than erroring every request.
 *
 * @param row The provider row.
 * @returns The decrypted key, or null.
 */
function decryptProviderKey(row: TeamModelProvider): string | null {
  if (!row.apiKeyEncrypted) {
    return null;
  }

  try {
    return decryptSecret(row.apiKeyEncrypted);
  } catch (err) {
    Logger.warn(`Failed to decrypt model provider key for ${row.name}`, {
      err,
    });
    return null;
  }
}

/**
 * Resolves the chat channel to use for an LLM feature.
 *
 * Resolution order: an explicit binding (a configured provider, optionally
 * with a model override), then the workspace's first enabled provider, then
 * the environment's OpenAI-compatible credentials. Returns null when nothing
 * is configured, which callers should surface as a "not configured" state.
 *
 * @param teamId The workspace to resolve for.
 * @param binding Optional binding value from team preferences.
 * @returns The channel, or null when unconfigured.
 */
export async function resolveChatChannel(
  teamId: string,
  binding?: string | null
): Promise<ChatChannel | null> {
  const parsed = binding ? parseModelBinding(binding) : null;

  if (parsed) {
    const row = await TeamModelProvider.findOne({
      where: {
        id: parsed.providerId,
        teamId,
        enabled: true,
      },
    });

    if (row) {
      const apiKey = decryptProviderKey(row);

      if (apiKey && row.baseUrl) {
        return {
          providerId: row.id,
          label: row.name,
          protocol: row.protocol,
          baseUrl: row.baseUrl,
          apiKey,
          model: await resolveModel(row, parsed.model),
        };
      }
    }
  }

  const rows = await TeamModelProvider.listEnabled(teamId);

  for (const row of rows) {
    const apiKey = decryptProviderKey(row);

    if (apiKey && row.baseUrl) {
      return {
        providerId: row.id,
        label: row.name,
        protocol: row.protocol,
        baseUrl: row.baseUrl,
        apiKey,
        model: await resolveModel(row),
      };
    }
  }

  // Fall back to the static provider credentials managed on the AI services
  // settings page, so a workspace that only configured those still gets a
  // chat channel instead of silently skipping to the environment.
  const aiConfig = await TeamAiConfig.findOne({
    where: {
      teamId,
      providerId: "openai-compatible",
    },
  });

  if (aiConfig?.baseUrl && aiConfig.apiKeyEncrypted) {
    try {
      const apiKey = decryptSecret(aiConfig.apiKeyEncrypted);

      if (apiKey) {
        return {
          providerId: null,
          label: "OpenAI Compatible",
          protocol: "openai",
          baseUrl: aiConfig.baseUrl,
          apiKey,
          model: aiConfig.model ?? env.OPENAI_TRANSLATION_MODEL,
        };
      }
    } catch (err) {
      Logger.warn("Failed to decrypt the AI config channel", { err });
    }
  }

  if (env.OPENAI_BASE_URL && env.OPENAI_API_KEY) {
    return {
      providerId: null,
      label: "OpenAI Compatible",
      protocol: "openai",
      baseUrl: env.OPENAI_BASE_URL,
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_TRANSLATION_MODEL,
    };
  }

  return null;
}
