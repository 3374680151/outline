import env from "@server/env";
import Logger from "@server/logging/Logger";
import type {
  TeamTranslationConfig,
  TranslationProvider,
  TranslationRequest,
  TranslationResult,
} from "./types";
import deepl from "./providers/deepl";
import microsoftFree from "./providers/microsoftFree";
import {
  MODEL_PROVIDER_ID_PREFIX,
  modelProviderTranslationProvider,
} from "./providers/modelProvider";
import openaiCompatible from "./providers/openaiCompatible";

/** All known static providers by id. */
const STATIC_PROVIDERS: Record<string, TranslationProvider> = {
  "openai-compatible": openaiCompatible,
  deepl,
  "microsoft-free": microsoftFree,
};

/**
 * Builds the translation providers backed by the workspace's enabled model
 * gateways, in configuration order.
 *
 * @param team The workspace AI configuration, when available.
 * @returns The model gateway providers.
 */
function modelProviders(
  team?: TeamTranslationConfig | null
): TranslationProvider[] {
  return (team?.modelProviders ?? []).map((mp) =>
    modelProviderTranslationProvider(mp)
  );
}

/**
 * Finds a provider by id across the static registry and the workspace's
 * model gateways.
 *
 * @param id The provider id.
 * @param team The workspace AI configuration, when available.
 * @returns The provider, or undefined when unknown.
 */
function findProvider(
  id: string,
  team?: TeamTranslationConfig | null
): TranslationProvider | undefined {
  if (id.startsWith(MODEL_PROVIDER_ID_PREFIX)) {
    const mpId = id.slice(MODEL_PROVIDER_ID_PREFIX.length);
    const mp = team?.modelProviders.find((entry) => entry.id === mpId);
    return mp ? modelProviderTranslationProvider(mp) : undefined;
  }

  return STATIC_PROVIDERS[id];
}

/** Per-provider cooldown until timestamp after a failure, in epoch ms. */
const cooldowns = new Map<string, number>();

/** Duration a provider is skipped after a failure. */
const COOLDOWN_MS = 60000;

/**
 * Returns the providers in the configured order that currently have
 * credentials, skipping providers in their failure cooldown unless all of
 * them are cooling down. The workspace's model gateways are tried first,
 * then the static chain in the configured order.
 *
 * @param team The workspace AI configuration, when available.
 * @returns The candidate providers for a translation attempt.
 */
function candidates(
  team?: TeamTranslationConfig | null
): TranslationProvider[] {
  const order = env.TRANSLATION_PROVIDER_ORDER.split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  const staticList = order
    .map((id) => STATIC_PROVIDERS[id])
    .filter((provider) => provider !== undefined);

  const configured = [...modelProviders(team), ...staticList].filter(
    (provider) => provider.isConfigured(team?.configs.get(provider.id))
  );

  const now = Date.now();
  const ready = configured.filter(
    (provider) => (cooldowns.get(provider.id) ?? 0) <= now
  );

  // When everything is cooling down, try the full list anyway so a total
  // outage of the primary providers does not take the endpoint down.
  return ready.length > 0 ? ready : configured;
}

/**
 * Translates a batch of texts, trying the configured providers in order and
 * falling through to the next on failure. Batches larger than the active
 * provider's maxBatch are split into sequential requests.
 *
 * @param texts The texts to translate.
 * @param from Optional source language hint.
 * @param to The target language.
 * @param signal Signal to abort the attempt.
 * @param team The workspace AI configuration, when available.
 * @returns The translation result from the first successful provider.
 * @throws Error when every provider fails.
 */
export async function translateWithFallback(
  texts: string[],
  from: string | undefined,
  to: string,
  signal: AbortSignal,
  team?: TeamTranslationConfig | null
): Promise<TranslationResult> {
  const providers = candidates(team);
  let lastError: Error | undefined;

  for (const provider of providers) {
    const config = team?.configs.get(provider.id);

    try {
      const results: string[] = [];
      let detectedFrom: string | undefined;

      for (let i = 0; i < texts.length; i += provider.maxBatch) {
        const chunk = texts.slice(i, i + provider.maxBatch);
        const result = await provider.translate(
          {
            texts: chunk,
            from,
            to,
            signal,
          },
          config
        );
        results.push(...result.results);
        detectedFrom = detectedFrom ?? result.detectedFrom;
      }

      cooldowns.delete(provider.id);
      return { results, detectedFrom: detectedFrom ?? from };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      cooldowns.set(provider.id, Date.now() + COOLDOWN_MS);
      Logger.warn(`Provider ${provider.id} failed, falling back`, { err });
    }
  }

  throw lastError ?? new Error("No translation provider is configured");
}

/**
 * Lists the configured providers for the settings UI. No credentials are
 * exposed, only availability. Workspace model gateways come first.
 *
 * @param team The workspace AI configuration, when available.
 * @returns Provider descriptors in fallback order.
 */
export function listProviders(team?: TeamTranslationConfig | null): {
  id: string;
  label: string;
  configured: boolean;
  isDefault: boolean;
}[] {
  const dynamic = modelProviders(team).map((provider) => ({
    id: provider.id,
    label: provider.label,
    configured: provider.isConfigured(undefined),
    isDefault: false,
  }));

  const staticList = Object.values(STATIC_PROVIDERS).map((provider) => ({
    id: provider.id,
    label: provider.label,
    configured: provider.isConfigured(team?.configs.get(provider.id)),
    isDefault: team?.defaultProviderId === provider.id,
  }));

  return [...dynamic, ...staticList];
}

/**
 * Resolves a specific provider by id, when configured.
 *
 * @param id The provider id.
 * @param team The workspace AI configuration, when available.
 * @returns The provider, or undefined when unknown or unconfigured.
 */
export function getConfiguredProvider(
  id: string | undefined,
  team?: TeamTranslationConfig | null
): TranslationProvider | undefined {
  if (!id) {
    return undefined;
  }

  const provider = findProvider(id, team);
  return provider?.isConfigured(team?.configs.get(provider.id))
    ? provider
    : undefined;
}

export type {
  TeamTranslationConfig,
  TranslationProvider,
  TranslationRequest,
  TranslationResult,
};
