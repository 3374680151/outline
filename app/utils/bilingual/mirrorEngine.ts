import { makeObservable, observable, runInAction } from "mobx";
import type { EditorView } from "prosemirror-view";
import type { BilingualBlockState } from "@shared/types/bilingual";
import BilingualStore from "~/stores/BilingualStore";
import Logger from "~/utils/Logger";
import { autoTranslateOnOpen } from "./prefs";
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

/** Maximum rounds of the post-mount sync probe. */
const MAX_SYNC_PROBES = 10;

/** Consecutive stable probe rounds before the probe stops early. */
const STABLE_PROBE_ROUNDS = 2;

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

  constructor() {
    makeObservable(this);
  }

  /** Whether source and target structures disagree (shows a repair banner). */
  @observable
  hasMismatch = false;

  /** Aggregate translation progress for the toolbar, updated via actions. */
  @observable
  progress = { translated: 0, total: 0 };

  /** Set of block indexes whose mirror content was written by a human. */
  private humanEdited = new Set<number>();

  /** Set of block indexes queued for a forced (guard-bypassing) rewrite. */
  private forced = new Set<number>();

  /** Block indexes known to be in or near the viewport, for lazy translation. */
  private visibleBlocks = new Set<number>();

  /** Block indexes changed since the last successful persist. */
  private dirty = new Set<number>();

  /** Whether the state array was structurally rebuilt and must persist fully. */
  private dirtyAll = false;

  /** Timestamp of the last remote (Yjs sync) transaction on either editor. */
  private lastRemoteAt = 0;

  /** Deferred heal timer for content drift. */
  private healTimer: ReturnType<typeof setTimeout> | null = null;

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
    this.updateProgress();
    // Queue content for its first translation (enabling bilingual mode on a
    // document that already has text).
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
   * Adopts editor views that registered before the pair resolved. Editors
   * mount through the standard document scene and may beat the pair lookup;
   * their views are parked in the BilingualStore until here.
   *
   * @param source The source editor view, when mounted.
   * @param target The target editor view, when mounted.
   */
  adoptViews(source?: EditorView, target?: EditorView) {
    if (source) {
      this.registerSource(source);
    }

    if (target) {
      this.registerTarget(target);
    }
  }

  /**
   * Records source blocks that entered the viewport, so translation work can
   * prioritize (or restrict itself to) visible content.
   *
   * @param indexes The block indexes that became visible.
   */
  markBlocksVisible(indexes: number[]) {
    for (const index of indexes) {
      this.visibleBlocks.add(index);
    }

    this.queueUntranslatedBlocks();
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

    if (this.healTimer) {
      clearTimeout(this.healTimer);
      this.healTimer = null;
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

    this.lastRemoteAt = Date.now();
    this.lastSignatures = viewBlockSignatures(this.sourceView);
    this.lastTextHashes = viewBlockTextHashes(this.sourceView, textHash);
    this.alignBlockStatesLength();
    this.ensureTargetStructure();
    this.updateProgress();
    this.checkConsistency();
    this.queueUntranslatedBlocks();
  };

  /**
   * Probes briefly for content that reaches the editor through Yjs sync
   * without observable transactions (initial restore), which would otherwise
   * never run through the remote transaction path. The probe stops early
   * once the structure has been stable for two consecutive rounds.
   */
  private startSyncProbe() {
    if (this.syncProbeTimer) {
      clearTimeout(this.syncProbeTimer);
    }

    let probes = 0;
    let stableRounds = 0;
    let lastSeen: string | null = null;

    const probe = () => {
      if (this.destroyed || !this.sourceView) {
        return;
      }

      const signatures = JSON.stringify(viewBlockSignatures(this.sourceView));

      if (signatures !== JSON.stringify(this.lastSignatures)) {
        stableRounds = 0;
        this.handleRemoteTransactions();
      } else {
        // The source content is already present but the target document
        // (which loads independently) may not have caught up yet.
        stableRounds =
          lastSeen !== null && lastSeen === signatures
            ? stableRounds + 1
            : stableRounds;
        this.ensureTargetStructure();
        this.queueUntranslatedBlocks();
      }

      lastSeen = signatures;
      probes++;

      if (stableRounds >= STABLE_PROBE_ROUNDS || probes >= MAX_SYNC_PROBES) {
        this.syncProbeTimer = null;
        return;
      }

      this.syncProbeTimer = setTimeout(probe, 1000);
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
    this.dirtyAll = true;
    this.updateProgress();
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
      this.markDirty(i);

      // Re-translate blocks whose source changed: untranslated, stale, and
      // failed ones (the write path protects human mirror edits).
      if (
        (nextState.status === "empty" ||
          nextState.status === "stale" ||
          nextState.status === "failed") &&
        translatable
      ) {
        this.translateQueue.add(i);
        queued = true;
      }
    }

    this.lastTextHashes = hashes;
    this.alignBlockStatesLength();
    this.updateProgress();

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
      // Bounds-guarded: a queued index can go stale when blocks are deleted
      // concurrently during the translate debounce.
      const node =
        index < sourceView.state.doc.childCount
          ? sourceView.state.doc.child(index)
          : undefined;
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
      // Skip fragments produced mid-typing; a full sentence follows shortly.
    const translatable = batch.filter((item) => item.text.trim().length >= 2);

      for (const item of translatable) {
        const state = this.blockStates[item.index] ?? emptyState();
        this.blockStates[item.index] = reduceBlockState(state, false, {
          type: "translationStarted",
          sourceHash: item.hash,
        });
        this.markDirty(item.index);
      }
      this.schedulePersist();

      if (translatable.length > 0) {
        // A misaligned mirror would put translations into the wrong blocks;
        // realign first (safe while the mirror is untouched) or hold off.
        this.checkConsistency();

        if (this.hasMismatch) {
          this.repair();

          if (this.hasMismatch) {
            for (const item of translatable) {
              this.translateQueue.add(item.index);
            }
            this.scheduleTranslate();
            return;
          }
        }

        let results: string[];

        try {
          results = await BilingualStore.translate(
            translatable.map((item) => item.text)
          );
        } catch (err) {
          Logger.warn("bilingual translate failed", { err });
          for (const item of translatable) {
            const state = this.blockStates[item.index] ?? emptyState();
            this.blockStates[item.index] = reduceBlockState(
              state,
              this.humanEdited.has(item.index),
              {
                type: "translationFailed",
                message: "translation failed",
              }
            );
            this.markDirty(item.index);
          }
          this.updateProgress();
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
          this.markDirty(item.index);
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

        this.updateProgress();
        this.checkConsistency();
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
      this.markDirty(index);
      this.updateProgress();
      return true;
    }

    const written = replaceBlockText(targetView, index, text);

    // Verify the content landed where intended; an index race between the
    // batch build and the write would otherwise corrupt the mirror silently.
    if (written && blockText(targetView, index) !== text) {
      return false;
    }

    return written;
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
    this.markDirty(index);
    this.updateProgress();
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
      this.markDirty(index);
      this.updateProgress();
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

      if (!this.pairId) {
        return;
      }

      const dirty = this.dirty;
      const all = this.dirtyAll;
      this.dirty = new Set();
      this.dirtyAll = false;
      void BilingualStore.updateState(
        this.pairId,
        [...this.blockStates],
        !all && dirty.size > 0 && dirty.size < this.blockStates.length
          ? dirty
          : undefined
      );
    }, PERSIST_DEBOUNCE_MS);
  }

  /**
   * Records a block index whose state changed since the last persist.
   *
   * @param index The block index.
   */
  private markDirty(index: number) {
    this.dirty.add(index);
  }

  /**
   * Recomputes the aggregate translation progress shown in the toolbar.
   */
  private updateProgress() {
    const sourceView = this.sourceView;
    let total = 0;
    let translated = 0;

    sourceView?.state.doc.forEach((node, _offset, index) => {
      if (!isTextReplaceable(node) || node.textContent.trim().length === 0) {
        return;
      }

      total++;
      const state = this.blockStates[index] ?? emptyState();

      if (state.autoText || state.status === "manual") {
        translated++;
      }
    });

    runInAction(() => {
      this.progress = { translated, total };
    });
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
   * Compares source and target block signatures plus the placement of the
   * engine's own translations, and sets the mismatch flag. Structure alone
   * cannot detect translations that landed in the wrong slot; content drift
   * (an auto block whose mirror text no longer matches the engine's record)
   * is checked block by block.
   */
  checkConsistency() {
    const sourceView = this.sourceView;
    const targetView = this.targetView;

    if (!sourceView || !targetView) {
      return;
    }

    const structuralMismatch =
      mirrorableKey(viewBlockSignatures(sourceView)) !==
      mirrorableKey(viewBlockSignatures(targetView));

    let contentDrift = 0;

    if (!structuralMismatch) {
      sourceView.state.doc.forEach((node, _offset, index) => {
        const state = this.blockStates[index];

        if (!state || state.status !== "auto" || !state.autoText) {
          return;
        }

        const targetNode =
          index < targetView.state.doc.childCount
            ? targetView.state.doc.child(index)
            : undefined;

        if (!targetNode || targetNode.textContent !== state.autoText) {
          contentDrift++;
        }
      });
    }

    runInAction(() => {
      this.hasMismatch = structuralMismatch || contentDrift > 0;
    });

    // Content-only drift affects blocks the engine owns (auto states), so it
    // can be healed in place. Deferred so a consistency check that runs
    // inside a ProseMirror update never dispatches a nested transaction.
    if (!structuralMismatch && contentDrift > 0 && !this.healTimer) {
      this.healTimer = setTimeout(() => {
        this.healTimer = null;

        if (this.destroyed) {
          return;
        }

        this.rewriteDriftedBlocks();
        this.checkConsistency();
        this.schedulePersist();
      }, 50);
    }
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

    // During the initial Yjs sync the source document arrives in chunks;
    // diffing against a partially synced document inserts structural garbage
    // that later misaligns every translation. Wait until the sync stream has
    // been quiet for a moment before aligning.
    if (Date.now() - this.lastRemoteAt < 1500) {
      this.scheduleConsistencyCheck();
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
    this.dirtyAll = true;
    this.updateProgress();
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

    // Apply the structural diff in up to three passes: each pass re-reads
    // the live documents, so a partially applied pass (e.g. an insert whose
    // node type could not be created) is corrected by the next one instead
    // of leaving the mirror silently misaligned.
    const sourceSigs = viewBlockSignatures(sourceView);
    let ops: ReturnType<typeof diffTopLevelBlocks> = [];

    for (let pass = 0; pass < 3; pass++) {
      ops = diffTopLevelBlocks(viewBlockSignatures(targetView), sourceSigs);

      if (ops.length === 0) {
        break;
      }

      for (const op of ops) {
        this.applyStructureOp(targetView, op);
      }
    }

    const oldSize = this.blockStates.length;
    this.blockStates = applyBlockOps(this.blockStates, ops, (insert) =>
      MIRRORABLE_TYPES.has(insert.signature.type)
        ? emptyState()
        : { ...emptyState(), status: "skipped" }
    );
    this.humanEdited = remapIndexSet(this.humanEdited, ops, oldSize);
    this.forced = remapIndexSet(this.forced, ops, oldSize);
    this.dirtyAll = true;
    this.rewriteDriftedBlocks();
    this.updateProgress();
    this.checkConsistency();
    this.schedulePersist();
  }

  /**
   * Rewrites auto-translated blocks whose mirror content no longer matches
   * the engine's record, healing translations that landed in the wrong slot.
   * Human-edited blocks keep their content.
   */
  private rewriteDriftedBlocks() {
    const targetView = this.targetView;

    if (!targetView) {
      return;
    }

    this.blockStates.forEach((state, index) => {
      if (state.status !== "auto" || !state.autoText) {
        return;
      }

      const targetNode =
        index < targetView.state.doc.childCount
          ? targetView.state.doc.child(index)
          : undefined;

      if (targetNode && targetNode.textContent !== state.autoText) {
        replaceBlockText(targetView, index, state.autoText);
      }
    });
  }

  /**
   * Queues blocks that have text but have never been translated. Visible
   * blocks are queued first so the content the user is reading appears
   * first; when automatic translation is disabled only visible blocks are
   * translated at all.
   */
  private queueUntranslatedBlocks() {
    const sourceView = this.sourceView;

    if (!sourceView) {
      return;
    }

    const candidates: number[] = [];

    sourceView.state.doc.forEach((node, _offset, index) => {
      const state = this.blockStates[index] ?? emptyState();

      // Re-queue untranslated blocks and ones whose last attempt failed or
      // went stale, so content recovers automatically once the translation
      // service is reachable again.
      if (
        node.textContent.trim().length > 0 &&
        isTextReplaceable(node) &&
        (state.status === "empty" ||
          state.status === "stale" ||
          state.status === "failed" ||
          (!state.sourceHash && !state.autoText))
      ) {
        candidates.push(index);
      }
    });

    const visible = candidates.filter((index) =>
      this.visibleBlocks.size === 0 ? true : this.visibleBlocks.has(index)
    );
    void visible;
    const hidden = this.visibleBlocks.size
      ? candidates.filter((index) => !this.visibleBlocks.has(index))
      : [];

    const ordered = [...visible, ...hidden];
    const queued =
      autoTranslateOnOpen() || this.translateQueue.size > 0
        ? ordered
        : visible;

    for (const index of queued) {
      this.translateQueue.add(index);
    }

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
   * Pads the block state array to the source block count. The array is never
   * truncated here: during the initial Yjs sync the source document may hold
   * only part of its content, and dropping state for blocks that have not
   * arrived yet would destroy persisted translations.
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
  }
}
