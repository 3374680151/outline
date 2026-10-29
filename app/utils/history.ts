import type {
  Location,
  LocationDescriptor,
  LocationDescriptorObject,
  LocationState,
} from "history";
import { createBrowserHistory, createPath, parsePath } from "history";
import { isMobile } from "@shared/utils/browser";
import {
  getFocusedSplitPane,
  getSplitPath,
  isBilingualView,
  isSplitViewModifierPressed,
  isSplitViewNavigationSuppressed,
  isSplittablePath,
  openRouteInSplit,
  setBilingualFlag,
  setSplitPath,
} from "./splitView";

/**
 * Creates a location descriptor from an existing location with the given fields
 * overridden. Only the pathname, search, hash, and state are carried over so
 * that internal fields (such as key) are not duplicated into the new entry.
 *
 * @param location The location to patch, typically history.location.
 * @param patch The location fields to override.
 * @returns A location descriptor suitable for history.push or history.replace.
 */
export function patchLocation(
  location: Location,
  patch: LocationDescriptorObject
): LocationDescriptorObject {
  const { pathname, search, hash, state } = location;
  return { pathname, search, hash, state, ...patch };
}

/**
 * Normalizes the arguments accepted by history.push and history.replace into
 * a location descriptor object.
 *
 * @param to the path or location descriptor passed to the history method.
 * @param state optional location state, used when `to` is a string.
 * @returns a location descriptor object.
 */
export function toLocationDescriptor(
  to: LocationDescriptor,
  state?: LocationState
): LocationDescriptorObject {
  if (typeof to === "string") {
    const location = parsePath(to);
    return state === undefined ? location : { ...location, state };
  }

  return to;
}

const history = createBrowserHistory();

/**
 * Applies split view handling to a navigation. While a split view is open:
 *
 * - Navigation to a route that cannot render in a pane closes the split view.
 * - Pushes are directed to the secondary pane when it has focus, keeping the
 *   primary route unchanged.
 * - All other navigation keeps the split view open by carrying the split
 *   query parameter over to the new location.
 */
function applySplitView(
  descriptor: LocationDescriptorObject,
  isReplace: boolean
): LocationDescriptorObject {
  if (isSplitViewNavigationSuppressed()) {
    return descriptor;
  }

  const current = history.location;
  const currentSplit = getSplitPath(current.search);
  if (currentSplit === undefined) {
    return descriptor;
  }

  // A location that explicitly includes the split parameter is used verbatim.
  if (getSplitPath(descriptor.search ?? "") !== undefined) {
    return descriptor;
  }

  const pathname = descriptor.pathname ?? current.pathname;
  if (!isSplittablePath(pathname)) {
    return descriptor;
  }

  if (!isReplace && getFocusedSplitPane() === "secondary") {
    // Navigation from within the secondary pane stays in the pane. The
    // bilingual flag does not survive: the toolbar and mirror semantics
    // belong to the primary pane's pair.
    return patchLocation(current, {
      search: setSplitPath(
        setBilingualFlag(current.search, false),
        createPath({
          pathname,
          search: descriptor.search,
          hash: descriptor.hash,
        })
      ),
    });
  }

  // In the bilingual view the user works on the pair as a single unit:
  // navigating the primary pane to anything else is a deliberate jump out
  // of the bilingual mode, so the destination opens full width instead of
  // carrying the split along and showing two unrelated documents side by
  // side.
  if (isBilingualView(current.search)) {
    return {
      ...descriptor,
      search: setBilingualFlag(setSplitPath(descriptor.search ?? "", undefined), false),
    };
  }

  return {
    ...descriptor,
    search: setSplitPath(descriptor.search ?? "", currentSplit),
  };
}

const browserPush = history.push.bind(history);
const browserReplace = history.replace.bind(history);

/**
 * Whether a navigation should be redirected into the secondary pane of the
 * split view because the split view modifier is held.
 */
function shouldOpenInSplit(descriptor: LocationDescriptorObject): boolean {
  if (
    isSplitViewNavigationSuppressed() ||
    !isSplitViewModifierPressed() ||
    isMobile()
  ) {
    return false;
  }

  // Location state cannot be represented in the split query parameter, so
  // routes that rely on it must navigate normally.
  return (
    descriptor.state === undefined &&
    !!descriptor.pathname &&
    isSplittablePath(descriptor.pathname)
  );
}

history.push = (to: LocationDescriptor, state?: LocationState) => {
  const descriptor = toLocationDescriptor(to, state);

  if (shouldOpenInSplit(descriptor)) {
    openRouteInSplit(history, createPath(descriptor));
    return;
  }

  browserPush(applySplitView(descriptor, false));
};

history.replace = (to: LocationDescriptor, state?: LocationState) =>
  browserReplace(applySplitView(toLocationDescriptor(to, state), true));

export default history;
