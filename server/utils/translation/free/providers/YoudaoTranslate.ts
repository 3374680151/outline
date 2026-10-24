/**
 * Free Youdao web dictionary translation protocol, ported from the FluentRead
 * extension (MIT licensed). The anonymous endpoint only supports the
 * English ↔ Simplified Chinese direction and signs requests with a fixed
 * web-client secret.
 */

import { createHash } from "node:crypto";
import { chunkByCodepoints } from "../chunkText";
import { FreeProviderError } from "../types";

const YOUDAO_URL = "https://dict.youdao.com/jsonapi_s";

const YOUDAO_KEYFROM = "webfanyi.webmain";
const YOUDAO_CLIENT = "webmain";
const YOUDAO_SECRET = "t2he2k4m2g6QKRigK0KAmSpXKgAezyWg";

/** The anonymous endpoint silently truncates around 600 characters. */
const MAX_CHUNK_CODEPOINTS = 500;

interface YoudaoResponse {
  fanyi?: { tran?: unknown; type?: unknown };
}

/**
 * Computes the MD5 hex digest used by the Youdao web client signature.
 *
 * @param value The value to hash.
 * @returns The lowercase hex digest.
 */
function md5(value: string): string {
  return createHash("md5").update(value).digest("hex");
}

/**
 * Computes the request timestamp exactly like the Youdao web client.
 *
 * @param query The text being translated.
 * @returns The timestamp string.
 */
function youdaoTimestamp(query: string): string {
  return String(Date.now() + ((query + YOUDAO_KEYFROM).length % 10));
}

/**
 * Computes the request signature exactly like the Youdao web client.
 *
 * @param query The text being translated.
 * @param timestamp The timestamp from youdaoTimestamp.
 * @returns The signature hex digest.
 */
function youdaoSign(query: string, timestamp: string): string {
  const queryDigest = md5(query + YOUDAO_KEYFROM);
  return md5(
    `${YOUDAO_CLIENT}${query}${timestamp}${YOUDAO_SECRET}${queryDigest}`
  );
}

/**
 * Maps an Outline language tag to the Youdao codes accepted by the anonymous
 * endpoint, which only supports English and Simplified Chinese.
 *
 * @param code The BCP-47 language tag.
 * @param isSource Whether the code is used as the source language.
 * @returns The Youdao language code.
 * @throws FreeProviderError When the direction is not supported.
 */
function toYoudaoLanguageCode(code: string, isSource: boolean): string {
  const normalized = code.trim().toLowerCase();

  if (["zh", "zh-cn", "zh-sg", "zh-my", "zh-hans"].includes(normalized)) {
    return "zh-CHS";
  }
  if (normalized === "en" || normalized === "en-us" || normalized === "en-gb") {
    return "en";
  }

  throw new FreeProviderError(
    `Youdao free translation does not support this ${
      isSource ? "source" : "target"
    } language`,
    "request"
  );
}

/**
 * Detects whether the text should be treated as Chinese or English for the
 * auto source language, the only detection the endpoint needs.
 *
 * @param text The text to inspect.
 * @returns "zh-CHS" for Chinese text, otherwise "en".
 */
function detectSourceLanguage(text: string): string {
  if (/[\u4e00-\u9fff]/u.test(text)) {
    return "zh-CHS";
  }
  return "en";
}

/**
 * Translates a single chunk through the Youdao web endpoint.
 *
 * @param text The chunk to translate.
 * @param from The detected Youdao source language code.
 * @param to The Youdao target language code.
 * @param signal An abort signal bounding the request.
 * @returns The translated chunk.
 * @throws FreeProviderError When the endpoint fails or returns an unusable
 * response.
 */
async function translateChunk(
  text: string,
  from: string,
  to: string,
  signal: AbortSignal
): Promise<string> {
  const timestamp = youdaoTimestamp(text);
  const url = new URL(YOUDAO_URL);
  url.searchParams.set("doctype", "json");
  url.searchParams.set("jsonversion", "4");
  url.searchParams.set("q", text);
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  url.searchParams.set("t", timestamp);
  url.searchParams.set("client", YOUDAO_CLIENT);
  url.searchParams.set("sign", youdaoSign(text, timestamp));
  url.searchParams.set("keyfrom", YOUDAO_KEYFROM);

  const response = await fetch(url, { signal });

  if (!response.ok) {
    throw new FreeProviderError(
      `Youdao translation failed with status ${response.status}`,
      response.status === 429 ? "rate-limit" : "unavailable"
    );
  }

  const data = (await response.json()) as YoudaoResponse;
  const tran = data?.fanyi?.tran;
  const type = typeof data?.fanyi?.type === "string" ? data.fanyi.type : "";

  // The endpoint echoes the requested direction; anything else means the
  // response does not belong to this request.
  const direction = `${from}2${to}`.toLowerCase();
  if (
    ["en2zh-chs", "zh-chs2en"].includes(type.toLowerCase()) &&
    type.toLowerCase() !== direction
  ) {
    throw new FreeProviderError(
      "Youdao translation returned a mismatched direction",
      "request"
    );
  }

  if (typeof tran !== "string" || !tran.trim()) {
    throw new FreeProviderError("Youdao translation returned no usable text");
  }

  return tran.trim();
}

/**
 * Translates text through the free Youdao endpoint, splitting oversized input
 * into code point bounded chunks.
 *
 * @param text The text to translate.
 * @param targetLanguage The target language tag; only zh-CN is supported.
 * @param signal An abort signal bounding the requests.
 * @returns The translated text.
 * @throws FreeProviderError When the direction is unsupported or the endpoint
 * fails.
 */
export async function translateYoudaoText(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
  signal: AbortSignal
): Promise<string> {
  const to = toYoudaoLanguageCode(targetLanguage, false);
  const from =
    sourceLanguage === "auto"
      ? detectSourceLanguage(text)
      : toYoudaoLanguageCode(sourceLanguage, true);

  if (from === to) {
    return text;
  }

  if (!text.trim()) {
    return text;
  }

  const chunks = chunkByCodepoints(text, MAX_CHUNK_CODEPOINTS);
  const translated: string[] = [];

  for (const chunk of chunks) {
    translated.push(await translateChunk(chunk, from, to, signal));
  }

  return translated.join("");
}
