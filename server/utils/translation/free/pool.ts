import { ValidationError } from "@server/errors";
import Logger from "@server/logging/Logger";
import { translateAlibabaText } from "./providers/AlibabaTranslate";
import { translateBilibiliText } from "./providers/BilibiliTranslate";
import { translateGoogleText } from "./providers/GoogleTranslate";
import { translateMicrosoftText } from "./providers/MicrosoftTranslate";
import { translateMyMemoryText } from "./providers/MyMemoryTranslate";
import { translateTransmartText } from "./providers/TransmartTranslate";
import { translateVolcengineText } from "./providers/VolcengineTranslate";
import { translateYoudaoText } from "./providers/YoudaoTranslate";
import type {
  FreeProvider,
  FreeProviderErrorCategory,
  FreeTranslationEngine,
  FreeTranslationResult,
} from "./types";
import { FreeProviderError } from "./types";

/** Bounded per attempt so a hung provider cannot stall the request. */
const PROVIDER_TIMEOUT_MS = 8_000;

/** The whole pool attempt is bounded so the request fails fast enough. */
const TOTAL_BUDGET_MS = 25_000;

/** Cooldown applied immediately after a failure of each category. */
const BASE_COOLDOWN_MS: Record<FreeProviderErrorCategory, number> = {
  request: 0,
  "rate-limit": 5 * 60_000,
  blocked: 6 * 60_000,
  quota: 24 * 60 * 60_000,
  unavailable: 60_000,
};

/** Cooldown growth is capped per category, mirroring FluentRead's policy. */
const MAX_COOLDOWN_MS: Record<FreeProviderErrorCategory, number> = {
  request: 0,
  "rate-limit": 6 * 60 * 60_000,
  blocked: 24 * 60 * 60_000,
  quota: 24 * 60 * 60_000,
  unavailable: 30 * 60_000,
};

interface ProviderHealth {
  failures: number;
  /** Epoch ms before which the provider is skipped, 0 when healthy. */
  retryAt: number;
  /** Exponential moving average of success, between 0 and 1. */
  reliability: number;
}

/**
 * The provider pool, ordered so that the highest weighted providers are
 * preferred when weights tie in tests.
 */
const providers: FreeProvider[] = [
  {
    id: "microsoft",
    weight: 5,
    translate: (text, sourceLanguage, targetLanguage, signal) =>
      translateMicrosoftText(text, sourceLanguage, targetLanguage, signal),
  },
  {
    id: "google",
    weight: 3,
    translate: (text, sourceLanguage, targetLanguage, signal) =>
      translateGoogleText(text, sourceLanguage, targetLanguage, signal),
  },
  {
    id: "transmart",
    weight: 3,
    translate: (text, sourceLanguage, targetLanguage, signal) =>
      translateTransmartText(text, sourceLanguage, targetLanguage, signal),
  },
  {
    id: "volcengine",
    weight: 3,
    translate: (text, sourceLanguage, targetLanguage, signal) =>
      translateVolcengineText(text, sourceLanguage, targetLanguage, signal),
  },
  {
    id: "alibaba",
    weight: 3,
    translate: (text, sourceLanguage, targetLanguage, signal) =>
      translateAlibabaText(text, sourceLanguage, targetLanguage, signal),
  },
  {
    id: "youdao",
    weight: 3,
    translate: (text, sourceLanguage, targetLanguage, signal) =>
      translateYoudaoText(text, sourceLanguage, targetLanguage, signal),
  },
  {
    id: "bilibili",
    weight: 2,
    translate: (text, sourceLanguage, targetLanguage, signal) =>
      translateBilibiliText(text, sourceLanguage, targetLanguage, signal),
  },
  {
    id: "mymemory",
    weight: 1,
    translate: (text, sourceLanguage, targetLanguage, signal) =>
      translateMyMemoryText(text, sourceLanguage, targetLanguage, signal),
  },
];

const healthByEngine = new Map<FreeTranslationEngine, ProviderHealth>();

/**
 * Returns the health record for a provider, creating a fresh one on first
 * use.
 *
 * @param id The provider engine id.
 * @returns The provider health record.
 */
function getHealth(id: FreeTranslationEngine): ProviderHealth {
  const existing = healthByEngine.get(id);

  if (existing) {
    return existing;
  }

  const health: ProviderHealth = {
    failures: 0,
    retryAt: 0,
    reliability: 1,
  };
  healthByEngine.set(id, health);
  return health;
}

/**
 * Picks one of the ready providers by weighted random selection, weighting
 * each provider by its base weight scaled by its reliability.
 *
 * @param ready The providers that are not cooling down.
 * @returns The selected provider.
 */
function pickProvider(ready: FreeProvider[]): FreeProvider {
  const weights = ready.map((provider) =>
    Math.max(
      0.05,
      provider.weight * Math.pow(getHealth(provider.id).reliability, 2)
    )
  );
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = Math.random() * total;

  for (const [index, provider] of ready.entries()) {
    roll -= weights[index];

    if (roll <= 0) {
      return provider;
    }
  }

  return ready[ready.length - 1];
}

/**
 * Translates text through the free provider pool. Providers are attempted
 * one at a time; failed providers are skipped with a category based cooldown
 * so later requests start with the healthy ones.
 *
 * @param text The text to translate.
 * @param sourceLanguage The source language tag, or "auto" to detect it.
 * @param targetLanguage The target language tag, e.g. zh-CN.
 * @returns The translated text and the engine that produced it.
 * @throws ValidationError When every available provider fails or the budget
 * is exhausted.
 */
export async function translateFree(
  text: string,
  sourceLanguage: string,
  targetLanguage: string
): Promise<FreeTranslationResult> {
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  const remaining = [...providers];

  while (remaining.length > 0 && Date.now() < deadline) {
    const now = Date.now();
    const ready = remaining.filter(
      (provider) => getHealth(provider.id).retryAt <= now
    );

    if (ready.length === 0) {
      break;
    }

    const provider = pickProvider(ready);
    remaining.splice(remaining.indexOf(provider), 1);

    const timeout = Math.min(PROVIDER_TIMEOUT_MS, deadline - Date.now());
    if (timeout <= 0) {
      break;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const translated = await provider.translate(
        text,
        sourceLanguage,
        targetLanguage,
        controller.signal
      );

      if (!translated.trim()) {
        throw new Error("Provider returned an empty translation");
      }

      const health = getHealth(provider.id);
      health.failures = 0;
      health.retryAt = 0;
      health.reliability = health.reliability * 0.75 + 0.25;

      return {
        text: translated,
        engine: provider.id,
      };
    } catch (err) {
      const category: FreeProviderErrorCategory =
        err instanceof FreeProviderError ? err.category : "unavailable";
      const health = getHealth(provider.id);
      health.failures += 1;
      health.reliability = health.reliability * 0.75;

      const base = BASE_COOLDOWN_MS[category];
      const max = MAX_COOLDOWN_MS[category];
      const cooldown = Math.min(
        base * Math.pow(2, Math.min(8, health.failures - 1)),
        max
      );
      health.retryAt = Date.now() + cooldown;

      Logger.warn("Free translation provider failed", {
        engine: provider.id,
        category,
        cooldownMs: cooldown,
        err,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  throw ValidationError(
    "Translation services are temporarily unavailable – please try again shortly"
  );
}

/**
 * Clears the in-memory provider cooldowns and health so every provider is
 * attempted again. Used by tests to keep cases independent.
 */
export function resetFreeTranslationPool(): void {
  healthByEngine.clear();
}
