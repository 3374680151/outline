/**
 * Structural diff between the top-level block sequences of two versions of a
 * document. Used by the bilingual mirror engine to apply the same structural
 * operations to the mirror document.
 */

/** Minimal signature of one top-level block used for diffing. */
export interface BlockSignature {
  /** ProseMirror node type name, e.g. "paragraph" or "heading". */
  type: string;
  /** Heading level when the block is a heading. */
  level?: number;
}

/** A structural operation to apply to a block sequence. */
export type BlockOp =
  | { op: "remove"; index: number; signature: BlockSignature }
  | { op: "insert"; index: number; signature: BlockSignature };

/**
 * Computes the key used to compare two blocks. Only structure is compared –
 * the text content of a block never takes part in the diff.
 *
 * @param block The block signature.
 * @returns The comparison key.
 */
function blockKey(block: BlockSignature): string {
  return block.level === undefined ? block.type : `${block.type}:${block.level}`;
}

/**
 * Diffs two top-level block sequences into sequential operations.
 *
 * The returned operations are meant to be applied in order to a sequence that
 * starts as `before`; each `index` refers to the evolving sequence at the
 * time the operation is applied, so applying them to a parallel structure
 * (such as the mirror document's blocks and the block state array) produces
 * the same result as the source transformation.
 *
 * @param before The previous top-level block signatures.
 * @param after The new top-level block signatures.
 * @returns Operations transforming `before` into `after`, in application order.
 */
export function diffTopLevelBlocks(
  before: BlockSignature[],
  after: BlockSignature[]
): BlockOp[] {
  const a = before.map(blockKey);
  const b = after.map(blockKey);

  // LCS table over block keys. Structure edits are small in practice, so the
  // O(n*m) table is acceptable (n, m are top-level block counts).
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    Array.from({ length: b.length + 1 }, () => 0)
  );

  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] =
        a[i] === b[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const ops: BlockOp[] = [];
  let i = 0;
  let j = 0;
  // Difference between the evolving sequence position and `i` caused by
  // inserts and removals emitted so far.
  let offset = 0;

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }

    if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({
        op: "remove",
        index: i + offset,
        signature: before[i],
      });
      i++;
      offset--;
    } else {
      ops.push({
        op: "insert",
        index: i + offset,
        signature: after[j],
      });
      j++;
      offset++;
    }
  }

  while (i < a.length) {
    ops.push({
      op: "remove",
      index: i + offset,
      signature: before[i],
    });
    i++;
    offset--;
  }

  while (j < b.length) {
    ops.push({
      op: "insert",
      index: i + offset,
      signature: after[j],
    });
    j++;
    offset++;
  }

  return ops;
}

/**
 * Applies block operations to an array, returning a new array. Used for the
 * block state array; the mirror document itself is edited through editor
 * transactions, not through this function.
 *
 * @param blocks The current array.
 * @param ops Operations as produced by diffTopLevelBlocks.
 * @param insertValue Factory for the value of an inserted entry, receives
 * the insert operation so the entry can carry the block signature.
 * @returns The new array with the operations applied.
 */
export function applyBlockOps<T>(
  blocks: T[],
  ops: BlockOp[],
  insertValue: (op: Extract<BlockOp, { op: "insert" }>) => T
): T[] {
  const result = [...blocks];

  for (const blockOp of ops) {
    if (blockOp.op === "remove") {
      result.splice(blockOp.index, 1);
    } else {
      result.splice(blockOp.index, 0, insertValue(blockOp));
    }
  }

  return result;
}
