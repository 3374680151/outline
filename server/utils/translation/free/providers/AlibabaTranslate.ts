/**
 * Free Alibaba Translate web protocol, ported from the FluentRead extension
 * (MIT licensed). A CSRF token is fetched per request and sent back as a
 * header and form field.
 */

import { chunkByCodepoints } from "../chunkText";
import { FreeProviderError } from "../types";

const ALIBABA_TOKEN_URL =
  "https://translate.alibaba.com/api/translate/csrftoken";
const ALIBABA_TRANSLATE_URL =
  "https://translate.alibaba.com/api/translate/text";

const ALIBABA_TOKEN_HEADER = "X-XSRF-TOKEN_PROPERTY_ITEM";

const MAX_CHUNK_CODEPOINTS = 1000;

interface AlibabaTokenResponse {
  token?: unknown;
  headerName?: unknown;
}

interface AlibabaTranslationResponse {
  success?: unknown;
  httpStatusCode?: unknown;
  data?: { translateText?: unknown };
}

/**
 * Maps an Outline language tag to an Alibaba language code, folding the
 * Chinese variants and sending Chinese as "zh".
 *
 * @param code The BCP-47 language tag, or "auto" as source.
 * @param isTarget Whether the code is used as the target language.
 * @returns The Alibaba language code.
 * @throws FreeProviderError When the code has an unexpected shape.
 */
function toAlibabaLanguageCode(code: string, isTarget: boolean): string {
  const normalized = code.trim().toLowerCase().replace(/_/g, "-");

  if (!isTarget && (!normalized || normalized === "auto")) {
    return "auto";
  }
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(normalized)) {
    throw new FreeProviderError(
      `Alibaba translation does not support the language ${code}`,
      "request"
    );
  }
  if (["zh-hans", "zh-chs", "zh-cn"].includes(normalized)) {
    return "zh";
  }
  if (["zh-hant", "zh-cht", "zh-tw", "zh-hk", "zh-mo"].includes(normalized)) {
    return "zh-tw";
  }

  return normalized;
}

/**
 * Fetches a fresh CSRF token from the Alibaba translation site.
 *
 * @param signal An abort signal bounding the request.
 * @returns The CSRF token value.
 * @throws FreeProviderError When the token endpoint fails or returns an
 * unexpected shape.
 */
async function fetchCsrfToken(signal: AbortSignal): Promise<string> {
  const response = await fetch(ALIBABA_TOKEN_URL, { signal });

  if (!response.ok) {
    throw new FreeProviderError(
      `Alibaba token request failed with status ${response.status}`,
      response.status === 429 ? "rate-limit" : "unavailable"
    );
  }

  const data = (await response.json()) as AlibabaTokenResponse;

  if (
    typeof data?.token !== "string" ||
    !/^[a-zA-Z0-9-]{1,128}$/.test(data.token) ||
    data?.headerName !== ALIBABA_TOKEN_HEADER
  ) {
    throw new FreeProviderError(
      "Alibaba token request returned an unexpected shape"
    );
  }

  return data.token;
}

/**
 * Translates a single chunk through the Alibaba web endpoint.
 *
 * @param text The chunk to translate.
 * @param targetLanguage The target language tag.
 * @param signal An abort signal bounding the requests.
 * @returns The translated chunk.
 * @throws FreeProviderError When the token or translation requests fail.
 */
async function translateChunk(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
  signal: AbortSignal
): Promise<string> {
  const token = await fetchCsrfToken(signal);

  const form = new FormData();
  form.set("query", text);
  form.set("srcLang", toAlibabaLanguageCode(sourceLanguage, false));
  form.set("tgtLang", toAlibabaLanguageCode(targetLanguage, true));
  form.set("domain", "general");
  form.set("_csrf", token);

  const response = await fetch(ALIBABA_TRANSLATE_URL, {
    method: "POST",
    headers: {
      [ALIBABA_TOKEN_HEADER]: token,
    },
    body: form,
    signal,
  });

  if (!response.ok) {
    throw new FreeProviderError(
      `Alibaba translation failed with status ${response.status}`,
      response.status === 429 ? "rate-limit" : "unavailable"
    );
  }

  const data = (await response.json()) as AlibabaTranslationResponse;

  if (data?.success !== true) {
    throw new FreeProviderError("Alibaba translation failed");
  }

  const result = data?.data?.translateText;

  if (typeof result !== "string" || !result.trim()) {
    throw new FreeProviderError(
      "Alibaba translation returned no usable text",
      "request"
    );
  }

  return result.trim();
}

/**
 * Translates text through the free Alibaba endpoint, splitting oversized
 * input into code point bounded chunks.
 *
 * @param text The text to translate.
 * @param targetLanguage The target language tag, e.g. zh-CN.
 * @param signal An abort signal bounding the requests.
 * @returns The translated text.
 * @throws FreeProviderError When the token or translation requests fail.
 */
export async function translateAlibabaText(
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
