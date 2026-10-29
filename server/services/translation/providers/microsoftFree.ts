import Logger from "@server/logging/Logger";
import fetch from "@server/utils/fetch";
import type { TranslationProvider, TranslationRequest, TranslationResult } from "../types";

/**
 * Free fallback provider using the Microsoft Edge web translator endpoint,
 * ported from the FluentRead project's HTTP protocol (see
 * FluentRead/src/providers/translation/microsoftTransport.ts). It requires
 * no credentials but is unofficial: failures surface through the provider
 * fallback chain rather than breaking the endpoint.
 */

const MICROSOFT_TRANSLATE_URL = "https://edge.microsoft.com/translate/translatetext";

type MicrosoftTranslation = { translations?: { text?: string }[] };

/**
 * Escapes markup characters before sending: the Edge endpoint always runs
 * an HTML tag aligner over the input.
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

const microsoftFree: TranslationProvider = {
  id: "microsoft-free",
  label: "Microsoft (free)",
  maxBatch: 25,

  isConfigured() {
    return true;
  },

  async translate(req: TranslationRequest): Promise<TranslationResult> {
    const url = new URL(MICROSOFT_TRANSLATE_URL);
    url.searchParams.set("from", req.from && req.from !== "auto" ? req.from : "");
    url.searchParams.set("to", req.to);
    url.searchParams.set("isEnterpriseClient", "false");

    const response = await fetch(url.toString(), {
      method: "POST",
      timeout: 20000,
      signal: req.signal,
      // The provider is an outbound call to a service the admin configured;
      // the local network may resolve it through a proxy's virtual DNS.
      allowPrivateIPAddress: true,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(req.texts.map(escapeHtmlText)),
    });

    if (!response.ok) {
      Logger.warn(`microsoft-free responded ${response.status}`);
      throw new Error(`microsoft-free responded ${response.status}`);
    }

    const data = (await response.json()) as MicrosoftTranslation[];

    if (!Array.isArray(data) || data.length !== req.texts.length) {
      throw new Error("microsoft-free returned an unexpected payload");
    }

    return {
      results: data.map((entry, index) =>
        decodeHtmlText(entry.translations?.[0]?.text ?? req.texts[index])
      ),
    };
  },
};

export default microsoftFree;
