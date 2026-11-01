import type GrammarCheckExtension from "~/editor/extensions/GrammarCheck";

/**
 * Registry of the currently mounted grammar check extension. UI that lives
 * outside the owning editor (the translation popover's grammar hint, for
 * example) uses it to reach the active extension and open the issue panel.
 * Only one extension registers at a time: the bilingual target pane is
 * gated off, so the source pane or a standalone document wins.
 */
let activeExtension: GrammarCheckExtension | null = null;

/**
 * Registers the extension of a freshly mounted editor as the active one.
 *
 * @param extension The extension to activate.
 */
export function setActiveGrammarExtension(
  extension: GrammarCheckExtension
): void {
  activeExtension = extension;
}

/**
 * Unregisters an extension when its editor is destroyed, keeping a later
 * registration intact when editors overlap during navigation.
 *
 * @param extension The extension that is going away.
 */
export function clearActiveGrammarExtension(
  extension: GrammarCheckExtension
): void {
  if (activeExtension === extension) {
    activeExtension = null;
  }
}

/**
 * Opens the issue panel of the active grammar extension, if any.
 */
export function openGrammarPanel(): void {
  activeExtension?.openPanel();
}
