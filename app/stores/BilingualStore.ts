import { action, makeObservable, observable, runInAction } from "mobx";
import type { EditorView } from "prosemirror-view";
import type {
  BilingualBlockState,
  BilingualListRow,
  BilingualPairDTO,
  WordLookupDTO,
} from "@shared/types/bilingual";
import Logger from "~/utils/Logger";
import stores from "~/stores";
import { client } from "~/utils/ApiClient";

/** Pair information cached for a bilingual pair. */
interface PairInfo {
  pair: BilingualPairDTO | null;
  sourceDocumentId?: string;
  targetDocumentId?: string;
}

/** Descriptor of a translation provider as returned by the API. */
export interface TranslationProviderInfo {
  id: string;
  label: string;
  configured: boolean;
  isDefault?: boolean;
}

/** A policy payload attached to an API response. */
type ResponsePolicy = { id: string; abilities: Record<string, boolean> };

/**
 * Client-side store for the bilingual editor module. Instantiated as a
 * module singleton rather than registered in the RootStore, so the editor
 * extensions can import it without touching core store wiring.
 */
class BilingualStore {
  /** Pair info keyed by document id (both sides of every pair). */
  @observable
  infoByDocument = observable.map<string, PairInfo>();

  /** Translated providers as reported by the server. */
  @observable
  providers: TranslationProviderInfo[] = [];

  /** Whether a pair creation request is in flight. */
  @observable
  isCreating = false;

  constructor() {
    makeObservable(this);
  }

  /** Registered editor views keyed by document id (observable for adoption). */
  @observable
  views = observable.map<string, EditorView>();

  /**
   * Document ids known to belong to a bilingual pair, so the UI can badge
   * them everywhere documents are listed without extra lookups.
   */
  @observable
  bilingualDocIds = observable.set<string>();

  /**
   * Returns cached pair information without a network request.
   *
   * @param documentId The document to look up.
   * @returns The cached info, or undefined.
   */
  peekInfo = (documentId: string): PairInfo | undefined =>
    this.infoByDocument.get(documentId);

  /**
   * Fetches pair information for a document, either side of a pair. The
   * response already contains both presented documents and their policies,
   * so they are merged into the local stores instead of being re-fetched.
   *
   * @param documentId The document to look up.
   * @param options Force a network refresh past the cache.
   * @returns The pair info; pair is null when the document is unpaired.
   */
  fetchInfo = async (
    documentId: string,
    options?: { force?: boolean }
  ): Promise<PairInfo> => {
    const cached = this.infoByDocument.get(documentId);

    if (cached && !options?.force) {
      return cached;
    }

    const res = await client.post("/bilingual.info", { documentId });
    const info: PairInfo = {
      pair: res.data.pair,
      sourceDocumentId: res.data.source?.id,
      targetDocumentId: res.data.target?.id,
    };

    runInAction(() => {
      if (res.data.source) {
        stores.documents.add(res.data.source);
      }

      if (res.data.target) {
        stores.documents.add(res.data.target);
      }

      if (Array.isArray(res.policies)) {
        (res.policies as ResponsePolicy[]).forEach((policy) =>
          stores.policies.add(policy)
        );
      }

      if (info.pair) {
        this.cachePair(info.pair);
      } else {
        this.infoByDocument.set(documentId, info);
      }
    });

    return info;
  };

  /**
   * Indexes a pair under both of its document ids.
   *
   * @param pair The pair to cache.
   */
  private cachePair(pair: BilingualPairDTO): void {
    const info: PairInfo = {
      pair,
      sourceDocumentId: pair.sourceDocumentId,
      targetDocumentId: pair.targetDocumentId,
    };
    this.infoByDocument.set(pair.sourceDocumentId, info);
    this.infoByDocument.set(pair.targetDocumentId, info);
    this.bilingualDocIds.add(pair.sourceDocumentId);
    this.bilingualDocIds.add(pair.targetDocumentId);
  }

  /**
   * Creates a bilingual pair for a document or from a fresh title.
   *
   * @param params Either documentId, or title plus optional location.
   * @returns The created pair.
   */
  createPair = async (params: {
    documentId?: string;
    title?: string;
    collectionId?: string;
    parentDocumentId?: string;
    publish?: boolean;
  }): Promise<BilingualPairDTO> => {
    this.isCreating = true;

    try {
      const res = await client.post("/bilingual.create", params);
      const pair = res.data.pair as BilingualPairDTO;
      runInAction(() => {
        stores.documents.add(res.data.source);
        stores.documents.add(res.data.target);

        if (Array.isArray(res.policies)) {
          (res.policies as ResponsePolicy[]).forEach((policy) =>
            stores.policies.add(policy)
          );
        }

        this.cachePair(pair);
      });
      return pair;
    } finally {
      runInAction(() => {
        this.isCreating = false;
      });
    }
  };

  /**
   * Lists the bilingual pairs of the current team.
   *
   * @returns The pairs with source and target titles.
   */
  listPairs = async (): Promise<BilingualListRow[]> => {
    const res = await client.post("/bilingual.list", {});
    const pairs = res.data.pairs as BilingualListRow[];
    runInAction(() => {
      for (const pair of pairs) {
        this.bilingualDocIds.add(pair.sourceDocumentId);
        this.bilingualDocIds.add(pair.targetDocumentId);
      }
    });
    return pairs;
  };

