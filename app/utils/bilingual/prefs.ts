import { observable, runInAction } from "mobx";
import { UserPreference } from "@shared/types";
import stores from "~/stores";

/**
 * Version counter incremented whenever a bilingual preference changes, so
 * non-React consumers (editor extensions) can react to toggles without
 * remounting.
 */
export const bilingualPrefsVersion = observable.box(0);

/**
 * Signals that a bilingual preference changed.
 */
function bumpPrefsVersion(): void {
  runInAction(() => {
    bilingualPrefsVersion.set(bilingualPrefsVersion.get() + 1);
  });
}

/** Debounced persistence so rapid toggles produce one request and no
 * out-of-order responses that would overwrite newer local values. */
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Persists pending preference changes after a short debounce.
 */
function scheduleUserSave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }

  saveTimer = setTimeout(() => {
    saveTimer = null;
    void currentUser()?.save();
  }, 500);
}

/**
 * Bilingual experience preferences. These live in the signed-in user's
 * server-side preferences so they follow the user across devices; localStorage
 * values from earlier builds are migrated once and then removed.
 */

const LEGACY_TRIGGER_KEY = "bilingual-translation-trigger";
const LEGACY_GRAMMAR_ENABLED_KEY = "bilingual-grammar-enabled";
const LEGACY_GRAMMAR_LEVEL_KEY = "bilingual-grammar-level";
const LEGACY_IGNORED_RULES_KEY = "bilingual-grammar-ignored-rules";
const MIGRATION_DONE_KEY = "bilingual-prefs-migrated";

/** Valid translation trigger modes. */
export type TranslationTriggerMode = "off" | "dot" | "hover";

/**
 * The current user, or undefined before sign-in.
 *
 * @returns The user model, when available.
 */
function currentUser() {
  return stores.auth.user;
}

/**
 * Moves pre-preference localStorage values into the user's server-side
 * preferences. Runs at most once per browser profile.
 */
export function migrateLegacyPreferences(): void {
  if (localStorage.getItem(MIGRATION_DONE_KEY)) {
    return;
  }

  localStorage.setItem(MIGRATION_DONE_KEY, "1");
  const user = currentUser();

  if (!user) {
    return;
  }

  const trigger = localStorage.getItem(LEGACY_TRIGGER_KEY);

  if (trigger === "off" || trigger === "dot" || trigger === "hover") {
    user.setPreference(UserPreference.BilingualTranslationTrigger, trigger);
  }

  const grammar = localStorage.getItem(LEGACY_GRAMMAR_ENABLED_KEY);

  if (grammar === "off") {
    user.setPreference(UserPreference.BilingualGrammarChecking, false);
  }

  const level = localStorage.getItem(LEGACY_GRAMMAR_LEVEL_KEY);

  if (level === "picky" || level === "default") {
    user.setPreference(UserPreference.BilingualGrammarLevel, level);
  }

  try {
    const raw = localStorage.getItem(LEGACY_IGNORED_RULES_KEY);
    const rules = raw ? (JSON.parse(raw) as unknown) : null;

    if (Array.isArray(rules) && rules.length > 0) {
      user.setPreference(
        UserPreference.BilingualGrammarIgnoredRules,
        rules.filter((rule): rule is string => typeof rule === "string")
      );
    }
  } catch (_err) {
    // Malformed legacy value; ignore it.
  }

  void user.save();

  for (const key of [
    LEGACY_TRIGGER_KEY,
    LEGACY_GRAMMAR_ENABLED_KEY,
    LEGACY_GRAMMAR_LEVEL_KEY,
    LEGACY_IGNORED_RULES_KEY,
  ]) {
    localStorage.removeItem(key);
  }
}

/**
 * Reads the translation trigger mode.
 *
 * @returns The configured trigger mode, "dot" by default.
 */
export function translationTrigger(): TranslationTriggerMode {
  const user = currentUser();
  return (user?.getPreference(UserPreference.BilingualTranslationTrigger) ??
    "dot") as TranslationTriggerMode;
}

/**
 * Persists the translation trigger mode.
 *
 * @param mode The trigger mode to store.
 */
