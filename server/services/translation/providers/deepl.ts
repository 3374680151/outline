import env from "@server/env";
import fetch from "@server/utils/fetch";
import type { TranslationProvider, TranslationRequest, TranslationResult } from "../types";

/** Map of ISO 639-1 codes to the uppercase codes the DeepL API expects. */
const DEEPL_LANGUAGES: Record<string, string> = {
  en: "EN",
  de: "DE",
  fr: "FR",
  es: "ES",
  pt: "PT-PT",
  it: "IT",
  nl: "NL",
  pl: "PL",
  ru: "RU",
  ja: "JA",
  zh: "ZH",
};

/**
 * Translation provider backed by the official DeepL REST API. Keys ending in
 * ":fx" are routed to the free API host automatically.
 */
const deepl: TranslationProvider = {
  id: "deepl",
  label: "DeepL",
  maxBatch: 50,

  isConfigured() {
    return !!env.DEEPL_API_KEY;
  },

  async translate(req: TranslationRequest): Promise<TranslationResult> {
    const targetLang = DEEPL_LANGUAGES[req.to];

    if (!targetLang) {
      throw new Error(`DeepL does not support target language "${req.to}"`);
    }

    const host = env.DEEPL_API_KEY?.endsWith(":fx")
      ? "https://api-free.deepl.com"
      : "https://api.deepl.com";

    const response = await fetch(`${host}/v2/translate`, {
      method: "POST",
      timeout: 30000,
      signal: req.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `DeepL-Auth-Key ${env.DEEPL_API_KEY}`,
      },
      body: JSON.stringify({
        text: req.texts,
        target_lang: targetLang,
        ...(req.from && DEEPL_LANGUAGES[req.from]
          ? { source_lang: DEEPL_LANGUAGES[req.from] }
          : {}),
      }),
    });

    if (!response.ok) {
      throw new Error(
        `deepl responded ${response.status}: ${await response.text()}`
      );
    }

    const data = (await response.json()) as {
      translations: { text: string; detected_source_language?: string }[];
    };

    return {
      results: data.translations.map((translation) => translation.text),
      detectedFrom: data.translations[0]?.detected_source_language?.toLowerCase(),
    };
  },
};

export default deepl;
