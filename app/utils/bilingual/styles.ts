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
  cursor: pointer;
}

.bilingual-grammar-typo {
  text-decoration-color: #dc2626;
  background: rgba(220, 38, 38, 0.07);
}

.bilingual-grammar-grammar {
  text-decoration-color: #d97706;
  background: rgba(217, 119, 6, 0.07);
}

.bilingual-grammar-punct {
  text-decoration-color: #2563eb;
  background: rgba(37, 99, 235, 0.07);
}

.bilingual-grammar-style {
  text-decoration-color: #7c3aed;
  text-decoration-style: dotted;
  background: rgba(124, 58, 237, 0.07);
}

.bilingual-grammar-other {
  text-decoration-color: #64748b;
  background: rgba(100, 116, 139, 0.07);
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
