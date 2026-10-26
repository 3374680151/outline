import { observable, runInAction } from "mobx";
import type { EditorView } from "prosemirror-view";
import type { BilingualBlockState } from "@shared/types/bilingual";
import BilingualStore from "~/stores/BilingualStore";
import Logger from "~/utils/Logger";
import { textHash } from "./hash";
import { canAutoWrite, reduceBlockState } from "./statusMachine";
import { applyBlockOps, diffTopLevelBlocks } from "./blockDiff";
import type { BlockSignature } from "./blockDiff";
import {
  blockText,
  isTextReplaceable,
  MIRROR_WRITE_META,
  replaceBlockText,
  selectionIntersectsBlock,
  viewBlockSignatures,
  viewBlockTextHashes,
} from "./editorBlocks";

/** Debounce for structural mirror operations, in milliseconds. */
const STRUCTURE_DEBOUNCE_MS = 250;

/** Debounce for translation requests after typing, in milliseconds. */
const TRANSLATE_DEBOUNCE_MS = 1500;

/** Debounce for persisting block state to the server, in milliseconds. */
const PERSIST_DEBOUNCE_MS = 3000;

/** Delay before a mirror write that hit a focused block is retried. */
const WRITE_RETRY_MS = 3000;

/** Maximum blocks translated in one batch. */
const MAX_TRANSLATE_BATCH = 20;

/** Block types whose content the engine can fill with translated text. */
const MIRRORABLE_TYPES = new Set(["paragraph", "heading"]);

const emptyState = (): BilingualBlockState => ({
  status: "empty",
  sourceHash: "",
  autoText: "",
});

/**
 * Reduces a signature sequence to the subset the engine can mirror, so
 * consistency checks ignore block types that are kept on both sides but
 * never auto-filled (lists, code fences, tables, …).
 *
 * @param signatures The raw top-level block signatures.
 * @returns The normalized comparison key sequence.
 */
function mirrorableKey(signatures: BlockSignature[]): string {
  return JSON.stringify(
    signatures
      .filter((signature) => MIRRORABLE_TYPES.has(signature.type))
      .map((signature) =>
        signature.level === undefined
          ? signature.type
          : `${signature.type}:${signature.level}`
      )
  );
}

/**
 * Remaps an index set after structural operations, following the same
 * sequential remove/insert semantics as the operations themselves.
 *
 * @param set The set of old block indexes.
 * @param ops The structural operations applied.
 * @param oldSize The number of blocks before the operations.
 * @returns The remapped set of indexes.
 */
function remapIndexSet(
  set: Set<number>,
  ops: ReturnType<typeof diffTopLevelBlocks>,
  oldSize: number
): Set<number> {
  const mapping: number[] = Array.from({ length: oldSize }, (_, i) => i);

  for (const op of ops) {
    if (op.op === "remove") {
      mapping.splice(op.index, 1);
    } else {
      mapping.splice(op.index, 0, -1);
    }
  }

  const remapped = new Set<number>();

  mapping.forEach((oldIndex, newIndex) => {
    if (oldIndex >= 0 && set.has(oldIndex)) {
      remapped.add(newIndex);
    }
  });

  return remapped;
}

/**
 * The bilingual mirror engine: keeps a target (Chinese) document structurally
 * in sync with a source (English) document and fills translated content per
 * block, never overwriting human edits.
 *
 * The engine observes local source transactions via the BilingualMirror
 * extension, diffs top-level blocks, mirrors structural operations into the
 * target editor, and runs the debounced translation pipeline.
 */
export class MirrorEngine {
  /** Translation states, index parallel with source top-level blocks. */
  blockStates: BilingualBlockState[] = [];

  /** Whether source and target structures disagree (shows a repair banner). */
  @observable
  hasMismatch = false;

  /** Set of block indexes whose mirror content was written by a human. */
  private humanEdited = new Set<number>();

  /** Set of block indexes queued for a forced (guard-bypassing) rewrite. */
  private forced = new Set<number>();

  /** Translations that succeeded but could not be written to the target yet. */
  private pendingWrites = new Map<
    number,
    { text: string; expected: string; forced: boolean; attempts: number }
  >();

