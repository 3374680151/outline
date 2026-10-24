import Router from "@koa/router";
import { UserRole } from "@shared/types";
import { ValidationError } from "@server/errors";
import Logger from "@server/logging/Logger";
import auth from "@server/middlewares/authentication";
import { rateLimiter } from "@server/middlewares/rateLimiter";
import { transaction } from "@server/middlewares/transaction";
import validate from "@server/middlewares/validate";
import { Team } from "@server/models";
import { authorize } from "@server/policies";
import { presentPolicies, presentTeam } from "@server/presenters";
import type { APIContext } from "@server/types";
import { RateLimiterStrategy } from "@server/utils/RateLimiter";
import { translateFree } from "@server/utils/translation/free";
import * as T from "./schema";

const router = new Router();

/** Prompt modeled on the MIT-licensed openai-translator project. */
const TRANSLATION_SYSTEM_PROMPT = `You are a highly skilled translation engine. Translate the user's text into the language indicated by its BCP-47 tag. Output only the translation, with no explanations, quotes, or surrounding text. Preserve the original meaning, tone, formatting, and line breaks. If the text is already in the target language, return it unchanged.`;

const REQUEST_TIMEOUT_MS = 60_000;

type TranslationConfig = {
  baseUrl: string;
  model: string;
  targetLanguage: string;
  apiKey: string;
};

/**
 * Calls the configured OpenAI-compatible chat completions API and returns the
 * translated text.
 *
 * @param text The text to translate.
 * @param config The workspace translation configuration.
 * @param sourceLanguage The BCP-47 source language tag, or "auto".
 * @returns The translated text.
 * @throws ValidationError When the upstream service fails or times out.
 */
async function translateText(
  text: string,
  config: TranslationConfig,
  sourceLanguage: string
): Promise<string> {
  const endpoint = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const sourceHint = sourceLanguage === "auto" ? "" : ` from ${sourceLanguage}`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.1,
        messages: [
          { role: "system", content: TRANSLATION_SYSTEM_PROMPT },
          {
            role: "user",
            content: `Translate the following text${sourceHint} into ${config.targetLanguage}:\n\n${text}`,
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      Logger.warn("Translation service returned an error", {
        status: response.status,
        detail: detail.slice(0, 500),
      });
      throw ValidationError("The translation service returned an error");
    }

    const json = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const output = json.choices?.[0]?.message?.content?.trim();

    if (!output) {
      throw ValidationError("The translation service returned an empty result");
    }

    return output;
  } catch (err) {
    if (err instanceof ValidationError) {
      throw err;
    }
    if (err instanceof Error && err.name === "AbortError") {
      throw ValidationError("The translation request timed out");
    }
    Logger.warn("Unable to reach the translation service", {
      err,
    });
    throw ValidationError("Unable to reach the translation service");
  } finally {
    clearTimeout(timeout);
  }
}

router.post(
  "translations.updateConfig",
  rateLimiter(RateLimiterStrategy.TwentyFivePerMinute),
  auth({ role: UserRole.Admin }),
  validate(T.TranslationsUpdateConfigSchema),
  transaction(),
  async (ctx: APIContext<T.TranslationsUpdateConfigReq>) => {
    const { transaction } = ctx.state;
    const { user } = ctx.state.auth;
    const { baseUrl, model, targetLanguage, apiKey } = ctx.input.body;

    const team = await Team.findByPk(user.teamId, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    authorize(user, "update", team);

    team.translationSettings = { baseUrl, model, targetLanguage };

    // An empty key keeps the previously stored key so other settings can be
    // updated without re-entering the secret.
    if (apiKey) {
      team.translationApiKey = apiKey;
    }

    const updatedTeam = await team.saveWithCtx(ctx);

    ctx.body = {
      data: presentTeam(updatedTeam),
      policies: presentPolicies(user, [updatedTeam]),
    };
  }
);

router.post(
  "translations.translate",
  rateLimiter(RateLimiterStrategy.OneHundredPerMinute),
  auth(),
  validate(T.TranslationsTranslateSchema),
  async (ctx: APIContext<T.TranslationsTranslateReq>) => {
    const {
      text,
      sourceLanguage = "auto",
      targetLanguage: requestedTarget,
    } = ctx.input.body;
    const { user } = ctx.state.auth;

    // A configured LLM takes precedence; otherwise the built-in free provider
    // pool is used so translation works without any workspace configuration.
    const config = user.team.getTranslationConfig();

    if (config) {
      const translated = await translateText(
        text,
        {
          ...config,
          targetLanguage: requestedTarget ?? config.targetLanguage,
        },
        sourceLanguage
      );
      ctx.body = {
        data: {
          text: translated,
          engine: "llm",
        },
      };
      return;
    }

    const targetLanguage =
      requestedTarget ??
      user.team.translationSettings?.targetLanguage ??
      "zh-CN";
    const result = await translateFree(text, sourceLanguage, targetLanguage);

    ctx.body = {
      data: result,
    };
  }
);

export default router;
