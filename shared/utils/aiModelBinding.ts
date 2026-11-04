/** Prefix of a model binding value stored in team preferences. */
export const MODEL_BINDING_PREFIX = "mp:";

/** A parsed model binding value. */
export interface ModelBinding {
  /** The provider row id. */
  providerId: string;
  /** Optional model name overriding the provider default. */
  model?: string;
}

/**
 * Encodes a model binding value for storage in team preferences.
 *
 * @param providerId The provider row id.
 * @param model Optional model name overriding the provider default.
 * @returns The binding value, e.g. "mp:{uuid}:{model}".
 */
export function modelBinding(providerId: string, model?: string): string {
  return model
    ? `${MODEL_BINDING_PREFIX}${providerId}:${model}`
    : `${MODEL_BINDING_PREFIX}${providerId}`;
}

/**
 * Parses a model binding value from team preferences.
 *
 * @param binding The stored binding value.
 * @returns The provider id and optional model, or null when malformed.
 */
export function parseModelBinding(
  binding: string
): ModelBinding | null {
  if (!binding.startsWith(MODEL_BINDING_PREFIX)) {
    return null;
  }

  const rest = binding.slice(MODEL_BINDING_PREFIX.length);

  if (rest.length < 36) {
    return null;
  }

  const providerId = rest.slice(0, 36);
  const model =
    rest.length > 36 ? rest.slice(36 + 1) : undefined;

  return {
    providerId,
    ...(model ? { model } : {}),
  };
}
