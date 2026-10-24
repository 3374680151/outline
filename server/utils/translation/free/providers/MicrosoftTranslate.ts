/**
 * Free Microsoft Edge translation protocol, ported from the FluentRead
 * extension (MIT licensed). The endpoint accepts a JSON array of HTML-escaped
 * strings and requires no authentication.
 */

import { FreeProviderError } from "../types";

const MICROSOFT_TRANSLATE_URL =
  "https://edge.microsoft.com/translate/translatetext";

interface MicrosoftTranslation {
  translations?: { text?: string }[];
}

/**
 * Maps an Outline language tag to a language code accepted by the Microsoft
 * Edge translation endpoint.
 *
 * @param code The BCP-47 language tag, or "auto" to detect the language.
 * @returns The Microsoft language code, or an empty string for auto-detect.
 */
function toMicrosoftLanguageCode(code: string): string {
  const normalized = code.trim().toLowerCase();

  if (!normalized || normalized === "auto") {
    return "";
  }
  if (["zh", "zh-cn", "zh-sg", "zh-my", "zh-hans"].includes(normalized)) {
    return "zh-Hans";
  }
  if (["zh-tw", "zh-hk", "zh-mo", "zh-hant"].includes(normalized)) {
    return "zh-Hant";
  }
  if (normalized === "sr") {
    return "sr-Cyrl";
  }

  return code.trim();
}

/**
 * Escapes HTML markup characters so the endpoint's HTML tag aligner treats
 * the text as plain content.
 *
 * @param text The plain text to escape.
 * @returns The escaped text.
 */
function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Reverses the escaping applied by escapeHtmlText.
 *
 * @param text The escaped text returned by the endpoint.
 * @returns The decoded plain text.
 */
function decodeHtmlText(text: string): string {
  return text
    .replace(/&#(?:0*39);|&#x0*27;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&gt;/gi, ">")
    .replace(/&lt;/gi, "<")
    .replace(/&amp;/gi, "&");
}

/**
 * Counts the HTML entity literals present in a text.
 *
 * @param text The text to scan.
 * @returns A map from entity literal to its number of occurrences.
 */
function literalEntityCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();

  for (const match of text.matchAll(
    /&(?:#[0-9]+|#[xX][0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]*);/gu
  )) {
    counts.set(match[0], (counts.get(match[0]) ?? 0) + 1);
  }

  return counts;
}

/**
 * The endpoint rewrites entity literals as page content, so any entity
 * present in the source must survive into the translation with the same
 * count.
 *
 * @param source The original plain text.
 * @param translation The decoded translation.
 * @throws FreeProviderError When an entity literal was dropped or duplicated.
 */
function requireLiteralEntities(source: string, translation: string): void {
  const expected = literalEntityCounts(source);
  if (expected.size === 0) {
    return;
  }

  const actual = literalEntityCounts(translation);

  for (const [entity, count] of expected) {
    if (actual.get(entity) !== count) {
      throw new FreeProviderError(
        "Microsoft translation did not preserve entity literals",
        "request"
      );
    }
  }
}

/**
 * Translates one text through the free Microsoft Edge translation endpoint.
 *
 * @param text The text to translate.
 * @param targetLanguage The target language tag, e.g. zh-CN.
 * @param signal An abort signal bounding the request.
 * @returns The translated text.
 * @throws FreeProviderError When the endpoint fails or returns a malformed
 * response.
 */
export async function translateMicrosoftText(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
  signal: AbortSignal
): Promise<string> {
  const url = new URL(MICROSOFT_TRANSLATE_URL);
  url.searchParams.set("from", toMicrosoftLanguageCode(sourceLanguage));
  url.searchParams.set("to", toMicrosoftLanguageCode(targetLanguage));
  url.searchParams.set("isEnterpriseClient", "false");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify([escapeHtmlText(text)]),
    signal,
  });

  if (!response.ok) {
    throw new FreeProviderError(
      `Microsoft translation failed with status ${response.status}`,
      response.status === 429 ? "rate-limit" : "unavailable"
    );
  }

  const result = (await response.json()) as MicrosoftTranslation[];

  if (!Array.isArray(result) || result.length !== 1) {
    throw new FreeProviderError(
      "Microsoft translation returned an incomplete batch"
    );
  }

  const item = result[0];
  const translatedText =
    Array.isArray(item?.translations) && item.translations.length === 1
      ? item.translations[0]?.text
      : undefined;

  if (typeof translatedText !== "string") {
    throw new FreeProviderError("Microsoft translation returned an empty slot");
  }

  const decoded = decodeHtmlText(translatedText);
  requireLiteralEntities(text, decoded);

  return decoded;
}