  private sourceView: EditorView | null = null;
  private targetView: EditorView | null = null;
  private lastSignatures: BlockSignature[] = [];
  private lastTextHashes: string[] = [];
  private structureTimer: ReturnType<typeof setTimeout> | null = null;
  private translateTimer: ReturnType<typeof setTimeout> | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private consistencyTimer: ReturnType<typeof setTimeout> | null = null;
  private retryWriteTimer: ReturnType<typeof setTimeout> | null = null;
  private syncProbeTimer: ReturnType<typeof setTimeout> | null = null;
  private translateQueue = new Set<number>();
  private pairId: string | null = null;
  private destroyed = false;

  /**
   * Attaches the pair this engine mirrors.
   *
   * @param pairId The bilingual pair id.
   * @param blockStates Initial block states from the server.
   */
  setup(pairId: string, blockStates: BilingualBlockState[]) {
    this.pairId = pairId;
    this.destroyed = false;
    this.blockStates = blockStates.map((state) => state ?? emptyState());
  }

  /**
   * Registers the source (English) editor view.
   *
   * @param view The ProseMirror view of the source document.
   */
  registerSource(view: EditorView) {
    // A view re-registering (editor remount) re-arms the engine: the destroy
    // of a previous editor generation must not permanently kill it.
    this.destroyed = false;
    this.sourceView = view;
    this.lastSignatures = viewBlockSignatures(view);
    this.lastTextHashes = viewBlockTextHashes(view, textHash);
    this.alignBlockStatesLength();
    // Queue pre-existing content for its first translation (enabling
    // bilingual mode on a document that already has text).
    this.queueUntranslatedBlocks();
    this.scheduleConsistencyCheck();
    this.startSyncProbe();
  }

  /**
   * Registers the target (Chinese) editor view.
   *
   * @param view The ProseMirror view of the target document.
   */
  registerTarget(view: EditorView) {
    this.destroyed = false;
    this.targetView = view;
    this.alignBlockStatesLength();
    // The source content may have arrived (through Yjs sync) before the
    // slower target document registered – align and translate now.
    this.ensureTargetStructure();
    this.queueUntranslatedBlocks();
    this.scheduleConsistencyCheck();
  }

  /**
   * Tears down timers. Registered views are owned by the editors.
   */
  destroy() {
    this.destroyed = true;

    if (this.structureTimer) {
      clearTimeout(this.structureTimer);
      this.structureTimer = null;
    }

    if (this.translateTimer) {
      clearTimeout(this.translateTimer);
      this.translateTimer = null;
    }

    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }

    if (this.consistencyTimer) {
      clearTimeout(this.consistencyTimer);
      this.consistencyTimer = null;
    }

    if (this.retryWriteTimer) {
      clearTimeout(this.retryWriteTimer);
      this.retryWriteTimer = null;
    }

