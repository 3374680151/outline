/**
 * Free MyMemory translation protocol, ported from the FluentRead extension
 * (MIT licensed). Official anonymous API limited to roughly 5,000 characters
 * per day, 500 bytes per request.
 */

import { FreeProviderError } from "../types";

const MY_MEMORY_URL = "https://api.mymemory.translated.net/get";

const MY_MEMORY_MAX_BYTES = 500;

interface MyMemoryResponse {
  responseStatus?: unknown;
  quotaFinished?: unknown;
  responseData?: { translatedText?: unknown };
}

/**
 * Maps an Outline language tag to a MyMemory language code.
 *
 * @param code The BCP-47 language tag.
 * @returns The MyMemory language code.
 */
function toMyMemoryLanguageCode(code: string): string {
  const normalized = code.trim().toLowerCase();

  if (["zh", "zh-cn", "zh-sg", "zh-my", "zh-hans"].includes(normalized)) {
    return "zh-CN";
  }
  if (["zh-tw", "zh-hk", "zh-mo", "zh-hant"].includes(normalized)) {
    return "zh-TW";
  }

  return normalized;
}

/**
 * Detects the source language for the langpair, which does not support auto.
 *
 * @param text The text to inspect.
 * @returns "zh-CN" for Chinese text, otherwise "en".
 */
function detectSourceLanguage(text: string): string {
  if (/[\u4e00-\u9fff]/u.test(text)) {
    return "zh-CN";
  }
  return "en";
}

/**
 * Splits text into chunks bounded by UTF-8 byte length, preferring whitespace
 * and punctuation boundaries. Break characters stay attached to the
 * preceding chunk so joining with the empty string restores the text.
 *
 * @param text The text to split.
 * @param budget The maximum UTF-8 byte length per chunk.
 * @returns The chunks, in order.
 */
function chunkByBytes(text: string, budget: number): string[] {
  if (Buffer.byteLength(text, "utf8") <= budget) {
    return [text];
  }

  const chunks: string[] = [];
  let current = "";

  for (const character of text) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    const currentBytes = Buffer.byteLength(current, "utf8");

    if (currentBytes + characterBytes > budget) {
      chunks.push(current);
      current = "";
    }
    current += character;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

/**
 * Translates a single chunk through the MyMemory API.
 *
 * @param text The chunk to translate.
 * @param from The MyMemory source language code.
 * @param to The MyMemory target language code.
 * @param signal An abort signal bounding the request.
 * @returns The translated chunk.
 * @throws FreeProviderError When the endpoint fails, the quota is exhausted,
 * or the response is unusable.
 */
async function translateChunk(
  text: string,
  from: string,
  to: string,
  signal: AbortSignal
): Promise<string> {
  const url = new URL(MY_MEMORY_URL);
  url.searchParams.set("q", text);
  url.searchParams.set("langpair", `${from}|${to}`);

  const response = await fetch(url, { signal });

  if (!response.ok) {
    throw new FreeProviderError(
      `MyMemory translation failed with status ${response.status}`,
      response.status === 429 ? "rate-limit" : "unavailable"
    );
  }

  const data = (await response.json()) as MyMemoryResponse;

  if (data?.quotaFinished === true) {
    throw new FreeProviderError("MyMemory daily quota is exhausted", "quota");
  }

  const translatedText = data?.responseData?.translatedText;

  if (
    String(data?.responseStatus) !== "200" ||
    typeof translatedText !== "string" ||
    !translatedText.trim()
  ) {
    throw new FreeProviderError("MyMemory translation returned no usable text");
  }

  return translatedText;
}

/**
 * Translates text through the free MyMemory API, splitting oversized input
 * into UTF-8 byte bounded chunks.
 *
 * @param text The text to translate.
 * @param targetLanguage The target language tag, e.g. zh-CN.
 * @param signal An abort signal bounding the requests.
 * @returns The translated text.
 * @throws FreeProviderError When the endpoint fails or the quota is
 * exhausted.
 */
export async function translateMyMemoryText(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
  signal: AbortSignal
): Promise<string> {
  if (!text.trim()) {
    return text;
  }

  const from =
    sourceLanguage === "auto"
      ? detectSourceLanguage(text)
      : toMyMemoryLanguageCode(sourceLanguage);
  const to = toMyMemoryLanguageCode(targetLanguage);

  if (from === to) {
    return text;
  }

  const chunks = chunkByBytes(text, MY_MEMORY_MAX_BYTES);
  const translated: string[] = [];

  for (const chunk of chunks) {
    translated.push(await translateChunk(chunk, from, to, signal));
  }

  return translated.join("");
}
