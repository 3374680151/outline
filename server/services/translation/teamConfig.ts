import Logger from "@server/logging/Logger";
import { TeamAiConfig } from "@server/models";
import { decryptSecret } from "@server/utils/crypto";
import type {
  TeamProviderConfig,
  TeamTranslationConfig,
} from "./types";

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
  const rows = await TeamAiConfig.mapForTeam(teamId);
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

  return { configs, defaultProviderId };
}
