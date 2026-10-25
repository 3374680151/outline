import Router from "@koa/router";
import { z } from "zod";
import env from "@server/env";
import { ValidationError } from "@server/errors";
import Logger from "@server/logging/Logger";
import auth from "@server/middlewares/authentication";
import { rateLimiter } from "@server/middlewares/rateLimiter";
import validate from "@server/middlewares/validate";
import type { APIContext } from "@server/types";
import { RateLimiterStrategy } from "@server/utils/RateLimiter";
import * as T from "./schema";

const router = new Router();

const REQUEST_TIMEOUT_MS = 30_000;

/** BCP-47 tag used for checking when the client does not specify one. */
const DEFAULT_LANGUAGE = "auto";

/** How long proxied language and rule listings stay cached. */
const CONFIG_CACHE_MS = 60 * 60 * 1000;

const LanguageToolMatchSchema = z.object({
  message: z.string(),
  shortMessage: z.string().optional(),
  offset: z.number(),
  length: z.number(),
  replacements: z.array(z.object({ value: z.string() })).optional(),
  context: z
    .object({
      text: z.string(),
      offset: z.number(),
      length: z.number(),
    })
    .optional(),
  type: z.object({ typeName: z.string() }).optional(),
  rule: z
    .object({
      id: z.string().optional(),
      issueType: z.string().optional(),
      description: z.string().optional(),
      urls: z.array(z.object({ value: z.string() })).optional(),
      category: z
        .object({
          id: z.string().optional(),
          name: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

const LanguageToolResponseSchema = z.object({
  matches: z.array(LanguageToolMatchSchema),
  language: z
    .object({
      code: z.string().optional(),
      detectedLanguage: z
        .object({
          code: z.string().optional(),
          name: z.string().optional(),
          confidence: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
  warnings: z.object({ incompleteResults: z.boolean().optional() }).optional(),
});

const LanguageToolLanguageSchema = z.object({
  name: z.string(),
  code: z.string(),
  longCode: z.string(),
});

const LanguageToolRuleSchema = z.object({
  ruleId: z.string(),
  description: z.string().optional(),
  isDefaultOff: z.string().optional(),
  categoryId: z.string().optional(),
  categoryName: z.string().optional(),
  locQualityIssueType: z.string().optional(),
});

const LanguageToolConfigSchema = z.object({
  software: z.object({ version: z.string().optional() }).optional(),
  rules: z.array(LanguageToolRuleSchema),
});

/** A single grammar, spelling or style issue returned to the client. */
export type GrammarMatch = {
  message: string;
  shortMessage?: string;
  /** Offset of the issue within the checked text, in UTF-16 code units */
  offset: number;
  length: number;
  /** Suggested corrections, best first */
  replacements: { value: string }[];
  /** The issue shown within its surrounding text */
  context?: { text: string; offset: number; length: number };
  issueType?: string;
  ruleId?: string;
  /** Human description of the rule, shown in the issue card */
  ruleDescription?: string;
  /** External pages explaining the rule, shown in the issue card */
  ruleUrls: string[];
  categoryName?: string;
};

/** The result of a grammar check returned to the client. */
export type GrammarCheckResult = {
  matches: GrammarMatch[];
  /** The BCP-47 tag of the language the text was detected as */
  detectedLanguage?: string;
  /** Whether the service returned only partial results */
  incompleteResults?: boolean;
};

/** A language supported by the grammar service. */
export type GrammarLanguage = {
  name: string;
  code: string;
  longCode: string;
};

/** A rule of a language as listed by the grammar service. */
export type GrammarRule = {
  ruleId: string;
  description?: string;
  isDefaultOff?: string;
  categoryId?: string;
  categoryName?: string;
  locQualityIssueType?: string;
};

/** The user-tunable options of a grammar check. */
interface CheckOptions {
  language?: string;
  motherTongue?: string;
  preferredVariants?: string[];
  level?: "default" | "picky";
  disabledCategories?: string[];
  disabledRules?: string[];
}

/** Cached language listing. */
let languagesCache: { at: number; value: GrammarLanguage[] } | undefined;

/** Cached rule listings, keyed by language. */
const rulesCache = new Map<string, { at: number; value: GrammarRule[] }>();

/**
 * Returns the configured LanguageTool base URL.
 *
 * @returns The base URL of the grammar service.
 * @throws ValidationError When grammar checking is not configured.
 */
function serviceUrl(): string {
  const baseUrl = env.LANGUAGE_TOOL_URL;

  if (!baseUrl) {
    throw ValidationError(
      "Grammar checking is not configured on this installation"
    );
  }

  return baseUrl;
}

/**
 * Fetches a URL from the grammar service, mapping failures to validation
 * errors with a stable message.
 *
 * @param path The path to fetch, starting with a slash.
 * @param init Extra fetch options, e.g. the POST body.
 * @returns The parsed JSON response.
 * @throws ValidationError When the service is unreachable or returns an error.
 */
async function request(path: string, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${serviceUrl()}${path}`, {
      ...init,
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      Logger.warn("LanguageTool returned an error", {
        status: response.status,
        detail: detail.slice(0, 500),
      });
      throw response.status === 429
        ? ValidationError(
            "The grammar service is rate limited, try again shortly"
          )
        : ValidationError("The grammar service returned an error");
    }

    return await response.json();
  } catch (err) {
    if (err instanceof ValidationError) {
      throw err;
    }
    if (err instanceof Error && err.name === "AbortError") {
      throw ValidationError("The grammar check timed out");
    }
    Logger.warn("Unable to reach the grammar service", {
      err,
    });
    throw ValidationError("Unable to reach the grammar service");
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Checks the text against the configured LanguageTool server and returns the
 * grammar, spelling and style issues found.
 *
 * @param text The text to check.
 * @param options The user-tunable check options to pass through.
 * @returns The matches found and the detected language.
 * @throws ValidationError When grammar checking is not configured, the
 * service is unreachable or returns an unexpected response.
 */
async function checkText(
  text: string,
  options: CheckOptions
): Promise<GrammarCheckResult> {
  const language = options.language ?? DEFAULT_LANGUAGE;
  const params = new URLSearchParams({
    text,
    language,
    allowIncompleteResults: "true",
  });

  if (options.motherTongue) {
    params.set("motherTongue", options.motherTongue);
  }

  // The service only accepts variant preferences together with detection.
  if (options.preferredVariants?.length && language === DEFAULT_LANGUAGE) {
    params.set("preferredVariants", options.preferredVariants.join(","));
  }

  if (options.level) {
    params.set("level", options.level);
  }

  if (options.disabledCategories?.length) {
    params.set("disabledCategories", options.disabledCategories.join(","));
  }

  if (options.disabledRules?.length) {
    params.set("disabledRules", options.disabledRules.join(","));
  }

  const json = LanguageToolResponseSchema.parse(
    await request("/v2/check", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    })
  );

  return {
    matches: json.matches.map(presentMatch),
    detectedLanguage: json.language?.detectedLanguage?.code,
    incompleteResults: json.warnings?.incompleteResults,
  };
}

/**
 * Maps a LanguageTool match to the DTO returned to the client.
 *
 * @param match The match reported by LanguageTool.
 * @returns The presented match.
 */
function presentMatch(
  match: z.infer<typeof LanguageToolMatchSchema>
): GrammarMatch {
  return {
    message: match.message,
    shortMessage: match.shortMessage,
    offset: match.offset,
    length: match.length,
    replacements: match.replacements ?? [],
    context: match.context,
    issueType: match.rule?.issueType ?? match.type?.typeName,
    ruleId: match.rule?.id,
    ruleDescription: match.rule?.description,
    ruleUrls: (match.rule?.urls ?? []).map((url) => url.value),
    categoryName: match.rule?.category?.name ?? match.rule?.category?.id,
  };
}

/**
 * Lists the languages supported by the grammar service, cached for an hour.
 *
 * @returns The supported languages.
 * @throws ValidationError When the service is unreachable.
 */
async function listLanguages(): Promise<GrammarLanguage[]> {
  if (languagesCache && Date.now() - languagesCache.at < CONFIG_CACHE_MS) {
    return languagesCache.value;
  }

  const languages = z
    .array(LanguageToolLanguageSchema)
    .parse(await request("/v2/languages"));

  languagesCache = { at: Date.now(), value: languages };

  return languages;
}

/**
 * Lists the checkable rules of a language, cached for an hour.
 *
 * @param language The BCP-47 tag of the language.
 * @returns The rules of the language.
 * @throws ValidationError When the service is unreachable.
 */
async function listRules(language: string): Promise<GrammarRule[]> {
  const cached = rulesCache.get(language);

  if (cached && Date.now() - cached.at < CONFIG_CACHE_MS) {
    return cached.value;
  }

  const config = LanguageToolConfigSchema.parse(
    await request(`/v2/configinfo?language=${encodeURIComponent(language)}`)
  );

  rulesCache.set(language, { at: Date.now(), value: config.rules });

  return config.rules;
}

router.post(
  "grammar.check",
  rateLimiter(RateLimiterStrategy.OneHundredPerMinute),
  auth(),
  validate(T.GrammarCheckSchema),
  async (ctx: APIContext<T.GrammarCheckReq>) => {
    const { text, ...options } = ctx.input.body;

    ctx.body = {
      data: await checkText(text, options),
    };
  }
);

router.post(
  "grammar.languages",
  rateLimiter(RateLimiterStrategy.OneHundredPerMinute),
  auth(),
  async (ctx: APIContext) => {
    ctx.body = {
      data: {
        languages: await listLanguages(),
      },
    };
  }
);

router.post(
  "grammar.config",
  rateLimiter(RateLimiterStrategy.OneHundredPerMinute),
  auth(),
  validate(T.GrammarConfigSchema),
  async (ctx: APIContext<T.GrammarConfigReq>) => {
    const { language } = ctx.input.body;

    ctx.body = {
      data: {
        rules: await listRules(language),
      },
    };
  }
);

export default router;
