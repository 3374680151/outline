import Logger from "@server/logging/Logger";
import fetch from "@server/utils/fetch";
import type { TranslationProvider, TranslationRequest, TranslationResult } from "../types";

/**
 * Free fallback provider using the Microsoft Edge web translator endpoint,
 * the same upstream the FluentRead project uses for its keyless "microsoft"
 * service (see FluentRead/src/providers/translation/microsoft). It requires
 * no credentials but is unofficial: failures surface through the provider
 * fallback chain rather than breaking the endpoint.
 */

const AUTH_URL = "https://edge.microsoft.com/translate/auth";
const TRANSLATE_URL =
  "https://api-edge.cognitive.microsofttranslator.com/translate";

let cachedToken: string | null = null;
let cachedTokenAt = 0;

/**
 * Fetches (and caches for 9 minutes) the anonymous Edge translator token.
 *
 * @returns The bearer token.
 * @throws Error when the token endpoint fails.
 */
async function getToken(): Promise<string> {
  const now = Date.now();

  if (cachedToken && now - cachedTokenAt < 9 * 60 * 1000) {
    return cachedToken;
  }

  const response = await fetch(AUTH_URL, { timeout: 10000 });

  if (!response.ok) {
    throw new Error(`microsoft-free auth responded ${response.status}`);
  }

  cachedToken = await response.text();
  cachedTokenAt = now;
  return cachedToken;
}

const microsoftFree: TranslationProvider = {
  id: "microsoft-free",
  label: "Microsoft (free)",
  maxBatch: 25,

  isConfigured() {
    return true;
  },

  async translate(req: TranslationRequest): Promise<TranslationResult> {
    const token = await getToken();
    const params = new URLSearchParams({
      to: req.to,
      "api-version": "3.0",
      includeSentenceLength: "false",
    });

    if (req.from && req.from !== "auto") {
      params.set("from", req.from);
    }

    const response = await fetch(`${TRANSLATE_URL}?${params.toString()}`, {
      method: "POST",
      timeout: 20000,
      signal: req.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(req.texts.map((text) => ({ Text: text }))),
    });

    if (!response.ok) {
      // The anonymous token may have been rejected – drop it so the next
      // attempt fetches a fresh one.
      cachedToken = null;
      Logger.warn(`microsoft-free responded ${response.status}`);
      throw new Error(`microsoft-free responded ${response.status}`);
    }

    const data = (await response.json()) as {
      detectedLanguage?: { language?: string };
      translations: { text: string }[];
    }[];

    return {
      results: data.map((entry) => entry.translations[0]?.text ?? ""),
      detectedFrom: data[0]?.detectedLanguage?.language,
    };
  },
};

export default microsoftFree;
