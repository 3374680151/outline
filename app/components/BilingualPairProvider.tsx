import { action, reaction } from "mobx";
import { observer } from "mobx-react";
import * as React from "react";
import { TeamPreference } from "@shared/types";
import type { BilingualPairDTO } from "@shared/types/bilingual";
import type GrammarCheckExtension from "~/editor/extensions/GrammarCheck";
import useCurrentTeam from "~/hooks/useCurrentTeam";
import useCurrentUser from "~/hooks/useCurrentUser";
import { useLocationSelector } from "~/hooks/useLocationSelector";
import usePolicy from "~/hooks/usePolicy";
import useStores from "~/hooks/useStores";
import BilingualStore from "~/stores/BilingualStore";
import { MirrorEngine } from "~/utils/bilingual/mirrorEngine";
import { migrateLegacyPreferences } from "~/utils/bilingual/prefs";
import history from "~/utils/history";
import {
  getSplitPath,
  isBilingualView,
  setBilingualFlag,
  setSplitPath,
} from "~/utils/splitView";
import stores from "~/stores";
import { documentPath } from "~/utils/routeHelpers";

/** Which side of the active pair a document is. */
export type BilingualSide = "source" | "target";

/**
 * Value provided to editors and the bilingual toolbar while the bilingual
 * view is engaged.
 */
export interface BilingualPairContextValue {
  /** Whether the bilingual flag is present in the URL. */
  requested: boolean;
  /** Whether a pair is resolved and the mirror engine is live. */
  active: boolean;
  /** The active pair, when resolved. */
  pair: BilingualPairDTO | null;
  /** The mirror engine driving the two panes. */
  engine: MirrorEngine | null;
  /**
   * Returns the side of the given document in the active pair.
   *
   * @param documentId The document to look up.
   * @returns The side, or undefined when the document is not in the pair.
   */
  sideOf: (documentId: string) => BilingualSide | undefined;
  /**
   * Registers the source pane's grammar extension so the toolbar can show
   * issue counts and open the issue panel.
   *
   * @param extension The extension instance, or null on unmount.
   */
  registerGrammarExtension: (extension: GrammarCheckExtension | null) => void;
  /** The registered grammar extension of the source pane. */
  grammarExtension: GrammarCheckExtension | null;
  /**
   * Exits the bilingual view, leaving the primary document in place.
   */
  exit: () => void;
}

const BilingualPairContext = React.createContext<BilingualPairContextValue>({
  requested: false,
  active: false,
  pair: null,
  engine: null,
  sideOf: () => undefined,
  registerGrammarExtension: () => undefined,
  grammarExtension: null,
  exit: () => undefined,
});

/**
 * Returns the bilingual pair context. Safe to read anywhere in the
 * authenticated layout; fields are inert when bilingual mode is off.
 *
 * @returns The context value.
 */
export function useBilingualPair(): BilingualPairContextValue {
  return React.useContext(BilingualPairContext);
}

/**
 * Provides the bilingual editing mode over the native split view: resolves
 * the pair for the primary document, opens the mirror document in the
 * secondary pane, owns the mirror engine while the view is open, and keeps
 * the mirror title in sync with the source title.
 */


