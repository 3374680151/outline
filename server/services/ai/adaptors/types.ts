/** The role of a chat message, in the unified OpenAI-style format. */
export type ChatRole = "system" | "user" | "assistant";

/** One chat message of the unified request. */
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/**
 * A unified chat completion request. Callers describe the call once in this
 * OpenAI-style shape and the active adaptor translates it to the vendor
 * protocol.
 */
export interface ChatRequest {
  /** The model name to invoke. */
  model: string;
  /** The messages, in order. */
  messages: ChatMessage[];
  /** Sampling temperature. */
  temperature: number;
  /** Maximum number of tokens to generate. */
  maxTokens: number;
}

/** Token usage reported by one chat completion. */
export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** The text and token usage of one completed chat call. */
export interface ChatResponse {
  text: string;
  usage: ChatUsage;
}

/** An HTTP request ready to be sent to an upstream provider. */
export interface BuiltRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/**
 * A vendor protocol implementation. Adaptors are pure: they build requests
 * and parse responses, but never perform network I/O themselves.
 */
export interface Adaptor {
  /**
   * Builds the HTTP request for a chat completion.
   *
   * @param baseUrl The configured endpoint base URL.
   * @param apiKey The decrypted API key.
   * @param req The unified chat request.
   * @returns The request ready to be sent.
   */
  buildRequest(baseUrl: string, apiKey: string, req: ChatRequest): BuiltRequest;

  /**
   * Parses a successful (2xx) response body.
   *
   * @param body The raw response body.
   * @returns The reply text and token usage.
   */
  parseResponse(body: string): ChatResponse;

  /**
   * Converts a non-2xx response body into a readable error.
   *
   * @param body The raw response body.
   * @param status The HTTP status code.
   * @returns The error to surface.
   */
  parseError(body: string, status: number): Error;

  /**
   * Builds the HTTP request that lists the models available upstream.
   *
   * @param baseUrl The configured endpoint base URL.
   * @param apiKey The decrypted API key.
   * @returns The request ready to be sent.
   */
  buildListModelsRequest(baseUrl: string, apiKey: string): BuiltRequest;

  /**
   * Parses a successful model listing response.
   *
   * @param body The raw response body.
   * @returns The model ids, sorted.
   */
  parseListModelsResponse(body: string): string[];
}
