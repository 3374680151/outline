/**
 * Free Google web translation protocol, ported from the FluentRead extension
 * (MIT licensed). Uses the same public browser key as the extension's
 * translateHtml endpoint, with the gtx list endpoint as a fallback.
 */

import { FreeProviderError } from "../types";

const GOOGLE_HTML_URL = "https://translate-pa.googleapis.com/v1/translateHtml";
const GOOGLE_LIST_URL = "https://translate.googleapis.com/translate_a/t";

/** Public browser key embedded in Google's own web clients. */
const GOOGLE_API_KEY = "AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520";

interface GoogleHtmlResponse {
  0?: unknown[];
}

/**
 * Maps an Outline language tag to a Google language code.
 *
 * @param code The BCP-47 language tag, or "auto" to detect the language.
 * @returns The Google language code.
 */
function toGoogleLanguageCode(code: string): string {
  const normalized = code.trim().toLowerCase();

  if (!normalized || normalized === "auto") {
    return "auto";
  }
  if (["zh", "zh-cn", "zh-sg", "zh-my", "zh-hans"].includes(normalized)) {
    return "zh-CN";
  }
  if (["zh-tw", "zh-hk", "zh-mo", "zh-hant"].includes(normalized)) {
    return "zh-TW";
  }
  if (normalized === "nb") {
    return "no";
  }
  if (normalized === "fil") {
    return "tl";
  }

  return code.trim();
}

/**
 * Escapes HTML markup characters before embedding the text in the
 * protobuf-JSON payload.
 *
 * @param text The plain text to escape.
 * @returns The escaped text.
 */
function escapeGoogleText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Decodes the entity literals returned by Google in a single pass so encoded
 * entities are never decoded twice.
 *
 * @param text The escaped text returned by the endpoint.
 * @returns The decoded plain text.
 */
function decodeGoogleText(text: string): string {
  return text.replace(
    /&(?:amp|lt|gt|quot|apos|nbsp|#[0-9]+|#[xX][0-9A-Fa-f]+);/gu,
    (entity) => {
      const lower = entity.toLowerCase();

      switch (lower) {
        case "&amp;":
          return "&";
        case "&lt;":
          return "<";
        case "&gt;":
          return ">";
        case "&quot;":
          return '"';
        case "&apos;":
        case "&#39;":
          return "'";
        case "&nbsp;":
          return " ";
      }

      if (lower.startsWith("&#x")) {
        return String.fromCodePoint(parseInt(lower.slice(3, -1), 16));
      }
      return String.fromCodePoint(Number(lower.slice(2, -1)));
    }
  );
}

/**
 * Throws a categorized error for a failed Google response, detecting CAPTCHA
 * challenge pages.
 *
 * @param response The failed response.
 * @returns A promise resolving to nothing, throwing instead.
 */
async function throwGoogleError(response: Response): Promise<never> {
  const detail = await response.text().catch(() => "");

  if (/<!doctype html|<html[\s>]/iu.test(detail)) {
    throw new FreeProviderError(
      "Google translation returned a challenge page",
      "blocked"
    );
  }
  if (response.status === 429) {
    throw new FreeProviderError(
      "Google translation rate limited",
      "rate-limit"
    );
  }
  if (response.status === 403) {
    throw new FreeProviderError("Google translation blocked", "blocked");
  }

  throw new FreeProviderError(
    `Google translation failed with status ${response.status}`
  );
}

/**
 * Translates text through the protobuf-JSON translateHtml endpoint.
 *
 * @param text The text to translate.
 * @param from The Google source language code.
 * @param to The Google target language code.
 * @param signal An abort signal bounding the request.
 * @returns The translated text.
 * @throws FreeProviderError When the endpoint fails or returns a malformed
 * response.
 */
async function translateHtml(
  text: string,
  from: string,
  to: string,
  signal: AbortSignal
): Promise<string> {
  const response = await fetch(GOOGLE_HTML_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json+protobuf",
      "X-Goog-API-Key": GOOGLE_API_KEY,
    },
    body: JSON.stringify([
      [[`<pre>${escapeGoogleText(text)}</pre>`], from, to],
      "wt_lib",
    ]),
    signal,
  });

  if (!response.ok) {
    await throwGoogleError(response);
  }

  const payload = (await response.json()) as GoogleHtmlResponse;
  const items = payload?.[0];

  if (!Array.isArray(items) || items.length !== 1) {
    throw new FreeProviderError("Google translation returned an invalid batch");
  }

  const wrapped = items[0];

  if (typeof wrapped !== "string") {
    throw new FreeProviderError("Google translation returned an empty slot");
  }

  const unwrapped = wrapped.replace(
    /^<pre(?:\s[^>]*)?>([\s\S]*)<\/pre>$/iu,
    "$1"
  );

  return decodeGoogleText(unwrapped);
}

/**
 * Translates text through the gtx list endpoint as a fallback.
 *
 * @param text The text to translate.
 * @param from The Google source language code.
 * @param to The Google target language code.
 * @param signal An abort signal bounding the request.
 * @returns The translated text.
 * @throws FreeProviderError When the endpoint fails or returns a malformed
 * response.
 */
async function translateList(
  text: string,
  from: string,
  to: string,
  signal: AbortSignal
): Promise<string> {
  const url = new URL(GOOGLE_LIST_URL);
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", from);
  url.searchParams.set("tl", to);
  url.searchParams.set("dt", "t");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: new URLSearchParams({ q: text }).toString(),
    signal,
  });

  if (!response.ok) {
    await throwGoogleError(response);
  }

  const payload = (await response.json()) as unknown[];

  if (!Array.isArray(payload)) {
    throw new FreeProviderError("Google translation returned an invalid batch");
  }

  const outputs = payload.map((item) =>
    Array.isArray(item) && typeof item[0] === "string"
      ? item[0]
      : typeof item === "string"
        ? item
        : ""
  );

  if (outputs.length !== 1 || !outputs[0]) {
    throw new FreeProviderError("Google translation returned an invalid batch");
  }

  return outputs[0];
}

/**
 * Translates text through the free Google endpoints, trying the translateHtml
 * endpoint first and the gtx list endpoint as a fallback.
 *
 * @param text The text to translate.
 * @param targetLanguage The target language tag, e.g. zh-CN.
 * @param signal An abort signal bounding the requests.
 * @returns The translated text.
 * @throws FreeProviderError When every endpoint fails.
 */
export async function translateGoogleText(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
  signal: AbortSignal
): Promise<string> {
  const from = toGoogleLanguageCode(sourceLanguage);
  const to = toGoogleLanguageCode(targetLanguage);

  try {
    return await translateHtml(text, from, to, signal);
  } catch (err) {
    if (err instanceof FreeProviderError && err.category !== "unavailable") {
      throw err;
    }
    return translateList(text, from, to, signal);
  }
}