export const BilingualPairProvider = observer(function BilingualPairProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { documents } = useStores();
  const user = useCurrentUser({ rejectOnEmpty: false });
  const team = useCurrentTeam({ rejectOnEmpty: false });
  const [pair, setPair] = React.useState<BilingualPairDTO | null>(null);
  const [pairSettled, setPairSettled] = React.useState(false);
  const [grammarExtension, setGrammarExtension] =
    React.useState<GrammarCheckExtension | null>(null);

  const requested = useLocationSelector((location) =>
    isBilingualView(location.search)
  );
  const splitPath = useLocationSelector((location) =>
    getSplitPath(location.search)
  );
  const primaryDocumentId = useLocationSelector((location) => {
    const match = /^\/doc\/[0-9a-zA-Z-_~]*-[a-zA-Z0-9]{10,15}/.exec(
      location.pathname
    );
    const slug = match?.[0].slice("/doc/".length);
    return slug ? documents.get(slug)?.id ?? null : null;
  });
  // The split parameter holds a document path (urlId slug), so it must be
  // resolved through the store to compare against the pair's document ids.
  const splitDocumentId = useLocationSelector((location) => {
    const splitPath = getSplitPath(location.search);

    if (!splitPath) {
      return null;
    }

    const match = /^\/doc\/([0-9a-zA-Z-_~]*-[a-zA-Z0-9]{10,15})/.exec(splitPath);
    const slug = match?.[1];
    return slug ? documents.get(slug)?.id ?? null : null;
  });
  const primaryDocument = primaryDocumentId
    ? documents.get(primaryDocumentId)
    : undefined;
  const can = usePolicy(primaryDocument);
  React.useEffect(() => {
    migrateLegacyPreferences();

    // Warm the pair index once per session so bilingual documents can be
    // badged everywhere without a lookup, and the index page opens instantly.
    void BilingualStore.listPairs().catch(() => {
      // Not signed in yet, or the module is disabled – badges simply stay off.
    });
  }, [user?.id]);

  // Resolve the pair for the primary document while the flag is set. When
  // the workspace module is disabled, or the document cannot be updated and
  // no pair exists, the flag is stripped again.
  React.useEffect(() => {
    if (!requested || !primaryDocumentId) {
      setPair(null);
      setPairSettled(!requested);
      return;
    }

    if (
      team &&
      team.getPreference(TeamPreference.BilingualEditor) === false
    ) {
      history.replace(setBilingualFlag(history.location.search, false));
      return;
    }

    let cancelled = false;

    const resolve = async () => {
      const cached = BilingualStore.peekInfo(primaryDocumentId);

      if (cached) {
        if (!cancelled) {
          setPair(cached.pair);
          setPairSettled(true);
        }
        return;
      }

      try {
        const info = await BilingualStore.fetchInfo(primaryDocumentId);

        if (!cancelled) {
          setPair(info.pair);
          setPairSettled(true);
        }
      } catch (_err) {
        if (!cancelled) {
          setPair(null);
          setPairSettled(true);
        }
      }
    };

    void resolve();
    return () => {
      cancelled = true;
    };
  }, [requested, primaryDocumentId, team]);

  const pairActive =
    !!pair && !!splitDocumentId && splitDocumentId === pair.targetDocumentId;

  // When the flag is set but no split pane is open yet (direct load or the
  // legacy bilingual route redirect), open the mirror pane. Documents that
  // cannot be updated never get a pair, so nothing opens for them.
  React.useEffect(() => {
    if (!requested || !pair || splitPath) {
      return;
    }

    const target = documents.get(pair.targetDocumentId);
    const path = target
      ? documentPath(target)
      : `/doc/${pair.targetDocumentId}`;

    history.replace(setSplitPath(setBilingualFlag(history.location.search, true), path));
  }, [requested, pair, splitPath, documents]);

  // If the flag is set but the split pane shows a document that is
  // definitively not the pair's mirror, the bilingual semantics no longer
  // hold: strip the flag quietly. A null splitDocumentId means the split
  // path has not resolved through the store yet (or the pair is still
  // loading) and must not be treated as a mismatch.
  React.useEffect(() => {
    if (!requested || !splitPath || !pair) {
      return;
    }

    if (splitDocumentId !== null && splitDocumentId !== pair.targetDocumentId) {
      history.replace(setBilingualFlag(history.location.search, false));
    }
  }, [requested, splitPath, splitDocumentId, pair]);

  // Once resolution has settled without a pair there is nothing bilingual
  // to show on this document; the flag is stripped so the split pane (if
  // any) degrades to a regular split view.
  React.useEffect(() => {
    if (requested && pairSettled && pair === null) {
      // Confirm against the store after a beat: the pair may resolve while
      // this timer runs (entry points race the provider's own lookup).
      const timer = setTimeout(() => {
        const confirmed = primaryDocumentId
          ? BilingualStore.peekInfo(primaryDocumentId)
          : null;

        if (!confirmed?.pair) {
          history.replace(setBilingualFlag(history.location.search, false));
        }
      }, 1500);
      return () => clearTimeout(timer);
    }

    return undefined;
  }, [requested, pairSettled, pair, primaryDocumentId]);

  void can;

  // One mirror engine per pair, alive while the view is active. Held in
  // state so every consumer (toolbar, extensions) observes the same current
  // instance even when the active flag flips while the pair resolves.
  const [engine, setEngine] = React.useState<MirrorEngine | null>(null);
  const enginePairIdRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!requested || !pairActive || !pair) {
      enginePairIdRef.current = null;
      setEngine((current) => {
        current?.destroy();
        return null;
      });
      return;
    }

    if (enginePairIdRef.current === pair.id) {
      return;
    }

    enginePairIdRef.current = pair.id;
    setEngine((current) => {
      current?.destroy();

      const next = new MirrorEngine();
      next.setup(pair.id, pair.blockStates);
      return next;
    });
  }, [requested, pairActive, pair]);

  React.useEffect(() => {
    if (!engine || !pair) {
      return undefined;
    }

    const adopt = action(() => {
      const source = BilingualStore.getView(pair.sourceDocumentId);
      const target = BilingualStore.getView(pair.targetDocumentId);

      engine.adoptViews(source, target);
    });

    adopt();
    const disposeViews = reaction(
      () => [
        !!BilingualStore.views.get(pair.sourceDocumentId),
        !!BilingualStore.views.get(pair.targetDocumentId),
      ],
      () => adopt()
    );

    return () => disposeViews();
  }, [requested, pairActive, pair, splitPath, engine]);

  // Keep the mirror title in sync with the source title. The source is
  // authoritative: editing the title in the primary pane propagates to the
  // mirror after a short debounce.
  const sourceId = pair?.sourceDocumentId;
  const targetId = pair?.targetDocumentId;

  React.useEffect(() => {
    if (!pairActive || !sourceId || !targetId) {
      return;
    }

    const source = documents.get(sourceId);
    const target = documents.get(targetId);

    if (!source || !target) {
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    const dispose = reaction(
      () => source.title,
      (title) => {
        if (timer) {
          clearTimeout(timer);
        }

        timer = setTimeout(() => {
          timer = null;

          if (target.title !== title) {
            void target.save({ title });
          }
        }, 500);
      }
    );

    return () => {
      dispose();

      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [pairActive, sourceId, targetId, documents]);

  const sideOf = React.useCallback(
    (documentId: string): BilingualSide | undefined => {
      if (!pair) {
        return undefined;
      }

      if (documentId === pair.sourceDocumentId) {
        return "source";
      }

      if (documentId === pair.targetDocumentId) {
        return "target";
      }

      return undefined;
    },
    [pair]
  );

  const exit = React.useCallback(() => {
    history.replace(setBilingualFlag(history.location.search, false));
  }, []);

  const registerGrammarExtension = React.useCallback(
    (extension: GrammarCheckExtension | null) => {
      setGrammarExtension(extension);
    },
    []
  );

  const value = React.useMemo<BilingualPairContextValue>(
    () => ({
      requested,
      active: pairActive,
      pair: pairActive ? pair : null,
      engine: pairActive ? engine : null,
      sideOf,
      registerGrammarExtension,
      grammarExtension,
      exit,
    }),
    [
      requested,
      pairActive,
      pair,
      engine,
      sideOf,
      registerGrammarExtension,
      grammarExtension,
      exit,
    ]
  );

  return (
    <BilingualPairContext.Provider value={value}>
      {children}
    </BilingualPairContext.Provider>
  );
});

/**
 * Ensures a bilingual pair exists for a document and returns the paths for
 * the bilingual view. Shared by the document menu action and the bilingual
 * index so every entry point behaves identically.
 *
 * @param documentId The document to open bilingually.
 * @returns The source and mirror paths, or null when a pair is unavailable.
 */
/** Canonical paths for a pair, loading missing documents on demand. */
async function bilingualPaths(pair: {
  sourceDocumentId: string;
  targetDocumentId: string;
}): Promise<{ primaryPath: string; secondaryPath: string } | null> {
  const { documents } = stores;

  const load = async (id: string) => {
    const existing = documents.get(id);

    if (existing) {
      return existing;
    }

    try {
      return await documents.fetch(id);
    } catch (_err) {
      return undefined;
    }
  };

  const [source, target] = await Promise.all([
    load(pair.sourceDocumentId),
    load(pair.targetDocumentId),
  ]);

  if (!source || !target) {
    return null;
  }

  return {
    primaryPath: documentPath(source),
    secondaryPath: documentPath(target),
  };
}

/**
 * Resolves the canonical primary/secondary paths for a pair of document ids,
 * loading either document through the store when it is not in memory yet.
 *
 * @returns A resolver returning the paths, or null when a document cannot be
 * loaded.
 */
export function useBilingualPairPaths(): (
  sourceDocumentId: string,
  targetDocumentId: string
) => Promise<{ primaryPath: string; secondaryPath: string } | null> {
  return React.useCallback(
    (sourceDocumentId: string, targetDocumentId: string) =>
      bilingualPaths({ sourceDocumentId, targetDocumentId }),
    []
  );
}

export async function ensureBilingualPair(
  documentId: string
): Promise<{ primaryPath: string; secondaryPath: string } | null> {
  const cached = BilingualStore.peekInfo(documentId);

  if (cached?.pair) {
    return bilingualPaths(cached.pair);
  }

  try {
    const pair = await BilingualStore.createPair({ documentId });
    return bilingualPaths(pair);
  } catch (_err) {
    // Most likely the document is already part of a pair; resolve it below.
  }

  const info = await BilingualStore.fetchInfo(documentId, { force: true });

  if (!info.pair) {
    return null;
  }

  return bilingualPaths(info.pair);
}
