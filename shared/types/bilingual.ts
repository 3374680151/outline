/**
 * Types shared between the server and the client for the bilingual editor
 * module: document pairs with a source (English) document and a target
 * (Chinese) mirror document.
 */

/** Translation state of a single top-level block in the mirror document. */
export type BilingualBlockStatus =
  | "empty"
  | "pending"
  | "auto"
  | "manual"
  | "stale"
  | "failed"
  | "skipped";

/**
 * Persisted state for one block of a bilingual pair. The array is index
 * parallel with the top-level blocks of the source document.
 */
export interface BilingualBlockState {
  /** Current translation state of the block. */
  status: BilingualBlockStatus;
  /** Hash of the source text at the time of the last translation attempt. */
  sourceHash: string;
  /** The last text automatically written into the mirror document. */
  autoText: string;
  /** Failure reason when status is "failed". */
  error?: string;
}

/** Serialized bilingual pair as returned by the API. */
export interface BilingualPairDTO {
  /** Unique identifier of the pair. */
  id: string;
  /** Document id of the structure-authoritative source document. */
  sourceDocumentId: string;
  /** Document id of the mirror target document. */
  targetDocumentId: string;
  /** ISO language code of the source document, e.g. "en". */
  sourceLanguage: string;
  /** ISO language code of the mirror document, e.g. "zh". */
  targetLanguage: string;
  /** Index-parallel translation state for each source block. */
  blockStates: BilingualBlockState[];
  /** ISO timestamp of creation. */
  createdAt: string;
  /** ISO timestamp of last update. */
  updatedAt: string;
}

/** One row of the bilingual documents index. */
export interface BilingualListRow extends BilingualPairDTO {
  /** Title of the source document. */
  sourceTitle: string;
  /** Title of the mirror document. */
  targetTitle: string;
  /** Collection the source document lives in, when any. */
  sourceCollectionId: string | null;
  /** Icon of the source document. */
  sourceIcon?: string | null;
  /** Color of the source document. */
  sourceColor?: string | null;
}

/** Payload for `bilingual.updateState`. */
export interface BilingualUpdateStatePayload {
  /** The pair to update. */
  pairId: string;
  /** The full replacement block state array. */
  blockStates: BilingualBlockState[];
}

/** AI dictionary entry for a word lookup (FluentRead-compatible protocol). */
export interface WordLookupDTO {
  /** Where the entry came from, surfaced as a trust label in the UI. */
  source?: "ecdict" | "ai";
  /** The looked-up word. */
  word: string;
  /** International phonetic alphabet, empty when unavailable. */
  phonetic?: string;
  /** Parts of speech with meanings (at most 4). */
  senses: { pos: string; meaning: string }[];
  /** Example sentences with translations (at most 2). */
  examples: { src: string; dst: string }[];
}
