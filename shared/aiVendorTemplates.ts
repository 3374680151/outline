/** Protocols a model provider can speak. */
export type ModelProviderProtocol = "openai" | "anthropic" | "gemini";

/** How a vendor template is intended to be used. */
export type AiVendorKind = "official" | "relay" | "local";

/** One preconfigured vendor the settings UI can quick-fill from. */
export interface AiVendorTemplate {
  /** Stable vendor slug. */
  vendor: string;
  /** Display name. */
  name: string;
  /** Default protocol of the vendor's endpoint. */
  protocol: ModelProviderProtocol;
  /** Prefilled endpoint base URL, editable by the user. */
  baseUrl: string;
  /** official = direct official API, relay = aggregator, local = self-hosted. */
  kind: AiVendorKind;
}

/**
 * Vendor catalog for the "add model provider" form, ported from the
 * FluentRead-Go vendor templates. Picking a template prefills the protocol,
 * endpoint, and name; the user only adds their API key.
 */
export const aiVendorTemplates: AiVendorTemplate[] = [
  {
    vendor: "deepseek",
    name: "DeepSeek",
    protocol: "openai",
    baseUrl: "https://api.deepseek.com",
    kind: "official",
  },
  {
    vendor: "openai",
    name: "OpenAI",
    protocol: "openai",
    baseUrl: "https://api.openai.com/v1",
    kind: "official",
  },
  {
    vendor: "claude",
    name: "Claude",
    protocol: "anthropic",
    baseUrl: "https://api.anthropic.com",
    kind: "official",
  },
  {
    vendor: "gemini",
    name: "Gemini",
    protocol: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com",
    kind: "official",
  },
  {
    vendor: "kimi",
    name: "Kimi",
    protocol: "openai",
    baseUrl: "https://api.moonshot.cn/v1",
    kind: "official",
  },
  {
    vendor: "glm",
    name: "GLM",
    protocol: "openai",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    kind: "official",
  },
  {
    vendor: "qwen",
    name: "Qwen",
    protocol: "openai",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    kind: "official",
  },
  {
    vendor: "minimax",
    name: "MiniMax",
    protocol: "openai",
    baseUrl: "https://api.minimaxi.com/v1",
    kind: "official",
  },
  {
    vendor: "siliconflow",
    name: "SiliconFlow",
    protocol: "openai",
    baseUrl: "https://api.siliconflow.cn/v1",
    kind: "relay",
  },
  {
    vendor: "openrouter",
    name: "OpenRouter",
    protocol: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    kind: "relay",
  },
  {
    vendor: "ollama",
    name: "Ollama",
    protocol: "openai",
    baseUrl: "http://127.0.0.1:11434/v1",
    kind: "local",
  },
];
