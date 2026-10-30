import * as React from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "styled-components";
import { buildDarkTheme, buildLightTheme } from "@shared/styles/theme";
import { Theme } from "~/stores/UiStore";
import stores from "~/stores";

/** A mounted React overlay outside the editor DOM tree. */
export interface ReactOverlay {
  /** The root element appended to document.body. */
  container: HTMLDivElement;
  /** Updates the rendered element. */
  render: (element: React.ReactElement) => void;
  /** Unmounts and removes the container. */
  destroy: () => void;
}

/**
 * Mounts a React overlay directly on document.body with the application
 * theme provided. Used for editor popovers whose anchor lives inside
 * ProseMirror but which must escape scroll containers and clipping.
 *
 * @param zIndex The z-index for the overlay container.
 * @returns The overlay handle.
 */
export function mountReactOverlay(zIndex: number): ReactOverlay {
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.zIndex = String(zIndex);
  document.body.appendChild(container);
  const root = createRoot(container);

  const render = (element: React.ReactElement) => {
    // Overlays mount outside the React tree, so rebuild the base theme for
    // them; custom theme nuances are acceptable to lose on these popovers.
    const theme =
      stores.ui.resolvedTheme === Theme.Dark
        ? buildDarkTheme({})
        : buildLightTheme({});
    root.render(<ThemeProvider theme={theme}>{element}</ThemeProvider>);
  };

  return {
    container,
    render,
    destroy: () => {
      // Detach first so React's unmount does not fight the removal.
      setTimeout(() => {
        root.unmount();
        container.remove();
      }, 0);
    },
  };
}

/** Safe viewport insets used when clamping floating UI. */
export const VIEWPORT_INSET = 12;

/**
 * Clamps a floating panel position into the visual viewport.
 *
 * The panel is placed below the anchor when it fits, which keeps it clear of
 * the document header and title. It only flips above when there is not enough
 * room underneath and more room above, so the placement stays predictable.
 *
 * @param anchor The anchor rect to place the panel against.
 * @param size The panel size.
 * @param gap Gap between the anchor and the panel.
 * @returns The clamped top-left position and whether it is placed above.
 */
export function clampPanelPosition(
  anchor: { left: number; right: number; top: number; bottom: number },
  size: { width: number; height: number },
  gap = 10
): { left: number; top: number; above: boolean } {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  const spaceBelow =
    viewportHeight - VIEWPORT_INSET - anchor.bottom - gap;
  const spaceAbove = anchor.top - gap - VIEWPORT_INSET;
  const above = spaceBelow < size.height && spaceAbove > spaceBelow;

  const top = above
    ? Math.max(VIEWPORT_INSET, anchor.top - gap - size.height)
    : Math.min(
        viewportHeight - VIEWPORT_INSET - size.height,
        anchor.bottom + gap
      );
  const left = Math.min(
    Math.max(VIEWPORT_INSET, anchor.left),
    viewportWidth - VIEWPORT_INSET - size.width
  );

  return { left: Math.max(VIEWPORT_INSET, left), top, above };
}
