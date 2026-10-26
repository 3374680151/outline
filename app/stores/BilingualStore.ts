import { action, observable, runInAction } from "mobx";
import type { EditorView } from "prosemirror-view";
import type {
  BilingualBlockState,
  BilingualPairDTO,
} from "@shared/types/bilingual";
import Logger from "~/utils/Logger";
import { client } from "~/utils/ApiClient";

/** Pair information cached per document id (either side of the pair). */
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
}

/**
 * Client-side store for the bilingual editor module. Instantiated as a
 * module singleton rather than registered in the RootStore, so the editor
 * extensions can import it without touching core store wiring.
 */
class BilingualStore {
  /** Pair info keyed by document id (both sides). */
  @observable
  infoByDocument = observable.map<string, PairInfo>();

  /** Translated providers as reported by the server. */
  @observable
  providers: TranslationProviderInfo[] = [];

  /** Whether a pair creation request is in flight. */
  @observable
  isCreating = false;

  /** Registered editor views keyed by document id. */
  private views = new Map<string, EditorView>();

  /**
   * Fetches pair information for a document, either side of a pair.
   *
   * @param documentId The document to look up.
   * @returns The pair info; pair is null when the document is unpaired.
   */
  fetchInfo = async (documentId: string): Promise<PairInfo> => {
    const cached = this.infoByDocument.get(documentId);

    if (cached) {
      return cached;
    }

    const res = await client.post("/bilingual.info", { documentId });
    const info: PairInfo = {
      pair: res.data.pair,
      sourceDocumentId: res.data.source?.id,
      targetDocumentId: res.data.target?.id,
    };

    runInAction(() => {
      this.infoByDocument.set(documentId, info);
    });

    return info;
  };

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
        this.infoByDocument.set(pair.sourceDocumentId, {
          pair,
          sourceDocumentId: pair.sourceDocumentId,
          targetDocumentId: pair.targetDocumentId,
        });
        this.infoByDocument.set(pair.targetDocumentId, {
          pair,
          sourceDocumentId: pair.sourceDocumentId,
          targetDocumentId: pair.targetDocumentId,
        });
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
    })[]
  > => {
    const res = await client.post("/bilingual.list", {});
    return res.data.pairs;
  };

  /**
   * Persists the block state array for a pair. Failures are logged and
   * retried by the mirror engine on the next change.
   *
   * @param pairId The pair to update.
   * @param blockStates The full replacement block states.
   */
  updateState = action(async (pairId: string, blockStates: BilingualBlockState[]) => {
    try {
      const res = await client.post("/bilingual.updateState", {
        pairId,
        blockStates: blockStates.map((state) => ({
          status: state.status,
          sourceHash: state.sourceHash,
          autoText: state.autoText,
          ...(state.error ? { error: state.error } : {}),
        })),
      });
      const pair = res.data.pair as BilingualPairDTO;
      runInAction(() => {
        this.infoByDocument.set(pair.sourceDocumentId, {
          pair,
          sourceDocumentId: pair.sourceDocumentId,
          targetDocumentId: pair.targetDocumentId,
        });
      });
    } catch (err) {
      // Persisting block state is best effort: the mirror keeps working from
      // memory and retries on the next change.
      Logger.warn("bilingual.updateState failed", { err });
    }
  });

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
}

export default new BilingualStore();
