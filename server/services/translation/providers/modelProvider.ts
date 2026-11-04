import { executeChat } from "@server/services/ai/adaptors";
import type {
  TeamModelProviderConfig,
  TranslationProvider,
  TranslationRequest,
  TranslationResult,
} from "../types";
import { parseJsonObject } from "./openaiCompatible";

const SYSTEM_PROMPT = [
  "You are a translation engine.",
  "Translate each text from the JSON input into the requested target language.",
  "Preserve inline code, formulas, and proper nouns.",
  'Respond with JSON only, in the form {"translations": ["...", ...]} with exactly',
  "one entry per input text, in the same order.",
].join(" ");

/** Prefix used in provider ids of workspace model gateways. */
export const MODEL_PROVIDER_ID_PREFIX = "mp:";

/**
 * Builds a translation provider backed by one workspace model gateway. The
 * gateway speaks its own protocol (openai, anthropic, or gemini), translated
 * to the unified adaptor layer.
 *
 * @param mp The model gateway with decrypted credentials.
 * @returns The translation provider.
 */
export function modelProviderTranslationProvider(
  mp: TeamModelProviderConfig
): TranslationProvider {
  return {
    id: `${MODEL_PROVIDER_ID_PREFIX}${mp.id}`,
    label: mp.name,
    maxBatch: 20,

    isConfigured() {
      return !!mp.baseUrl && !!mp.apiKey;
    },

    async translate(
      req: TranslationRequest
    ): Promise<TranslationResult> {
      if (!mp.model) {
        throw new Error(`Model provider "${mp.name}" has no default model`);
      }

      const response = await executeChat({
        baseUrl: mp.baseUrl,
        apiKey: mp.apiKey,
        protocol: mp.protocol,
        signal: req.signal,
        req: {
          model: mp.model,
          temperature: 0.2,
          maxTokens: 0,
          messages: [
            {
              role: "system",
              content: SYSTEM_PROMPT,
            },
            {
              role: "user",
              content: JSON.stringify({
                from: req.from ?? "auto",
                to: req.to,
                texts: req.texts,
              }),
            },
          ],
        },
      });

      const parsed = parseJsonObject(response.text);
      const translations = parsed?.translations;

      if (
        !Array.isArray(translations) ||
        translations.length !== req.texts.length
      ) {
        throw new Error(`Model provider "${mp.name}" returned an unexpected payload`);
      }

      return {
        results: translations.map((entry) =>
          typeof entry === "string" ? entry : String(entry)
        ),
      };
    },
  };
}
