import env from "@server/env";
import Logger from "@server/logging/Logger";
import fetch from "@server/utils/fetch";
import type { TranslationProvider, TranslationRequest, TranslationResult } from "../types";

const SYSTEM_PROMPT = [
  "You are a translation engine.",
  "Translate each text from the JSON input into the requested target language.",
  "Preserve inline code, formulas, and proper nouns.",
  "Respond with JSON only, in the form {\"translations\": [\"...\", ...]} with exactly",
  "one entry per input text, in the same order.",
].join(" ");

/**
 * Extracts the first JSON object from a model response, tolerating code
 * fences and surrounding prose.
 *
 * @param content The raw model response content.
 * @returns The parsed JSON object, or null when none could be parsed.
 */
function parseJsonObject(content: string): Record<string, unknown> | null {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");

  if (start === -1 || end <= start) {
    return null;
  }

  try {
    return JSON.parse(content.slice(start, end + 1)) as Record<string, unknown>;
  } catch (err) {
    Logger.warn("Failed to parse OpenAI-compatible response", { err });
    return null;
  }
}

/**
 * Translation provider backed by any OpenAI-compatible chat completion
 * endpoint. The endpoint, key, and model are admin-configured via
 * environment variables.
 */
const openaiCompatible: TranslationProvider = {
  id: "openai-compatible",
  label: "OpenAI Compatible",
  maxBatch: 20,

  isConfigured() {
    return !!env.OPENAI_API_KEY && !!env.OPENAI_BASE_URL;
  },

  async translate(req: TranslationRequest): Promise<TranslationResult> {
    const response = await fetch(`${env.OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      timeout: 60000,
      signal: req.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.OPENAI_TRANSLATION_MODEL,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: JSON.stringify({
              from: req.from ?? "auto",
              to: req.to,
              texts: req.texts,
            }),
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(
        `openai-compatible responded ${response.status}: ${await response.text()}`
      );
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content ?? "";
    const parsed = parseJsonObject(content);
    const translations = parsed?.translations;

    if (!Array.isArray(translations) || translations.length !== req.texts.length) {
      throw new Error("openai-compatible returned an unexpected payload");
    }

    return {
      results: translations.map((entry) =>
        typeof entry === "string" ? entry : String(entry)
      ),
    };
  },
};

export default openaiCompatible;
