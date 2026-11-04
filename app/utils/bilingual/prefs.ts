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

/** One-time migration of pre-preference localStorage values into the user's
 * server-side preferences; the sentinel keeps it at most once per profile. */
const MIGRATION_DONE_KEY = "bilingual-prefs-migrated-v2";
const LEGACY_TARGET_LANG_KEY = "bilingual-translation-target-lang";
const LEGACY_PROVIDER_KEY = "bilingual-translation-provider";

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

  const targetLang = localStorage.getItem(LEGACY_TARGET_LANG_KEY);

  if (targetLang) {
    user.setPreference(UserPreference.BilingualTargetLang, targetLang);
  }

  const provider = localStorage.getItem(LEGACY_PROVIDER_KEY);

  if (provider) {
    user.setPreference(UserPreference.BilingualTranslationProvider, provider);
  }

  void user.save();

  localStorage.removeItem(LEGACY_TARGET_LANG_KEY);
  localStorage.removeItem(LEGACY_PROVIDER_KEY);
}

/**
 * Reads the translation trigger mode.
 *
 * @returns The configured trigger mode, "off" by default — editing assists
 *   stay off until the user enables them from the document header toggles.
 */
export function translationTrigger(): TranslationTriggerMode {
  const user = currentUser();
  return (user?.getPreference(UserPreference.BilingualTranslationTrigger) ??
    "off") as TranslationTriggerMode;
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
 * Whether opening the bilingual view translates content automatically.
 *
 * @returns True by default; false restricts translation to visible blocks on demand.
 */
export function autoTranslateOnOpen(): boolean {
  return (
    currentUser()?.getPreference(UserPreference.BilingualAutoTranslate) ?? true
  );
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

/**
 * Whether selection-driven grammar checking (proofread mode) is enabled.
 *
 * @returns True when the user turned the mode on from the document header.
 */
export function proofreadingEnabled(): boolean {
  return (
    currentUser()?.getPreference(UserPreference.BilingualProofreading) ?? false
  );
}

/**
 * Persists the proofread mode toggle.
 *
 * @param enabled Whether selection-driven grammar checking should be active.
 */
export function setProofreadingEnabled(enabled: boolean): void {
  const user = currentUser();
  user?.setPreference(UserPreference.BilingualProofreading, enabled);
  bumpPrefsVersion();
  scheduleUserSave();
}

/** Common target languages offered in the translate card. */
export const TRANSLATION_TARGET_LANGS: ReadonlyArray<{
  code: string;
  label: string;
}> = [
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
  return (
    currentUser()?.getPreference(UserPreference.BilingualTargetLang) ?? "zh"
  );
}

/**
 * Persists the target language for the translate card.
 *
 * @param lang The target language code.
 */
export function setTranslationTargetLang(lang: string): void {
  const user = currentUser();
  user?.setPreference(UserPreference.BilingualTargetLang, lang);
  bumpPrefsVersion();
  scheduleUserSave();
}

/**
 * Reads the persisted translation provider id ("", automatic).
 *
 * @returns The provider id, or "" for the automatic fallback chain.
 */
export function translationProviderId(): string {
  return (
    currentUser()?.getPreference(UserPreference.BilingualTranslationProvider) ??
    ""
  );
}

/**
 * Persists the translation provider selection.
 *
 * @param providerId The provider id, or "" for automatic.
 */
export function setTranslationProviderId(providerId: string): void {
  const user = currentUser();
  user?.setPreference(UserPreference.BilingualTranslationProvider, providerId);
  bumpPrefsVersion();
  scheduleUserSave();
}
