/**
 * Global styles for grammar underline decorations and sentence issue dots.
 * These render inside ProseMirror DOM that is built outside React, so they
 * are injected as a plain style element once per page. Colors are fixed to
 * the Outline base palette, which is shared between light and dark themes
 * and keeps sufficient contrast on both.
 */

const STYLE_ID = "bilingual-editor-styles";

const CSS = `
.bilingual-underline {
  text-decoration-line: underline;
  text-decoration-style: wavy;
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
}

.bilingual-grammar-typo {
  text-decoration-color: #ed2651;
}

.bilingual-grammar-grammar {
  text-decoration-color: #0366d6;
}

.bilingual-grammar-style {
  text-decoration-color: #f08a24;
  text-decoration-style: dotted;
}

.bilingual-issue-dots {
  display: inline-flex;
  gap: 5px;
  margin-left: 8px;
  vertical-align: middle;
  pointer-events: auto;
}

.bilingual-issue-dot {
  width: 8px;
  height: 8px;
  min-width: 8px;
  min-height: 8px;
  border-radius: 50%;
  border: none;
  padding: 0;
  cursor: pointer;
  box-shadow: 0 0 0 2px rgba(128, 128, 128, 0.15);
}

.bilingual-issue-dot.bilingual-grammar-typo {
  background: #ed2651;
}

.bilingual-issue-dot.bilingual-grammar-grammar {
  background: #0366d6;
}

.bilingual-issue-dot.bilingual-grammar-style {
  background: #f08a24;
}
`;

/**
 * Ensures the bilingual editor style element exists in the document head.
 */
export function ensureBilingualStyles(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}
