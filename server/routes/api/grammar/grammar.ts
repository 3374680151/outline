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
const DEFAULT_LANGUAGE = "en-US";

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
});

/** A single grammar issue returned to the client. */
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
  categoryName?: string;
};

/**
 * Checks the text against the configured LanguageTool server and returns the
 * grammar, spelling and style issues found.
 *
 * @param text The text to check.
 * @param language The BCP-47 tag of the language to check against.
 * @returns The matches found, in the order reported by LanguageTool.
 * @throws ValidationError When grammar checking is not configured, the
 * service is unreachable or returns an unexpected response.
 */
async function checkText(
  text: string,
  language: string
): Promise<GrammarMatch[]> {
  const baseUrl = env.LANGUAGE_TOOL_URL;

  if (!baseUrl) {
    throw ValidationError(
      "Grammar checking is not configured on this installation"
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/v2/check`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ text, language }),
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

    const json = LanguageToolResponseSchema.parse(await response.json());
    return json.matches.map(presentMatch);
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
    categoryName: match.rule?.category?.name ?? match.rule?.category?.id,
  };
}

router.post(
  "grammar.check",
  rateLimiter(RateLimiterStrategy.OneHundredPerMinute),
  auth(),
  validate(T.GrammarCheckSchema),
  async (ctx: APIContext<T.GrammarCheckReq>) => {
    const { text, language } = ctx.input.body;
    const matches = await checkText(text, language ?? DEFAULT_LANGUAGE);

    ctx.body = {
      data: {
        matches,
      },
    };
  }
);

export default router;
