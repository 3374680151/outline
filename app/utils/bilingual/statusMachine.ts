import type { BilingualBlockState, BilingualBlockStatus } from "@shared/types/bilingual";

/**
 * Pure state machine for the translation status of a single block of a
 * bilingual pair. The machine is intentionally side-effect free so that the
 * mirror engine can apply it and persist the result.
 */

/** Events that drive block state transitions. */
export type BlockEvent =
  | {
      /** The source block text changed. */
      type: "sourceTextChanged";
      /** Whether the mirror block currently equals the last auto-written text. */
      targetMatchesAuto: boolean;
      /** Hash of the new source text. */
      sourceHash: string;
    }
  | {
      /** A translation request for this block was dispatched. */
      type: "translationStarted";
      /** Hash of the source text being translated. */
      sourceHash: string;
    }
  | {
      /** A translation succeeded and was written into the mirror block. */
      type: "translationSucceeded";
      /** Hash of the source text that was translated. */
      sourceHash: string;
      /** The text written into the mirror block. */
      autoText: string;
    }
  | {
      /** A translation attempt failed. */
      type: "translationFailed";
      /** Reason for the failure, for display. */
      message?: string;
    }
  | {
      /** The user edited the mirror block by hand. */
      type: "targetManuallyEdited";
    }
  | {
      /** The user confirmed re-translating over human content. */
      type: "retranslateConfirmed";
      /** Hash of the source text about to be translated. */
      sourceHash: string;
    }
  | {
      /** The block became untranslatable (e.g. turned into a code block). */
      type: "markedSkipped";
    };

/**
 * Computes the next block state for an event.
 *
 * @param state The current persisted block state.
 * @param humanEdited Whether the mirror block has human edits (client-only knowledge).
 * @param event The event to apply.
 * @returns The next state, or the same object when nothing changes.
 */
export function reduceBlockState(
  state: BilingualBlockState,
  humanEdited: boolean,
  event: BlockEvent
): BilingualBlockState & { humanEdited: boolean } {
  const withHuman = (status: BilingualBlockStatus): BilingualBlockState & { humanEdited: boolean } => ({
    ...state,
    status,
    humanEdited,
  });

  switch (event.type) {
    case "sourceTextChanged": {
      if (state.status === "skipped") {
        return withHuman("skipped");
      }

      if (state.status === "pending") {
        return withHuman("pending");
      }

      // The mirror content is no longer in sync with the source: either it
      // was written by a human, or it drifted from the last auto text.
      if (humanEdited || !event.targetMatchesAuto) {
        return withHuman("stale");
      }

      // Safe to re-translate automatically; the mirror engine will dispatch
      // a translation and the block will go through "pending".
      return withHuman("empty");
    }

    case "translationStarted": {
      return {
        ...state,
        status: "pending",
        sourceHash: event.sourceHash,
        humanEdited: false,
      };
    }

    case "translationSucceeded": {
      return {
        ...state,
        status: "auto",
        sourceHash: event.sourceHash,
        autoText: event.autoText,
        error: undefined,
        humanEdited: false,
      };
    }

    case "translationFailed": {
      return {
        ...state,
        status: "failed",
        error: event.message,
        humanEdited,
      };
    }

    case "targetManuallyEdited": {
      return withHuman("manual");
    }

    case "retranslateConfirmed": {
      return {
        ...state,
        status: "pending",
        sourceHash: event.sourceHash,
        humanEdited: false,
      };
    }

    case "markedSkipped": {
      return withHuman("skipped");
    }

    default: {
      return withHuman(state.status);
    }
  }
}

/**
 * Determines whether an automatic translation may overwrite the current
 * mirror block content. This is the core guard against clobbering human
 * edits: only content that exactly equals the last machine-written text (or
 * an empty block) may be replaced.
 *
 * @param state The current persisted block state.
 * @param currentTargetText The mirror block's current text.
 * @returns True when the block may be overwritten automatically.
 */
export function canAutoWrite(
  state: BilingualBlockState,
  currentTargetText: string
): boolean {
  if (state.status === "manual" || state.status === "skipped") {
    return false;
  }

  if (currentTargetText.length === 0) {
    return true;
  }

  return currentTargetText === state.autoText;
}
