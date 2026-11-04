import fetch from "@server/utils/fetch";
import { anthropicAdaptor } from "./anthropic";
import { geminiAdaptor } from "./gemini";
import { openaiAdaptor } from "./openai";
import type {
  Adaptor,
  BuiltRequest,
  ChatRequest,
  ChatResponse,
} from "./types";

export type { Adaptor, BuiltRequest, ChatRequest, ChatResponse, ChatUsage } from "./types";
export type { ModelProviderProtocol } from "@shared/aiVendorTemplates";

/**
 * Returns the adaptor for a provider protocol, falling back to the OpenAI
 * compatible implementation for unknown values.
 *
 * @param protocol The configured protocol.
 * @returns The adaptor implementation.
 */
export function getAdaptor(protocol: string): Adaptor {
  switch (protocol) {
    case "anthropic":
      return anthropicAdaptor;
    case "gemini":
      return geminiAdaptor;
    default:
      return openaiAdaptor;
  }
}

/** Default timeout for one upstream chat call. */
const CHAT_TIMEOUT = 60000;

/**
 * Executes one chat completion against an upstream provider using the given
 * protocol's adaptor. Private addresses are allowed so self-hosted gateways
 * (e.g. Ollama) work out of the box.
 *
 * @param props The call description.
 * @param props.baseUrl The endpoint base URL.
 * @param props.apiKey The decrypted API key.
 * @param props.protocol The provider protocol.
 * @param props.req The unified chat request.
 * @param props.timeout Optional timeout in milliseconds.
 * @param props.signal Optional abort signal.
 * @returns The reply text and token usage.
 * @throws Error when the upstream call fails or returns a non-2xx status.
 */
export async function executeChat(props: {
  baseUrl: string;
  apiKey: string;
  protocol: string;
  req: ChatRequest;
  timeout?: number;
  signal?: AbortSignal;
}): Promise<ChatResponse> {
  const adaptor = getAdaptor(props.protocol);
  const built = adaptor.buildRequest(props.baseUrl, props.apiKey, props.req);
  const response = await fetch(built.url, {
    method: "POST",
    headers: built.headers,
    body: built.body,
    timeout: props.timeout ?? CHAT_TIMEOUT,
    ...(props.signal ? { signal: props.signal } : {}),
    allowPrivateIPAddress: true,
  });
  const body = await response.text();

  if (!response.ok) {
    throw adaptor.parseError(body, response.status);
  }

  return adaptor.parseResponse(body);
}

/**
 * Fetches the model list available upstream for the given credentials.
 *
 * @param props The provider description.
 * @param props.baseUrl The endpoint base URL.
 * @param props.apiKey The API key to use.
 * @param props.protocol The provider protocol.
 * @returns The sorted model ids.
 * @throws Error when the upstream call fails.
 */
export async function fetchUpstreamModels(props: {
  baseUrl: string;
  apiKey: string;
  protocol: string;
}): Promise<string[]> {
  const adaptor = getAdaptor(props.protocol);
  const built: BuiltRequest = adaptor.buildListModelsRequest(
    props.baseUrl,
    props.apiKey
  );
  const response = await fetch(built.url, {
    method: "GET",
    headers: built.headers,
    timeout: 15000,
    allowPrivateIPAddress: true,
  });
  const body = await response.text();

  if (!response.ok) {
    throw adaptor.parseError(body, response.status);
  }

  return adaptor.parseListModelsResponse(body);
}