  /**
   * Persists block state changes for a pair. Sends only the dirty entries
   * when possible, falling back to a full replacement for wide edits.
   * Failures are logged and retried by the mirror engine on the next change.
   *
   * @param pairId The pair to update.
   * @param blockStates The current full block state array.
   * @param dirtyIndexes The indexes that changed since the last persist.
   */
  updateState = action(
    async (
      pairId: string,
      blockStates: BilingualBlockState[],
      dirtyIndexes?: Set<number>
    ) => {
      try {
        const serialize = (state: BilingualBlockState) => ({
          status: state.status,
          sourceHash: state.sourceHash,
          autoText: state.autoText,
          ...(state.error ? { error: state.error } : {}),
        });

        const useChanges =
          dirtyIndexes !== undefined &&
          dirtyIndexes.size > 0 &&
          dirtyIndexes.size <= Math.ceil(blockStates.length / 2);

        const body = useChanges
          ? {
              pairId,
              changes: [...dirtyIndexes]
                .filter((index) => index < blockStates.length)
                .map((index) => ({ index, ...serialize(blockStates[index]) })),
            }
          : {
              pairId,
              blockStates: blockStates.map(serialize),
            };

        const res = await client.post("/bilingual.updateState", body);
        const pair = res.data.pair as BilingualPairDTO;
        runInAction(() => {
          this.cachePair(pair);
        });
      } catch (err) {
        // Persisting block state is best effort: the mirror keeps working
        // from memory and retries on the next change.
        Logger.warn("bilingual.updateState failed", { err });
      }
    }
  );

  /**
   * Asks the server to realign the block state array of a pair.
   *
   * @param pairId The pair to realign.
   * @returns The updated pair.
   */
  realign = async (pairId: string): Promise<BilingualPairDTO> => {
    const res = await client.post("/bilingual.realign", { pairId });
    return res.data.pair as BilingualPairDTO;
  };

  /**
   * Saves a pair as one merged bilingual document.
   *
   * @param params The pair plus placement options.
   * @returns The created document id and title.
   */
  saveMerged = async (params: {
    pairId: string;
    title?: string;
    collectionId?: string | null;
    publish?: boolean;
  }): Promise<{ id: string; title: string }> => {
    const res = await client.post("/bilingual.saveMerged", params);
    const document = res.data.document;
    runInAction(() => {
      stores.documents.add(document);

      if (Array.isArray(res.policies)) {
        (res.policies as ResponsePolicy[]).forEach((policy) =>
          stores.policies.add(policy)
        );
      }
    });
    return { id: document.id, title: document.title };
  };

  /**
   * Translates a batch of texts via the server proxy.
   *
   * @param texts The texts to translate.
   * @param to The target language, defaults to zh.
   * @param provider Optional provider id; omitted uses the fallback chain.
   * @returns The translated texts, index parallel to the input.
   */
  translate = async (
    texts: string[],
    to = "zh",
    provider?: string
  ): Promise<string[]> => {
    const res = await client.post("/translations.translate", {
      texts,
      to,
      ...(provider ? { provider } : {}),
    });
    return res.data.results as string[];
  };

  /**
   * Fetches the configured translation providers once per session.
   *
   * @returns The provider descriptors.
   */
  fetchProviders = async (): Promise<TranslationProviderInfo[]> => {
    if (this.providers.length > 0) {
      return this.providers;
    }

    const res = await client.post("/translations.providers", {});
    runInAction(() => {
      this.providers = res.data.providers;
    });
    return this.providers;
  };

  /**
   * Incremented whenever the toolbar asks for the current selection to be
   * translated; the hover-translate extensions react to this counter.
   */
  @observable
  translateSelectionRequest = 0;

  /** Whether an extension opened a card for the current request. */
  private translateSelectionHandled = false;

  /**
   * Requests that the hover-translate extension opens its card for the
   * editor selection. Extensions answer synchronously through
   * markTranslateSelectionHandled before the counter change is delivered,
   * so the return value tells the caller whether anything was translated.
   *
   * @returns True when an extension opened a card for this request.
   */
  requestTranslateSelection = action(() => {
    this.translateSelectionHandled = false;
    this.translateSelectionRequest += 1;
    return this.translateSelectionHandled;
  });

  /**
   * Marks the current translate-selection request as handled, meaning the
   * translation card was opened for it.
   */
  markTranslateSelectionHandled = action(() => {
    this.translateSelectionHandled = true;
  });

  registerEditor = action((documentId: string, view: EditorView) => {
    this.views.set(documentId, view);
  });

  /**
   * Removes a registered editor view.
   *
   * @param documentId The document whose view should be removed.
   */
  unregisterEditor = action((documentId: string) => {
    this.views.delete(documentId);
  });

  /**
   * Returns the registered view for a document.
   *
   * @param documentId The document id.
   * @returns The view, or undefined.
   */
  getView = (documentId: string): EditorView | undefined =>
    this.views.get(documentId);

  /**
   * Looks a word up in the AI dictionary (requires an AI translation
   * provider to be configured server-side).
   *
   * @param word The word or short phrase.
   * @param context Optional sentence containing the word.
   * @returns The dictionary entry, or null when unavailable.
   */
  lookupWord = async (
    word: string,
    context?: string
  ): Promise<WordLookupDTO | null> => {
    try {
      const res = await client.post("/translations.word", {
        word,
        ...(context ? { context } : {}),
      });
      const data = res.data as {
        available?: boolean;
        source?: "ecdict" | "ai";
        entry?: WordLookupDTO;
      };

      if (!data?.available || !data.entry) {
        return null;
      }

      // Surface the lookup tier alongside the entry so the card can label
      // its trust level (local dictionary vs AI generated).
      return { ...data.entry, source: data.source };
    } catch (err) {
      Logger.warn("translations.word lookup failed", { err });
      return null;
    }
  };
}

export default new BilingualStore();
