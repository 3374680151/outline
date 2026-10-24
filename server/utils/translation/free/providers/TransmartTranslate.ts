/**
 * Free Tencent Transmart (交互翻译) web protocol, ported from the FluentRead
 * extension (MIT licensed). The endpoint requires no authentication; a fresh
 * random client key is generated per request.
 */

import { randomUUID } from "node:crypto";
import { chunkByCodepoints } from "../chunkText";
import { FreeProviderError } from "../types";

const TRANSMART_URL = "https://transmart.qq.com/api/imt";

const MAX_CHUNK_CODEPOINTS = 1000;

interface TransmartResponse {
  header?: { ret_code?: unknown };
  auto_translation?: unknown;
}

/**
 * Maps an Outline language tag to a Transmart language code.
 *
 * @param code The BCP-47 language tag.
 * @param isTarget Whether the code is used as the target language.
 * @returns The Transmart language code.
 */
function toTransmartLanguageCode(code: string, isTarget: boolean): string {
  const normalized = code.trim().toLowerCase();

  if (!isTarget && (!normalized || normalized === "auto")) {
    return "auto";
  }
  if (["zh", "zh-cn", "zh-sg", "zh-my", "zh-hans"].includes(normalized)) {
    return "zh";
  }
  if (isTarget && ["zh-tw", "zh-hk", "zh-mo", "zh-hant"].includes(normalized)) {
    return "zh-tw";
  }

  return normalized;
}

/**
 * Translates text through the free Tencent Transmart endpoint, splitting
 * oversized input into code point bounded chunks.
 *
 * @param text The text to translate.
 * @param targetLanguage The target language tag, e.g. zh-CN.
 * @param signal An abort signal bounding the requests.
 * @returns The translated text.
 * @throws FreeProviderError When the endpoint fails or returns an unusable
 * response.
 */
export async function translateTransmartText(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
  signal: AbortSignal
): Promise<string> {
  if (!text.trim()) {
    return text;
  }

  const chunks = chunkByCodepoints(text, MAX_CHUNK_CODEPOINTS);
  const translated: string[] = [];

  for (const chunk of chunks) {
    translated.push(
      await translateChunk(chunk, sourceLanguage, targetLanguage, signal)
    );
  }

  return translated.join("");
}

/**
 * Translates a single chunk through the Transmart endpoint.
 *
 * @param text The chunk to translate.
 * @param targetLanguage The target language tag.
 * @param signal An abort signal bounding the request.
 * @returns The translated chunk.
 * @throws FreeProviderError When the endpoint fails or returns an unusable
 * response.
 */
async function translateChunk(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
  signal: AbortSignal
): Promise<string> {
  const response = await fetch(TRANSMART_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      header: {
        fn: "auto_translation",
        client_key: `browser-chrome-110.0.0-Mac OS-${randomUUID()}-${Date.now()}`,
      },
      type: "plain",
      model_category: "normal",
      source: {
        text_list: [text],
        lang: toTransmartLanguageCode(sourceLanguage, false),
      },
      target: { lang: toTransmartLanguageCode(targetLanguage, true) },
    }),
    signal,
  });

  if (!response.ok) {
    throw new FreeProviderError(
      `Transmart translation failed with status ${response.status}`,
      response.status === 429 ? "rate-limit" : "unavailable"
    );
  }

  const data = (await response.json()) as TransmartResponse;

  if (data?.header?.ret_code === "Auth-Failed") {
    throw new FreeProviderError("Transmart translation refused", "blocked");
  }
  if (data?.header?.ret_code !== "succ") {
    throw new FreeProviderError("Transmart translation failed");
  }

  const outputs = data.auto_translation;

  if (!Array.isArray(outputs)) {
    throw new FreeProviderError("Transmart translation returned no text");
  }

  const result = outputs.filter((item) => typeof item === "string").join("");

  if (!result.trim()) {
    throw new FreeProviderError(
      "Transmart translation returned no usable text",
      "request"
    );
  }

  return result.trim();
}
