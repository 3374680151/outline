/**
 * Global styles for the bilingual editor's ProseMirror decorations. These
 * render inside ProseMirror DOM that is built outside React, so they are
 * injected as a plain style element once per page. Colors are fixed to the
 * Outline base palette, which is shared between light and dark themes and
 * keeps sufficient contrast on both.
 */

const STYLE_ID = "bilingual-editor-styles";

const CSS = `
.bilingual-mirror-flash {
  background: rgba(47, 158, 99, 0.16);
  outline: 1.5px solid rgba(47, 158, 99, 0.5);
  border-radius: 3px;
  transition: background 0.9s ease, outline-color 0.9s ease;
}

@media (prefers-reduced-motion: reduce) {
  .bilingual-mirror-flash {
    transition: none;
  }
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
