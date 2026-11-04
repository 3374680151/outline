import {
  type Adaptor,
  type BuiltRequest,
  type ChatRequest,
  type ChatResponse,
} from "./types";
import { normalizeBaseURL, parseJsonBody, upstreamError } from "./base";

/** Safety threshold: only block high-confidence harm so benign text passes. */
const SAFETY_THRESHOLD = "BLOCK_ONLY_HIGH";

const SAFETY_CATEGORIES = [
  "HARM_CATEGORY_HARASSMENT",
  "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  "HARM_CATEGORY_DANGEROUS_CONTENT",
];

interface GeminiPayload {
  contents: {
    role?: "user" | "model";
    parts: {
      text?: string;
    }[];
  }[];
  system_instruction?: {
    parts: {
      text?: string;
    }[];
  };
  generation_config?: {
    temperature?: number;
    maxOutputTokens?: number;
  };
  safety_settings?: {
    category: string;
    threshold: string;
  }[];
}

interface GeminiResponseBody {
  candidates?: {
    content?: {
      parts?: {
        text?: string;
      }[];
    };
  }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

interface GeminiModelsResponseBody {
  models?: {
    name?: string;
    supportedGenerationMethods?: string[];
  }[];
}

/**
 * Adaptor for the Gemini generateContent protocol.
 */
export const geminiAdaptor: Adaptor = {
  buildRequest(baseUrl: string, apiKey: string, req: ChatRequest): BuiltRequest {
    const payload: GeminiPayload = {
      contents: [],
      generation_config: {
        temperature: req.temperature,
        ...(req.maxTokens > 0 ? { maxOutputTokens: req.maxTokens } : {}),
      },
      safety_settings: SAFETY_CATEGORIES.map((category) => ({
        category,
        threshold: SAFETY_THRESHOLD,
      })),
    };

    for (const message of req.messages) {
      if (message.role === "system") {
        payload.system_instruction = {
          parts: [
            {
              text: message.content,
            },
          ],
        };
      } else {
        payload.contents.push({
          role: message.role === "assistant" ? "model" : "user",
          parts: [
            {
              text: message.content,
            },
          ],
        });
      }
    }

    // Gemini requires contents to be non-empty; a system-only request gets a
    // placeholder user turn.
    if (payload.contents.length === 0) {
      payload.contents.push({
        role: "user",
        parts: [
          {
            text: "Please follow the system instructions.",
          },
        ],
      });
    }

    return {
      url: `${normalizeBaseURL(baseUrl)}/v1beta/models/${req.model}:generateContent`,
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(payload),
    };
  },

  parseResponse(body: string): ChatResponse {
    const parsed = parseJsonBody<GeminiResponseBody>(body);

    if (!parsed) {
      throw new Error("Failed to parse upstream response");
    }

    if (parsed.error?.message) {
      throw new Error(parsed.error.message);
    }

    if (!parsed.candidates?.length) {
      throw new Error(
        "Upstream response has no candidates (possibly blocked by safety settings)"
      );
    }

    const text = (parsed.candidates[0].content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("");

    const promptTokens = parsed.usageMetadata?.promptTokenCount ?? 0;
    const completionTokens = parsed.usageMetadata?.candidatesTokenCount ?? 0;

    return {
      text,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens:
          parsed.usageMetadata?.totalTokenCount ?? promptTokens + completionTokens,
      },
    };
  },

  parseError(body: string, status: number): Error {
    const parsed = parseJsonBody<GeminiResponseBody>(body);

    if (parsed?.error?.message) {
      return new Error(`Upstream returned ${status}: ${parsed.error.message}`);
    }

    return upstreamError(status, body);
  },

  buildListModelsRequest(baseUrl: string, apiKey: string): BuiltRequest {
    return {
      url: `${normalizeBaseURL(baseUrl)}/v1beta/models?pageSize=200`,
      headers: {
        "x-goog-api-key": apiKey,
      },
      body: "",
    };
  },

  parseListModelsResponse(body: string): string[] {
    const parsed = parseJsonBody<GeminiModelsResponseBody>(body);
    const models = (parsed?.models ?? [])
      .filter((model) =>
        (model.supportedGenerationMethods ?? []).includes("generateContent")
      )
      .map((model) => (model.name ?? "").trim().replace(/^models\//, ""))
      .filter((id) => id.length > 0)
      .sort();

    if (models.length === 0) {
      throw new Error("Upstream model list is empty");
    }

    return models;
  },
};
