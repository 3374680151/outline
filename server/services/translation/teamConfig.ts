import Logger from "@server/logging/Logger";
import {
  TeamAiConfig,
  TeamModelProvider,
  TeamModelProviderModel,
} from "@server/models";
import { decryptSecret } from "@server/utils/crypto";
import type { ModelProviderProtocol } from "@shared/aiVendorTemplates";
import type {
  TeamModelProviderConfig,
  TeamProviderConfig,
  TeamTranslationConfig,
} from "./types";

/**
 * Resolves the effective model of a provider row: the default model when
 * set, otherwise the first enabled model of the row.
 *
 * @param row The provider row.
 * @returns The model id, or null when the provider has none.
 */
async function resolveModel(row: TeamModelProvider): Promise<string | null> {
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

  return firstEnabled?.modelId ?? null;
}

/**
 * Loads and decrypts the AI service configuration of a workspace. A config
 * row whose key fails to decrypt (e.g. after a SECRET_KEY rotation) is
 * treated as unset so the provider falls back to environment credentials
 * rather than erroring every request.
 *
 * @param teamId The workspace to load configuration for.
 * @returns The decrypted per-provider configuration.
 */
export async function loadTeamTranslationConfig(
  teamId: string
): Promise<TeamTranslationConfig> {
  const [rows, providerRows] = await Promise.all([
    TeamAiConfig.mapForTeam(teamId),
    TeamModelProvider.listEnabled(teamId),
  ]);

  const configs = new Map<string, TeamProviderConfig>();
  let defaultProviderId: string | null = null;

  for (const [providerId, row] of rows) {
    if (row.isDefault) {
      defaultProviderId = providerId;
    }

    let apiKey: string | null = null;

    if (row.apiKeyEncrypted) {
      try {
        apiKey = decryptSecret(row.apiKeyEncrypted);
      } catch (err) {
        Logger.warn(`Failed to decrypt AI config for ${providerId}`, { err });
      }
    }

    configs.set(providerId, {
      baseUrl: row.baseUrl,
      apiKey,
      model: row.model,
    });
  }

  const modelProviders: TeamModelProviderConfig[] = [];

  for (const row of providerRows) {
    if (!row.baseUrl) {
      continue;
    }

    let apiKey: string | null = null;

    if (row.apiKeyEncrypted) {
      try {
        apiKey = decryptSecret(row.apiKeyEncrypted);
      } catch (err) {
        Logger.warn(`Failed to decrypt model provider key for ${row.name}`, {
          err,
        });
      }
    }

    if (!apiKey) {
      continue;
    }

    modelProviders.push({
      id: row.id,
      name: row.name,
      protocol: row.protocol as ModelProviderProtocol,
      baseUrl: row.baseUrl,
      apiKey,
      model: await resolveModel(row),
    });
  }

  return { configs, defaultProviderId, modelProviders };
}
