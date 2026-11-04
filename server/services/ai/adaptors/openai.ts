import {
  type Adaptor,
  type BuiltRequest,
  type ChatRequest,
  type ChatResponse,
} from "./types";
import {
  openaiURL,
  parseJsonBody,
  upstreamError,
} from "./base";

interface OpenAIErrorBody {
  message?: string;
  type?: string;
}

interface OpenAIChatPayload {
  choices?: {
    message?: {
      content?: string;
    };
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: OpenAIErrorBody;
}

interface OpenAIModelsPayload {
  data?: {
    id?: string;
  }[];
}

/**
 * Adaptor for the OpenAI compatible chat completions protocol. Most vendors
 * (DeepSeek, Kimi, GLM, Qwen, MiniMax, SiliconFlow, OpenRouter, Ollama, and
 * OpenAI itself) expose official endpoints in this shape.
 */
export const openaiAdaptor: Adaptor = {
  buildRequest(baseUrl: string, apiKey: string, req: ChatRequest): BuiltRequest {
    const body = JSON.stringify({
      model: req.model,
      messages: req.messages,
      temperature: req.temperature,
      ...(req.maxTokens > 0 ? { max_tokens: req.maxTokens } : {}),
      stream: false,
    });

    return {
      url: openaiURL(baseUrl, "chat/completions"),
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body,
    };
  },

  parseResponse(body: string): ChatResponse {
    const parsed = parseJsonBody<OpenAIChatPayload>(body);

    if (!parsed) {
      throw new Error("Failed to parse upstream response");
    }

    if (parsed.error?.message) {
      throw new Error(parsed.error.message);
    }

    const content = parsed.choices?.[0]?.message?.content;

    if (content === undefined) {
      throw new Error("Upstream response has no choices");
    }

    const promptTokens = parsed.usage?.prompt_tokens ?? 0;
    const completionTokens = parsed.usage?.completion_tokens ?? 0;

    return {
      text: content,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: parsed.usage?.total_tokens ?? promptTokens + completionTokens,
      },
    };
  },

  parseError(body: string, status: number): Error {
    const parsed = parseJsonBody<OpenAIChatPayload>(body);

    if (parsed?.error?.message) {
      return new Error(`Upstream returned ${status}: ${parsed.error.message}`);
    }

    return upstreamError(status, body);
  },

  buildListModelsRequest(baseUrl: string, apiKey: string): BuiltRequest {
    return {
      url: openaiURL(baseUrl, "models"),
      headers: apiKey
        ? {
            Authorization: `Bearer ${apiKey}`,
          }
        : {},
      body: "",
    };
  },

  parseListModelsResponse(body: string): string[] {
    const parsed = parseJsonBody<OpenAIModelsPayload>(body);
    const models = (parsed?.data ?? [])
      .map((entry) => (entry.id ?? "").trim())
      .filter((id) => id.length > 0)
      .sort();

    if (models.length === 0) {
      throw new Error("Upstream model list is empty");
    }

    return models;
  },
};