    if (this.syncProbeTimer) {
      clearTimeout(this.syncProbeTimer);
      this.syncProbeTimer = null;
    }
  }

  /**
   * Handles local transactions on the source document: schedules the
   * structural mirror and the translation pipeline.
   */
  handleLocalTransactions = () => {
    if (this.destroyed || !this.sourceView) {
      return;
    }

    if (this.structureTimer) {
      clearTimeout(this.structureTimer);
    }

    this.structureTimer = setTimeout(() => {
      this.structureTimer = null;
      this.mirrorStructure();
      this.detectTextChanges();
    }, STRUCTURE_DEBOUNCE_MS);
  };

  /**
   * Handles remote (other users) transactions: re-reads signatures so the
   * engine stays in sync without mirroring (the originating client mirrors
   * its own operations), and queues content that arrived before this engine
   * could translate it – most importantly the initial document content,
   * which reaches the editor as remote transactions during Yjs sync.
   */
  handleRemoteTransactions = () => {
    if (this.destroyed || !this.sourceView) {
      return;
    }

    this.lastSignatures = viewBlockSignatures(this.sourceView);
    this.lastTextHashes = viewBlockTextHashes(this.sourceView, textHash);
    this.alignBlockStatesLength();
    this.ensureTargetStructure();
    this.queueUntranslatedBlocks();
  };

  /**
   * Polls briefly for content that reaches the editor through Yjs sync
   * without observable transactions (initial restore), which would otherwise
   * never run through the remote transaction path.
   */
  private startSyncProbe() {
    if (this.syncProbeTimer) {
      clearTimeout(this.syncProbeTimer);
    }

    let probes = 0;
    const probe = () => {
      if (this.destroyed || !this.sourceView) {
        return;
      }

      const signatures = JSON.stringify(viewBlockSignatures(this.sourceView));

      if (signatures !== JSON.stringify(this.lastSignatures)) {
        this.handleRemoteTransactions();
      }
      // Also cover the case where the source content was already present but
      // the target document (which loads independently) has not caught up.
      else if (this.targetView) {
        this.ensureTargetStructure();
        this.queueUntranslatedBlocks();
      }

      probes++;

      if (probes < 15) {
        this.syncProbeTimer = setTimeout(probe, 1000);
      } else {
        this.syncProbeTimer = null;
      }
    };

    this.syncProbeTimer = setTimeout(probe, 1000);
  }

  /**
   * Diffs the current source structure against the last known one and
   * mirrors insert/remove operations into the target document.
   */
  private mirrorStructure() {
    const sourceView = this.sourceView;
    const targetView = this.targetView;

    if (!sourceView || !targetView) {
      return;
    }

    const signatures = viewBlockSignatures(sourceView);
    const ops = diffTopLevelBlocks(this.lastSignatures, signatures);

    this.lastSignatures = signatures;

    if (ops.length === 0) {
      return;
    }

    for (const op of ops) {
      this.applyStructureOp(targetView, op);
    }

    const oldSize = this.blockStates.length;
    this.blockStates = applyBlockOps(this.blockStates, ops, (insert) =>
      MIRRORABLE_TYPES.has(insert.signature.type)
        ? emptyState()
        : { ...emptyState(), status: "skipped" }
    );
    this.humanEdited = remapIndexSet(this.humanEdited, ops, oldSize);
    this.forced = remapIndexSet(this.forced, ops, oldSize);
    // Text hash refresh is intentionally left to detectTextChanges, which
    // runs right after and queues the newly inserted or shifted blocks.
    this.schedulePersist();
    this.checkConsistency();
  }

  /**
   * Applies one structural operation to the target view. Positions are
   * recomputed from the live document for every operation so sequential ops
   * stay correct. Block types the engine cannot fill (lists, tables, …) are
   * mirrored as empty nodes of their own type when possible, falling back to
   * an empty paragraph, so top-level indexes stay parallel.
   *
   * @param view The target editor view.
   * @param op The operation to apply.
   */
  private applyStructureOp(
    view: EditorView,
    op: ReturnType<typeof diffTopLevelBlocks>[number]
  ) {
    const doc = view.state.doc;

    if (op.op === "remove") {
      if (op.index >= doc.childCount) {
        return;
      }

      let from = 0;

      for (let i = 0; i < op.index; i++) {
        from += doc.child(i).nodeSize;
      }

      const removeTr = view.state.tr.delete(
        from,
        from + doc.child(op.index).nodeSize
      );
      removeTr.setMeta(MIRROR_WRITE_META, true);
      view.dispatch(removeTr);
      return;
    }

    const schema = view.state.schema;
    const nodeType =
      op.signature.type === "heading"
        ? schema.nodes.heading
        : schema.nodes[op.signature.type] ?? schema.nodes.paragraph;

    if (!nodeType) {
      return;
    }

    let node;

    try {
      node = nodeType.createChecked(
        op.signature.type === "heading"
          ? { level: op.signature.level ?? 1 }
          : null,
        []
      );
    } catch (_err) {
      // Types with required content (e.g. lists) cannot be created empty;
      // fall back to a paragraph to keep the top-level indexes parallel.
      node = schema.nodes.paragraph.createChecked(null, []);
    }

    const position =
      op.index >= doc.childCount
        ? doc.content.size
        : (() => {
            let pos = 0;

            for (let i = 0; i < op.index; i++) {
              pos += doc.child(i).nodeSize;
            }

            return pos;
          })();

    const insertTr = view.state.tr.insert(position, node);
    insertTr.setMeta(MIRROR_WRITE_META, true);
    view.dispatch(insertTr);
  }

  /**
   * Detects per-block text changes and queues translation for blocks whose
   * source text changed since their last translation.
   */
  private detectTextChanges() {
    const sourceView = this.sourceView;
    const targetView = this.targetView;

    if (!sourceView) {
      return;
    }

    const hashes = viewBlockTextHashes(sourceView, textHash);
    let queued = false;

    for (let i = 0; i < hashes.length; i++) {
      const state = this.blockStates[i] ?? emptyState();

      // Unchanged since the last translation (covers blocks that only
      // shifted position after a structural edit).
      if (hashes[i] === this.lastTextHashes[i] || hashes[i] === state.sourceHash) {
        continue;
      }

      const node = sourceView.state.doc.child(i);
      const translatable =
        isTextReplaceable(node) && node.textContent.trim().length > 0;

      const targetText = targetView ? blockText(targetView, i) : "";
      const nextState = reduceBlockState(state, this.humanEdited.has(i), {
        type: "sourceTextChanged",
        targetMatchesAuto: targetText === state.autoText,
        sourceHash: hashes[i],
      });

      this.blockStates[i] = nextState;

      if (nextState.status === "empty" && translatable) {
        this.translateQueue.add(i);
        queued = true;
      }
    }

    this.lastTextHashes = hashes;
    this.alignBlockStatesLength();

    if (queued) {
      this.scheduleTranslate();
    }
  }

  /**
   * Runs the pending translation queue: batches queued blocks into one
   * request, verifies staleness on response, and writes results into the
   * target document unless a human has touched the block.
   */
  private runTranslate = async () => {
    const sourceView = this.sourceView;
    const targetView = this.targetView;

    if (this.destroyed || !sourceView || !targetView) {
      return;
    }

    // Consume the whole queue first so untranslatable entries cannot keep
    // the queue alive forever; the beyond-batch tail goes back in.
    const allQueued = [...this.translateQueue];
    this.translateQueue.clear();

    const replaceable = allQueued.filter((index) => {
      const node = sourceView.state.doc.child(index);
      return (
        node && isTextReplaceable(node) && node.textContent.trim().length > 0
      );
    });
    const indexes = replaceable.slice(0, MAX_TRANSLATE_BATCH);
    replaceable.slice(MAX_TRANSLATE_BATCH).forEach((index) => {
      this.translateQueue.add(index);
    });

    if (indexes.length > 0) {
      const batch = indexes.map((index) => ({
        index,
        hash: textHash(blockText(sourceView, index)),
        text: blockText(sourceView, index),
        // The mirror text this write is allowed to replace: the previous
        // auto text (or anything when the write is forced).
        expected: this.blockStates[index]?.autoText ?? "",
        forced: this.forced.has(index),
      }));
      batch.forEach((item) => this.forced.delete(item.index));
      const translatable = batch.filter((item) => item.text.trim().length > 0);

      this.blockStates = this.blockStates.map((state, i) => {
        const item = batch.find((entry) => entry.index === i);

        return item && translatable.includes(item)
          ? reduceBlockState(state, false, {
              type: "translationStarted",
              sourceHash: item.hash,
            })
          : state;
      });
      this.schedulePersist();

      if (translatable.length > 0) {
        let results: string[];

        try {
          results = await BilingualStore.translate(
            translatable.map((item) => item.text)
          );
        } catch (err) {
          Logger.warn("bilingual translate failed", { err });
          this.blockStates = this.blockStates.map((state, i) =>
            translatable.some((item) => item.index === i)
              ? reduceBlockState(state, this.humanEdited.has(i), {
                  type: "translationFailed",
                  message: "translation failed",
                })
              : state
          );
          this.schedulePersist();
          return;
        }

        for (let i = 0; i < translatable.length; i++) {
          const item = translatable[i];
          const translated = results[i] ?? "";

          // Stale guard: the source text changed between request and
          // response, so re-queue instead of writing a mismatched text.
          if (textHash(blockText(sourceView, item.index)) !== item.hash) {
            this.translateQueue.add(item.index);
            continue;
          }

          const state = this.blockStates[item.index] ?? emptyState();
          this.blockStates[item.index] = reduceBlockState(state, false, {
            type: "translationSucceeded",
            sourceHash: item.hash,
            autoText: translated,
          });
          this.humanEdited.delete(item.index);
          const written = this.writeTarget(
            item.index,
            translated,
            item.expected,
            item.forced
          );

          if (!written) {
            // The mirror block does not exist (or is not writable) yet –
            // park the translation and retry once the structure catches up.
            this.pendingWrites.set(item.index, {
              text: translated,
              expected: item.expected,
              forced: item.forced,
              attempts: 0,
            });
            this.scheduleRetryWrite();
          }
        }

        this.schedulePersist();
      }
    }

    // The queue may hold more blocks than one batch allows.
    if (this.translateQueue.size > 0) {
      this.scheduleTranslate();
    }
  };

  /**
   * Writes translated text into the target block. The write is only allowed
   * to replace content that matches `expected` – the text the engine itself
   * wrote last time – or empty content, so human edits are never clobbered.
   *
   * @param index The target block index.
   * @param text The translated text.
   * @param expected The mirror text the write expects to find.
   * @param forced Whether to bypass the human edit guard.
   * @returns True when the write was handled (done, or refused as human
   * content); false when it should be retried later.
   */
  private writeTarget(
    index: number,
    text: string,
    expected: string,
    forced: boolean
  ): boolean {
    const targetView = this.targetView;

    if (!targetView) {
      return false;
    }

    // Only back off when the user is actually focused inside the target
    // block: ProseMirror's resting selection sits inside the first block
    // even when the pane has never been touched.
    if (targetView.hasFocus() && selectionIntersectsBlock(targetView, index)) {
      return false;
    }

    const current = blockText(targetView, index);
    const state = this.blockStates[index] ?? emptyState();

    if (!forced && !canAutoWrite({ ...state, autoText: expected }, current)) {
      // The mirror content was written by a human – keep it.
      this.humanEdited.add(index);
      this.blockStates[index] = reduceBlockState(
        state,
        true,
        { type: "targetManuallyEdited" }
      );
      return true;
    }

    return replaceBlockText(targetView, index, text);
  }

  /**
   * Writes a user-confirmed translation into a target block, overriding any
   * human edit protection. Used by the "write into mirror" popover action.
   *
   * @param index The target block index.
   * @param text The text to write.
   */
  forceWrite(index: number, text: string) {
    const targetView = this.targetView;

    if (!targetView) {
      return;
    }

    const sourceHash = this.sourceView
      ? textHash(blockText(this.sourceView, index))
      : "";

    replaceBlockText(targetView, index, text);
    this.humanEdited.delete(index);
    this.blockStates[index] = reduceBlockState(
      this.blockStates[index] ?? emptyState(),
      false,
      { type: "translationSucceeded", sourceHash, autoText: text }
    );
    this.schedulePersist();
  }

  /**
   * Schedules the debounced translation flush.
   */
  private scheduleTranslate() {
    if (this.translateTimer) {
      clearTimeout(this.translateTimer);
    }

    this.translateTimer = setTimeout(() => {
      this.translateTimer = null;
      void this.runTranslate();
    }, TRANSLATE_DEBOUNCE_MS);
  }

  /**
   * Queues a block for translation immediately (used by re-translate).
   *
   * @param index The source block index.
   * @param force Whether to bypass the human edit guard on write.
   */
  retranslate(index: number, force: boolean) {
    const state = this.blockStates[index] ?? emptyState();

    if (force) {
      this.humanEdited.delete(index);
      this.forced.add(index);
      this.blockStates[index] = reduceBlockState(state, false, {
        type: "retranslateConfirmed",
        sourceHash: state.sourceHash,
      });
    }

    this.translateQueue.add(index);
    this.scheduleTranslate();
  }

  /**
   * Marks a block as human edited (called when the user types into it).
   *
   * @param index The target block index.
   */
  markHumanEdited(index: number) {
    this.humanEdited.add(index);
    const state = this.blockStates[index] ?? emptyState();

    if (state.status !== "pending") {
      this.blockStates[index] = reduceBlockState(
        state,
        true,
        { type: "targetManuallyEdited" }
      );
    }
  }

  /**
   * Schedules the debounced block state persistence.
   */
  private schedulePersist() {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }

    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;

      if (this.pairId) {
        void BilingualStore.updateState(this.pairId, [...this.blockStates]);
      }
    }, PERSIST_DEBOUNCE_MS);
  }

  /**
   * Schedules a consistency check between source and target structures.
   */
  private scheduleConsistencyCheck() {
    if (this.consistencyTimer) {
      return;
    }

    this.consistencyTimer = setTimeout(() => {
      this.consistencyTimer = null;
      this.checkConsistency();
    }, 1000);
  }

  /**
   * Compares source and target block signatures and sets the mismatch flag.
   * Only mirrorable block types participate: types the engine mirrors as
   * placeholders (lists, tables, …) are equal on both sides by construction.
   */
  checkConsistency() {
    const sourceView = this.sourceView;
    const targetView = this.targetView;

    if (!sourceView || !targetView) {
      return;
    }

    runInAction(() => {
      this.hasMismatch =
        mirrorableKey(viewBlockSignatures(sourceView)) !==
        mirrorableKey(viewBlockSignatures(targetView));
    });
  }

  /**
   * Aligns the target document's top-level structure with the source when
   * the mirror has no content of its own yet. This covers the initial load:
   * the source content arrives through Yjs sync as remote transactions and
   * no client mirrors structure for it.
   */
  private ensureTargetStructure() {
    const sourceView = this.sourceView;
    const targetView = this.targetView;

    if (!sourceView || !targetView) {
      return;
    }

    if (
      mirrorableKey(viewBlockSignatures(sourceView)) ===
      mirrorableKey(viewBlockSignatures(targetView))
    ) {
      return;
    }

    // Only auto-align an untouched mirror; a mirror with human content goes
    // through the explicit repair flow instead.
    if (targetView.state.doc.textContent.trim().length > 0) {
      this.checkConsistency();
      return;
    }

    const ops = diffTopLevelBlocks(
      viewBlockSignatures(targetView),
      viewBlockSignatures(sourceView)
    );

    for (const op of ops) {
      this.applyStructureOp(targetView, op);
    }

    const oldSize = this.blockStates.length;
    this.blockStates = applyBlockOps(this.blockStates, ops, (insert) =>
      MIRRORABLE_TYPES.has(insert.signature.type)
        ? emptyState()
        : { ...emptyState(), status: "skipped" }
    );
    this.humanEdited = remapIndexSet(this.humanEdited, ops, oldSize);
    this.forced = remapIndexSet(this.forced, ops, oldSize);
    this.checkConsistency();
  }

  /**
   * Repairs the target structure to match the source: removes extra blocks
   * and appends missing ones. Existing target text of surviving blocks is
   * preserved.
   */
  repair() {
    const sourceView = this.sourceView;
    const targetView = this.targetView;

    if (!sourceView || !targetView) {
      return;
    }

    const sourceSigs = viewBlockSignatures(sourceView);
    const ops = diffTopLevelBlocks(viewBlockSignatures(targetView), sourceSigs);

    for (const op of ops) {
      this.applyStructureOp(targetView, op);
    }

    const oldSize = this.blockStates.length;
    this.blockStates = applyBlockOps(this.blockStates, ops, (insert) =>
      MIRRORABLE_TYPES.has(insert.signature.type)
        ? emptyState()
        : { ...emptyState(), status: "skipped" }
    );
    this.humanEdited = remapIndexSet(this.humanEdited, ops, oldSize);
    this.forced = remapIndexSet(this.forced, ops, oldSize);
    this.checkConsistency();
    this.schedulePersist();
  }

  /**
   * Queues every block that has text but has never been translated.
   */
  private queueUntranslatedBlocks() {
    const sourceView = this.sourceView;

    if (!sourceView) {
      return;
    }

    sourceView.state.doc.forEach((node, _offset, index) => {
      const state = this.blockStates[index] ?? emptyState();

      if (
        node.textContent.trim().length > 0 &&
        isTextReplaceable(node) &&
        state.status === "empty" &&
        !state.sourceHash
      ) {
        this.translateQueue.add(index);
      }
    });

    if (this.translateQueue.size > 0) {
      this.scheduleTranslate();
    }
  }

  /**
   * Parks failed mirror writes and retries them with backoff until the
   * target structure catches up or the attempt limit is reached.
   */
  private scheduleRetryWrite() {
    if (this.retryWriteTimer) {
      return;
    }

    this.retryWriteTimer = setTimeout(() => {
      this.retryWriteTimer = null;
      this.flushPendingWrites();
    }, WRITE_RETRY_MS);
  }

  /**
   * Retries parked mirror writes after ensuring the target structure.
   */
  private flushPendingWrites() {
    if (this.destroyed) {
      return;
    }

    if (!this.targetView) {
      this.scheduleRetryWrite();
      return;
    }

    this.ensureTargetStructure();

    for (const [index, pending] of [...this.pendingWrites]) {
      const written = this.writeTarget(
        index,
        pending.text,
        pending.expected,
        pending.forced
      );

      if (written) {
        this.pendingWrites.delete(index);
      } else {
        pending.attempts++;

        if (pending.attempts > 10) {
          this.pendingWrites.delete(index);
          Logger.warn(
            `bilingual mirror write for block ${index} abandoned after repeated retries`
          );
        }
      }
    }

    if (this.pendingWrites.size > 0) {
      this.scheduleRetryWrite();
    }
  }

  /**
   * Pads or trims the block state array to match the source block count.
   */
  private alignBlockStatesLength() {
    const sourceView = this.sourceView;

    if (!sourceView) {
      return;
    }

    const count = sourceView.state.doc.childCount;

    while (this.blockStates.length < count) {
      this.blockStates.push(emptyState());
    }

    if (this.blockStates.length > count) {
      this.blockStates.length = count;
    }
  }
}
