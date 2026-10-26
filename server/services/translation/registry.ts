import env from "@server/env";
import Logger from "@server/logging/Logger";
import type { TranslationProvider, TranslationRequest, TranslationResult } from "./types";
import deepl from "./providers/deepl";
import microsoftFree from "./providers/microsoftFree";
import openaiCompatible from "./providers/openaiCompatible";

/** All known providers by id. */
const PROVIDERS: Record<string, TranslationProvider> = {
  "openai-compatible": openaiCompatible,
  deepl,
  "microsoft-free": microsoftFree,
};

/** Per-provider cooldown until timestamp after a failure, in epoch ms. */
const cooldowns = new Map<string, number>();

/** Duration a provider is skipped after a failure. */
const COOLDOWN_MS = 60000;

/**
 * Returns the providers in the configured order that currently have
 * credentials, skipping providers in their failure cooldown unless all of
 * them are cooling down.
 *
 * @returns The candidate providers for a translation attempt.
 */
function candidates(): TranslationProvider[] {
  const order = env.TRANSLATION_PROVIDER_ORDER.split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  const configured = order
    .map((id) => PROVIDERS[id])
    .filter((provider) => provider?.isConfigured());

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
 * @returns The translation result from the first successful provider.
 * @throws Error when every provider fails.
 */
export async function translateWithFallback(
  texts: string[],
  from: string | undefined,
  to: string,
  signal: AbortSignal
): Promise<TranslationResult> {
  const providers = candidates();
  let lastError: Error | undefined;

  for (const provider of providers) {
    try {
      const results: string[] = [];
      let detectedFrom: string | undefined;

      for (let i = 0; i < texts.length; i += provider.maxBatch) {
        const chunk = texts.slice(i, i + provider.maxBatch);
        const result = await provider.translate({
          texts: chunk,
          from,
          to,
          signal,
        });
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
 * exposed, only availability.
 *
 * @returns Provider descriptors in fallback order.
 */
export function listProviders(): {
  id: string;
  label: string;
  configured: boolean;
}[] {
  return Object.values(PROVIDERS).map((provider) => ({
    id: provider.id,
    label: provider.label,
    configured: provider.isConfigured(),
  }));
}

/**
 * Resolves a specific provider by id, when configured.
 *
 * @param id The provider id.
 * @returns The provider, or undefined when unknown or unconfigured.
 */
export function getConfiguredProvider(
  id: string | undefined
): TranslationProvider | undefined {
  if (!id) {
    return undefined;
  }

  const provider = PROVIDERS[id];
  return provider?.isConfigured() ? provider : undefined;
}

export type { TranslationProvider, TranslationRequest, TranslationResult };
