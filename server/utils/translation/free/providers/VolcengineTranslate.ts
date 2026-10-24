/**
 * Free Volcengine (火山翻译) web protocol, ported from the FluentRead
 * extension (MIT licensed). The browser-extension endpoint requires no
 * authentication or signature.
 */

import { chunkByCodepoints } from "../chunkText";
import { FreeProviderError } from "../types";

const VOLCENGINE_TRANSLATE_URL =
  "https://translate.volcengine.com/crx/translate/v1/";

const MAX_CHUNK_CODEPOINTS = 1000;

interface VolcengineResponse {
  base_resp?: { status_code?: unknown };
  translation?: unknown;
}

/**
 * Maps an Outline language tag to a Volcengine web endpoint language code.
 *
 * @param code The BCP-47 language tag.
 * @param isTarget Whether the code is used as the target language.
 * @returns The Volcengine language code.
 */
function toVolcengineLanguageCode(code: string, isTarget: boolean): string {
  const normalized = code.trim().toLowerCase();

  if (!isTarget && (!normalized || normalized === "auto")) {
    return "auto";
  }
  if (["zh", "zh-cn", "zh-sg", "zh-my", "zh-hans"].includes(normalized)) {
    return "zh";
  }
  if (isTarget && ["zh-tw", "zh-hk", "zh-mo", "zh-hant"].includes(normalized)) {
    return "zh-Hant";
  }

  return normalized;
}

/**
 * Translates a single chunk through the Volcengine web endpoint.
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
  const response = await fetch(VOLCENGINE_TRANSLATE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source_language: toVolcengineLanguageCode(sourceLanguage, false),
      target_language: toVolcengineLanguageCode(targetLanguage, true),
      text,
    }),
    signal,
  });

  if (!response.ok) {
    throw new FreeProviderError(
      `Volcengine translation failed with status ${response.status}`,
      response.status === 429 ? "rate-limit" : "unavailable"
    );
  }

  const data = (await response.json()) as VolcengineResponse;

  if (data?.base_resp?.status_code !== 0) {
    throw new FreeProviderError("Volcengine translation failed");
  }

  const result = data.translation;

  if (typeof result !== "string" || !result.trim()) {
    throw new FreeProviderError(
      "Volcengine translation returned no usable text",
      "request"
    );
  }

  return result.trim();
}

/**
 * Translates text through the free Volcengine endpoint, splitting oversized
 * input into code point bounded chunks.
 *
 * @param text The text to translate.
 * @param targetLanguage The target language tag, e.g. zh-CN.
 * @param signal An abort signal bounding the requests.
 * @returns The translated text.
 * @throws FreeProviderError When the endpoint fails or returns an unusable
 * response.
 */
export async function translateVolcengineText(
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
