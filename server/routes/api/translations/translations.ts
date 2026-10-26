import { createHash } from "node:crypto";
import Router from "@koa/router";
import { Day } from "@shared/utils/time";
import auth from "@server/middlewares/authentication";
import { rateLimiter } from "@server/middlewares/rateLimiter";
import validate from "@server/middlewares/validate";
import Logger from "@server/logging/Logger";
import { CacheHelper } from "@server/utils/CacheHelper";
import { InvalidRequestError, InternalError } from "@server/errors";
import type { APIContext } from "@server/types";
import { RateLimiterStrategy } from "@server/utils/RateLimiter";
import {
  getConfiguredProvider,
  listProviders,
  translateWithFallback,
} from "@server/services/translation/registry";
import { lookupWordWithAI } from "@server/services/translation/providers/openaiCompatible";
import * as T from "./schema";

const router = new Router();

/** Cache expiry for translation results. */
const TRANSLATION_CACHE_TTL = Day.seconds;

/**
 * Matches text that contains only CJK characters, CJK punctuation, digits,
 * and whitespace – translating it into Chinese is a no-op, so it is passed
 * through without an upstream call.
 */
const PURE_CJK =
  /^[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef\s\d.,!?;:'"()\-—–…·]+$/;

/**
 * Computes the cache key for one translated text.
 *
 * @param providerKey The provider id or "chain" for fallback translation.
 * @param from The source language hint or "auto".
 * @param to The target language.
 * @param text The text to translate.
 * @returns The cache key.
 */
function translationCacheKey(
  providerKey: string,
  from: string,
  to: string,
  text: string
): string {
  const hash = createHash("sha256").update(text).digest("hex");
  return `translation:${providerKey}:${from}:${to}:${hash}`;
}

router.post(
  "translations.providers",
  auth(),
  rateLimiter(RateLimiterStrategy.OneHundredPerMinute),
  validate(T.TranslationsProvidersSchema),
  async (ctx: APIContext<T.TranslationsProvidersReq>) => {
    ctx.body = {
      data: {
        providers: listProviders(),
      },
    };
  }
);

router.post(
  "translations.translate",
  auth(),
  rateLimiter(RateLimiterStrategy.TwentyFivePerMinute),
  validate(T.TranslationsTranslateSchema),
  async (ctx: APIContext<T.TranslationsTranslateReq>) => {
    const { text, texts: bodyTexts, from, to, provider: providerId } =
      ctx.input.body;

    const input = bodyTexts ?? (text !== undefined ? [text] : []);

    if (input.length === 0) {
      throw InvalidRequestError("Either text or texts is required");
    }

    const provider = getConfiguredProvider(providerId);

    if (providerId && !provider) {
      throw InvalidRequestError(
        `Translation provider "${providerId}" is not configured`
      );
    }

    const providerKey = provider?.id ?? "chain";
    const fromKey = from ?? "auto";
    const results: (string | undefined)[] = Array.from({ length: input.length });
    const misses: { index: number; text: string; cacheKey: string }[] = [];

    await Promise.all(
      input.map(async (item, index) => {
        if (PURE_CJK.test(item)) {
          // Pure CJK content does not need a round trip to become Chinese.
          results[index] = item;
          return;
        }

        const cacheKey = translationCacheKey(providerKey, fromKey, to, item);
        const cached = await CacheHelper.getData<string>(cacheKey);

        if (cached !== undefined) {
          results[index] = cached;
          return;
        }

        misses.push({ index, text: item, cacheKey });
      })
    );

    if (misses.length > 0) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 65000);

      try {
        const translated = provider
          ? await provider.translate({
              texts: misses.map((miss) => miss.text),
              from,
              to,
              signal: controller.signal,
            })
          : await translateWithFallback(
              misses.map((miss) => miss.text),
              from,
              to,
              controller.signal
            );

        await Promise.all(
          misses.map((miss, missIndex) => {
            const value = translated.results[missIndex];
            results[miss.index] = value;

            return value
              ? CacheHelper.setData(
                  miss.cacheKey,
                  value,
                  TRANSLATION_CACHE_TTL
                )
              : Promise.resolve();
          })
        );
      } catch (err) {
        Logger.error("translations.translate failed", err as Error);
        throw InternalError("Translation failed, please try again later");
      } finally {
        clearTimeout(timeout);
      }
    }

    ctx.body = {
      data: {
        results,
        to,
      },
    };
  }
);

router.post(
  "translations.word",
  auth(),
  rateLimiter(RateLimiterStrategy.TwentyFivePerMinute),
  validate(T.TranslationsWordSchema),
  async (ctx: APIContext<T.TranslationsWordReq>) => {
    const { word, context, to } = ctx.input.body;
    const cacheKey = `word-lookup:${to}:${createHash("sha256")
      .update(`${word}|${context ?? ""}`)
      .digest("hex")}`;

    const cached = await CacheHelper.getData<Record<string, unknown>>(cacheKey);

    if (cached) {
      ctx.body = { data: cached };
      return;
    }

    let result: Record<string, unknown> | undefined;

    try {
      const entry = await lookupWordWithAI(word, context, new AbortController().signal);

      if (entry) {
        result = { available: true, entry };
        await CacheHelper.setData(cacheKey, result, TRANSLATION_CACHE_TTL * 7);
      }
    } catch (err) {
      Logger.warn("translations.word failed", { err });
    }

    if (!result) {
      // No AI provider configured or lookup failed – the client falls back
      // to the plain translation card.
      result = { available: false };
    }

    ctx.body = { data: result };
  }
);

export default router;
