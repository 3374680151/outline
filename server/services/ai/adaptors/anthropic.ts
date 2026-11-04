import {
  type Adaptor,
  type BuiltRequest,
  type ChatMessage,
  type ChatRequest,
  type ChatResponse,
} from "./types";
import { normalizeBaseURL, parseJsonBody, upstreamError } from "./base";

/** The API version header Anthropic requires. */
const ANTHROPIC_VERSION = "2023-06-01";

interface AnthropicMessage {
  role: "user" | "assistant";
  content: {
    type: "text";
    text: string;
  }[];
}

interface AnthropicPayload {
  model: string;
  messages?: AnthropicMessage[];
  system?: string;
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
}

interface AnthropicResponseBody {
  type?: string;
  content?: {
    type?: string;
    text?: string;
  }[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  error?: {
    type?: string;
    message?: string;
  };
}

interface AnthropicModelsResponseBody {
  data?: {
    id?: string;
  }[];
}

/**
 * Clamps a temperature into the [0, 1] range Anthropic accepts.
 *
 * @param temperature The requested temperature.
 * @returns The clamped temperature.
 */
function clampTemperature(temperature: number): number {
  if (temperature < 0) {
    return 0;
  }

  if (temperature > 1) {
    return 1;
  }

  return temperature;
}

/**
 * Converts OpenAI-style messages into Anthropic's shape: system messages are
 * extracted into the top-level system field, adjacent same-role messages are
 * merged, and a leading assistant message is turned into a user message so
 * the alternation requirement is never violated.
 *
 * @param messages The unified messages.
 * @returns The system text and the converted messages.
 */
function convertMessages(messages: ChatMessage[]): {
  system: string;
  converted: {
    role: "user" | "assistant";
    content: string;
  }[];
} {
  let system = "";
  const flat: {
    role: "user" | "assistant";
    content: string;
  }[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      system = system ? `${system}\n\n${message.content}` : message.content;
    } else {
      flat.push({
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content,
      });
    }
  }

  const merged: typeof flat = [];

  for (const message of flat) {
    const previous = merged[merged.length - 1];

    if (previous && previous.role === message.role) {
      previous.content = `${previous.content}\n\n${message.content}`;
      continue;
    }

    merged.push({ ...message });
  }

  // Anthropic requires the conversation to start with a user message.
  if (merged[0]?.role === "assistant") {
    merged[0] = {
      role: "user",
      content: `[Continue the reply] ${merged[0].content}`,
    };
  }

  return { system, converted: merged };
}

/**
 * Adaptor for the Anthropic Messages protocol (Claude models).
 */
export const anthropicAdaptor: Adaptor = {
  buildRequest(baseUrl: string, apiKey: string, req: ChatRequest): BuiltRequest {
    const { system, converted } = convertMessages(req.messages);

    const payload: AnthropicPayload = {
      model: req.model,
      max_tokens: req.maxTokens > 0 ? req.maxTokens : 4096,
      temperature: clampTemperature(req.temperature),
      stream: false,
      messages: converted.map((message) => ({
        role: message.role,
        content: [
          {
            type: "text",
            text: message.content,
          },
        ],
      })),
      ...(system ? { system } : {}),
    };

    return {
      url: `${normalizeBaseURL(baseUrl)}/v1/messages`,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(payload),
    };
  },

  parseResponse(body: string): ChatResponse {
    const parsed = parseJsonBody<AnthropicResponseBody>(body);

    if (!parsed) {
      throw new Error("Failed to parse upstream response");
    }

    if (parsed.error?.message) {
      throw new Error(parsed.error.message);
    }

    if (!parsed.content?.length) {
      throw new Error("Upstream response has no content");
    }

    const text = parsed.content
      .filter((block) => block.type === "text" && block.text)
      .map((block) => block.text ?? "")
      .join("");

    const promptTokens = parsed.usage?.input_tokens ?? 0;
    const completionTokens = parsed.usage?.output_tokens ?? 0;

    return {
      text,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
    };
  },

  parseError(body: string, status: number): Error {
    const parsed = parseJsonBody<AnthropicResponseBody>(body);

    if (parsed?.error?.message) {
      return new Error(`Upstream returned ${status}: ${parsed.error.message}`);
    }

    return upstreamError(status, body);
  },

  buildListModelsRequest(baseUrl: string, apiKey: string): BuiltRequest {
    return {
      url: `${normalizeBaseURL(baseUrl)}/v1/models?limit=100`,
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: "",
    };
  },

  parseListModelsResponse(body: string): string[] {
    const parsed = parseJsonBody<AnthropicModelsResponseBody>(body);
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
