/**
 * Client-side preferences for the bilingual module, stored in localStorage
 * until they graduate into workspace preferences. Keys and defaults match
 * the server-side TeamPreference values.
 */

const TRIGGER_KEY = "bilingual-translation-trigger";
const GRAMMAR_ENABLED_KEY = "bilingual-grammar-enabled";
const GRAMMAR_LEVEL_KEY = "bilingual-grammar-level";

/** Valid translation trigger modes. */
export type TranslationTriggerMode = "off" | "dot" | "hover";

/**
 * Reads the translation trigger mode.
 *
 * @returns The configured trigger mode, "dot" by default.
 */
export function translationTrigger(): TranslationTriggerMode {
  const value = localStorage.getItem(TRIGGER_KEY);
  return value === "off" || value === "hover" || value === "dot"
    ? value
    : "dot";
}

/**
 * Persists the translation trigger mode.
 *
 * @param mode The trigger mode to store.
 */
export function setTranslationTrigger(mode: TranslationTriggerMode): void {
  localStorage.setItem(TRIGGER_KEY, mode);
}

/**
 * Whether grammar checking is enabled.
 *
 * @returns True unless the user disabled it.
 */
export function grammarCheckingEnabled(): boolean {
  return localStorage.getItem(GRAMMAR_ENABLED_KEY) !== "off";
}

/**
 * Persists the grammar checking toggle.
 *
 * @param enabled Whether checking should be enabled.
 */
export function setGrammarCheckingEnabled(enabled: boolean): void {
  localStorage.setItem(GRAMMAR_ENABLED_KEY, enabled ? "on" : "off");
}

/**
 * Reads the grammar rule level.
 *
 * @returns "default" or "picky", defaulting to "default".
 */
export function grammarLevel(): "default" | "picky" {
  return localStorage.getItem(GRAMMAR_LEVEL_KEY) === "picky"
    ? "picky"
    : "default";
}

/**
 * Persists the grammar rule level.
 *
 * @param level The level to store.
 */
export function setGrammarLevel(level: "default" | "picky"): void {
  localStorage.setItem(GRAMMAR_LEVEL_KEY, level);
}
