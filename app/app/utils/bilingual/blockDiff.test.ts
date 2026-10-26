import { describe, expect, it } from "vitest";
import { applyBlockOps, diffTopLevelBlocks } from "./blockDiff";
import type { BlockSignature } from "./blockDiff";

const p = (): BlockSignature => ({ type: "paragraph" });
const h = (level: number): BlockSignature => ({ type: "heading", level });

/**
 * Applies the diff operations to the before array and asserts the result
 * equals the after array – the fundamental invariant of the mirror engine.
 */
function expectRoundtrip(before: BlockSignature[], after: BlockSignature[]) {
  const ops = diffTopLevelBlocks(before, after);
  const result = applyBlockOps(before, ops, (op) => op.signature);
  expect(result).toEqual(after);
  return ops;
}

describe("diffTopLevelBlocks", () => {
  it("returns no ops for identical sequences", () => {
    const ops = diffTopLevelBlocks([p(), p()], [p(), p()]);
    expect(ops).toEqual([]);
  });

  it("emits remove and insert for a replaced middle block", () => {
    const ops = expectRoundtrip([p(), p(), p()], [p(), h(1), p()]);
    expect(ops).toHaveLength(2);
    expect(ops.some((op) => op.op === "remove")).toBe(true);
    expect(ops.some((op) => op.op === "insert")).toBe(true);
  });

  it("emits a single insert for an appended block", () => {
    const ops = expectRoundtrip([p()], [p(), p()]);
    expect(ops).toEqual([{ op: "insert", index: 1, signature: p() }]);
  });

  it("emits sequential removes for a truncated tail", () => {
    const ops = expectRoundtrip([p(), p(), p()], [p()]);
    expect(ops).toEqual([
      { op: "remove", index: 1, signature: p() },
      { op: "remove", index: 1, signature: p() },
    ]);
  });

  it("handles insertion at the front", () => {
    const ops = expectRoundtrip([p(), p()], [h(1), p(), p()]);
    expect(ops).toEqual([{ op: "insert", index: 0, signature: h(1) }]);
  });

  it("handles empty to filled and back", () => {
    expectRoundtrip([], [p(), h(2)]);
    expectRoundtrip([p(), h(2)], []);
  });

  it("treats reordering as remove plus insert", () => {
    const ops = expectRoundtrip([p(), h(1)], [h(1), p()]);
    expect(ops).toHaveLength(2);
  });

  it("distinguishes heading levels", () => {
    const ops = expectRoundtrip([h(1)], [h(2)]);
    expect(ops).toHaveLength(2);
  });
});

describe("applyBlockOps", () => {
  it("applies ops to a parallel array with insert factory", () => {
    const result = applyBlockOps(
      ["a", "b", "c"],
      [
        { op: "remove", index: 1, signature: p() },
        { op: "insert", index: 1, signature: p() },
      ],
      (op) => op.signature.type
    );
    expect(result).toEqual(["a", "paragraph", "c"]);
  });

  it("does not mutate the input array", () => {
    const input = ["a", "b"];
    applyBlockOps(input, [{ op: "remove", index: 0, signature: p() }], () => "x");
    expect(input).toEqual(["a", "b"]);
  });
});