export function setTranslationTrigger(mode: TranslationTriggerMode): void {
  const user = currentUser();
  user?.setPreference(UserPreference.BilingualTranslationTrigger, mode);
  bumpPrefsVersion();
  scheduleUserSave();
}

/**
 * Whether grammar checking is enabled for this user.
 *
 * @returns True unless the user disabled it.
 */
export function grammarCheckingEnabled(): boolean {
  return currentUser()?.getPreference(
    UserPreference.BilingualGrammarChecking
  ) ?? true;
}

/**
 * Persists the grammar checking toggle.
 *
 * @param enabled Whether checking should be enabled.
 */
export function setGrammarCheckingEnabled(enabled: boolean): void {
  const user = currentUser();
  user?.setPreference(UserPreference.BilingualGrammarChecking, enabled);
  bumpPrefsVersion();
  scheduleUserSave();
}

/**
 * Reads the grammar rule level.
 *
 * @returns "default" or "picky", defaulting to "default".
 */
export function grammarLevel(): "default" | "picky" {
  return (currentUser()?.getPreference(UserPreference.BilingualGrammarLevel) ??
    "default") as "default" | "picky";
}

/**
 * Persists the grammar rule level.
 *
 * @param level The level to store.
 */
export function setGrammarLevel(level: "default" | "picky"): void {
  const user = currentUser();
  user?.setPreference(UserPreference.BilingualGrammarLevel, level);
  bumpPrefsVersion();
  scheduleUserSave();
}

/**
 * The rule ids the user has chosen to ignore.
 *
 * @returns The ignored rule ids.
 */
export function grammarIgnoredRules(): string[] {
  return (
    currentUser()?.getPreference(
      UserPreference.BilingualGrammarIgnoredRules
    ) ?? []
  );
}

/**
 * Persists an ignored rule id.
 *
 * @param ruleId The rule id to ignore.
 * @returns The updated ignored rule ids.
 */
export function addGrammarIgnoredRule(ruleId: string): string[] {
  const rules = [...new Set([...grammarIgnoredRules(), ruleId])];
  const user = currentUser();
  user?.setPreference(UserPreference.BilingualGrammarIgnoredRules, rules);
  bumpPrefsVersion();
  scheduleUserSave();
  return rules;
}

/**
 * Whether opening the bilingual view translates content automatically.
 *
 * @returns True by default; false restricts translation to visible blocks on demand.
 */
export function autoTranslateOnOpen(): boolean {
  return currentUser()?.getPreference(UserPreference.BilingualAutoTranslate) ?? true;
}

/**
 * Persists the automatic translation toggle.
 *
 * @param enabled Whether content should translate automatically.
 */
export function setAutoTranslateOnOpen(enabled: boolean): void {
  const user = currentUser();
  user?.setPreference(UserPreference.BilingualAutoTranslate, enabled);
  bumpPrefsVersion();
  scheduleUserSave();
}

const TRANSLATION_TARGET_LANG_KEY = "bilingual-translation-target-lang";
const TRANSLATION_PROVIDER_KEY = "bilingual-translation-provider";

/** Common target languages offered in the translate card. */
export const TRANSLATION_TARGET_LANGS: ReadonlyArray<{ code: string; label: string }> = [
  { code: "zh", label: "中文" },
  { code: "en", label: "English" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "es", label: "Español" },
];

/**
 * Reads the persisted target language for the translate card.
 *
 * @returns The target language code, "zh" by default.
 */
export function translationTargetLang(): string {
  return localStorage.getItem(TRANSLATION_TARGET_LANG_KEY) || "zh";
}

/**
 * Persists the target language for the translate card.
 *
 * @param lang The target language code.
 */
export function setTranslationTargetLang(lang: string): void {
  localStorage.setItem(TRANSLATION_TARGET_LANG_KEY, lang);
}

/**
 * Reads the persisted translation provider id ("", automatic).
 *
 * @returns The provider id, or "" for the automatic fallback chain.
 */
export function translationProviderId(): string {
  return localStorage.getItem(TRANSLATION_PROVIDER_KEY) ?? "";
}

/**
 * Persists the translation provider selection.
 *
 * @param providerId The provider id, or "" for automatic.
 */
export function setTranslationProviderId(providerId: string): void {
  localStorage.setItem(TRANSLATION_PROVIDER_KEY, providerId);
}
