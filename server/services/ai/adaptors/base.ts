/** Matches a standalone version path segment, e.g. "v1", "v2", "v1beta". */
const versionSegmentRe = /^v\d+[a-z0-9]*$/;

/**
 * Normalizes an endpoint base URL: trims whitespace and trailing slashes and
 * removes a single trailing "/v1" so resource paths can be appended without
 * producing "/v1/v1".
 *
 * @param base The configured base URL.
 * @returns The normalized base URL without a trailing version segment.
 */
export function normalizeBaseURL(base: string): string {
  const trimmed = base.trim().replace(/\/+$/, "");
  return trimmed.replace(/\/v1$/, "");
}

/**
 * Detects whether the URL path already contains a version segment. OpenAI
 * compatible endpoints vary here: "/v1" is the convention, but e.g. GLM uses
 * "/api/paas/v4" and Gemini's compatibility layer uses "/v1/openai". When a
 * version segment is present the resource path is appended directly instead
 * of forcing "/v1".
 *
 * @param base The normalized base URL.
 * @returns True when a version segment exists in the path.
 */
export function hasVersionSegment(base: string): boolean {
  try {
    const path = new URL(base).pathname;
    return path.split("/").some((segment) => versionSegmentRe.test(segment));
  } catch (_err) {
    return false;
  }
}

/**
 * Builds the chat URL for an OpenAI compatible endpoint, appending "/v1"
 * only when the base URL does not already carry a version segment.
 *
 * @param base The configured base URL.
 * @param resource The resource path, e.g. "chat/completions".
 * @returns The full endpoint URL.
 */
export function openaiURL(base: string, resource: string): string {
  const normalized = normalizeBaseURL(base);
  return hasVersionSegment(normalized)
    ? `${normalized}/${resource}`
    : `${normalized}/v1/${resource}`;
}

/**
 * Truncates a response body for use in error messages so whole responses are
 * never written into errors or logs.
 *
 * @param body The raw response body.
 * @returns The truncated snippet.
 */
export function snippet(body: string): string {
  const text = body.trim();
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

/**
 * Builds a consistent upstream error for a non-2xx response.
 *
 * @param status The HTTP status code.
 * @param body The raw response body.
 * @returns The error with a readable message.
 */
export function upstreamError(status: number, body: string): Error {
  return new Error(`Upstream returned ${status}: ${snippet(body)}`);
}

/**
 * Parses a JSON object from a response body, returning null instead of
 * throwing when the body is not valid JSON.
 *
 * @param body The raw response body.
 * @returns The parsed object, or null.
 */
export function parseJsonBody<T>(body: string): T | null {
  try {
    return JSON.parse(body) as T;
  } catch (_err) {
    return null;
  }
}
