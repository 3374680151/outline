import type { MarkSpec } from "prosemirror-model";
import { EditorStyleHelper } from "../styles/EditorStyleHelper";
import Mark from "./Mark";

/**
 * Wraps machine translated text that was inserted into the document below its
 * source block. The mark stores a hash of the source text the translation was
 * generated from, so translations can be told apart from manual edits after a
 * reload: when the hash still matches the source text, the translation is
 * current and is never regenerated.
 */
export default class Translation extends Mark {
  get name() {
    return "translation";
  }

  get schema(): MarkSpec {
    return {
      // Coexists with all other marks so translated text keeps its own
      // styling while wrapping any inline content.
      excludes: "",
      inclusive: false,
      attrs: {
        hash: { default: "", validate: "string" },
      },
      parseDOM: [
        {
          tag: `.${EditorStyleHelper.translation}`,
          getAttrs: (dom: HTMLElement) => ({
            hash: dom.getAttribute("data-translation-hash") ?? "",
          }),
        },
      ],
      toDOM: (node) => [
        "span",
        {
          class: EditorStyleHelper.translation,
          "data-translation-hash": node.attrs.hash || undefined,
        },
      ],
    };
  }

  get allowInReadOnly() {
    return true;
  }

  toMarkdown() {
    return {
      open: "",
      close: "",
      mixable: true,
      expelEnclosingWhitespace: true,
    };
  }
}
