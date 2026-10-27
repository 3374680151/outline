import env from "@server/env";
import Logger from "@server/logging/Logger";
import fetch from "@server/utils/fetch";
import type { WordLookupDTO } from "@shared/types/bilingual";
import type {
  TeamProviderConfig,
  TranslationProvider,
  TranslationRequest,
  TranslationResult,
} from "../types";

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
 * endpoint. The endpoint, key, and model come from the workspace AI service
 * configuration when configured, falling back to environment variables.
 */
const openaiCompatible: TranslationProvider = {
  id: "openai-compatible",
  label: "OpenAI Compatible",
  maxBatch: 20,

  isConfigured(config?: TeamProviderConfig | null) {
    const hasTeam = !!config?.apiKey && !!config?.baseUrl;
    return hasTeam || (!!env.OPENAI_API_KEY && !!env.OPENAI_BASE_URL);
  },

  async translate(
    req: TranslationRequest,
    config?: TeamProviderConfig | null
  ): Promise<TranslationResult> {
    const baseUrl = config?.baseUrl || env.OPENAI_BASE_URL;
    const apiKey = config?.apiKey || env.OPENAI_API_KEY;
    const model = config?.model || env.OPENAI_TRANSLATION_MODEL;

    if (!baseUrl || !apiKey) {
      throw new Error("openai-compatible is not configured");
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      timeout: 60000,
      signal: req.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
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

const DICT_SYSTEM_PROMPT = [
  "你是双语词典助手。对用户给出的词或短语，结合上下文输出严格的 JSON（禁止 markdown 代码块），格式：",
  '{"word":"原词","phonetic":"国际音标，查不到则空串","senses":[{"pos":"词性缩写如 n.","meaning":"简体中文释义"}],"examples":[{"src":"例句","dst":"例句中文译文"}]}。',
  "最多 4 个义项、2 个例句，释义面向中国学习者。",
].join(" ");

/**
 * Looks a word or short phrase up in the AI dictionary, following the same
 * protocol as the FluentRead web dictionary card. Returns null when the
 * provider is not configured or the model returns an unexpected payload.
 *
 * @param word The word or short phrase to look up.
 * @param context Optional sentence containing the word, for disambiguation.
 * @param signal Signal to abort the request.
 * @returns The dictionary entry, or null.
 */
export async function lookupWordWithAI(
  word: string,
  context: string | undefined,
  signal: AbortSignal,
  config?: TeamProviderConfig | null
): Promise<WordLookupDTO | null> {
  if (!openaiCompatible.isConfigured(config)) {
    return null;
  }

  const baseUrl = config?.baseUrl || env.OPENAI_BASE_URL;
  const apiKey = config?.apiKey || env.OPENAI_API_KEY;
  const model = config?.model || env.OPENAI_TRANSLATION_MODEL;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    timeout: 30000,
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: DICT_SYSTEM_PROMPT },
        { role: "user", content: "词语：" + word + (context ? "\n上下文：" + context : "") },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`openai-compatible dictionary responded ${response.status}`);
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const parsed = parseJsonObject(data.choices?.[0]?.message?.content ?? "");

  if (!parsed || !Array.isArray(parsed.senses)) {
    return null;
  }

  return {
    word: String(parsed.word ?? word),
    ...(typeof parsed.phonetic === "string" && parsed.phonetic ? { phonetic: parsed.phonetic } : {}),
    senses: (parsed.senses as { pos?: string; meaning?: string }[])
      .slice(0, 4)
      .map((sense) => ({ pos: String(sense.pos ?? ""), meaning: String(sense.meaning ?? "") })),
    examples: Array.isArray(parsed.examples)
      ? (parsed.examples as { src?: string; dst?: string }[])
          .slice(0, 2)
          .map((example) => ({ src: String(example.src ?? ""), dst: String(example.dst ?? "") }))
      : [],
  };
}
