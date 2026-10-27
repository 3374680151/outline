import { action, makeObservable, observable, runInAction } from "mobx";
import type { EditorView } from "prosemirror-view";
import type {
  BilingualBlockState,
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

/** One block of a batch grammar check request. */
export type GrammarCheckItem = {
  /** Client provided identifier echoed back with the result. */
  id: string;
  /** The plain text to check. */
  text: string;
};

/** One entry of a batch grammar check response. */
export type GrammarCheckResult = {
  /** The client provided id of the item. */
  id: string;
  /** Whether the grammar service processed the item. */
  available: boolean;
  /** Why the item was not processed. */
  reason?: string;
  /** The raw grammar matches for the text. */
  matches?: unknown[];
};

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
  listPairs = async (): Promise<
    (BilingualPairDTO & {
      sourceTitle: string;
      targetTitle: string;
      sourceCollectionId: string | null;
      targetDocumentId: string;
    })[]
  > => {
    const res = await client.post("/bilingual.list", {});
    return res.data.pairs;
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
   * Runs a grammar check via the server proxy.
   *
   * @param params The check parameters.
   * @returns The check result payload.
   */
  grammarCheck = async (params: {
    text: string;
    language: string;
    level: string;
    mode?: string;
    disabledRules?: string;
  }): Promise<{
    available: boolean;
    reason?: string;
    matches?: unknown[];
  }> => {
    const res = await client.post("/grammar.check", params);
    return res.data;
  };

  /**
   * Runs a batched grammar check: many blocks in one HTTP round trip.
   *
   * @param params The shared check parameters and the blocks to check.
   * @returns One result per item, in input order.
   */
  grammarCheckBatch = async (params: {
    items: GrammarCheckItem[];
    language: string;
    level: string;
    mode?: string;
    disabledRules?: string;
  }): Promise<GrammarCheckResult[]> => {
    const res = await client.post("/grammar.checkBatch", params);
    return res.data.results as GrammarCheckResult[];
  };

  /**
   * Registers an editor view for a document so cross-pane actions (such as
   * writing a translation into the mirror document) can reach it.
   *
   * @param documentId The document the view renders.
   * @param view The ProseMirror view.
   */
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
      const data = res.data as { available?: boolean; entry?: WordLookupDTO };
      return data?.available ? data.entry ?? null : null;
    } catch (err) {
      Logger.warn("translations.word lookup failed", { err });
      return null;
    }
  };
}

export default new BilingualStore();
