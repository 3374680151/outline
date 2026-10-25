import { describe, expect, it } from "vitest";
import { buildParagraphTextMap, pmRangeForOffset } from "./offsetTable";
import type { InlineItem } from "./offsetTable";

function items(...list: InlineItem[]): InlineItem[] {
  return list;
}

describe("buildParagraphTextMap", () => {
  it("concatenates text segments and records ascending entries", () => {
    const map = buildParagraphTextMap(
      items(
        { kind: "text", text: "ab", pmPos: 1 },
        { kind: "text", text: "cd", pmPos: 4 }
      )
    );

    expect(map.text).toBe("abcd");
    expect(map.entries).toEqual([
      { kind: "text", pmPos: 1, strStart: 0, strEnd: 2 },
      { kind: "text", pmPos: 4, strStart: 2, strEnd: 4 },
    ]);
  });

  it("records zero-width gap entries between text", () => {
    const map = buildParagraphTextMap(
      items(
        { kind: "text", text: "ab", pmPos: 1 },
        { kind: "gap", pmPos: 3 },
        { kind: "text", text: "cd", pmPos: 4 }
      )
    );

    expect(map.text).toBe("abcd");
    expect(map.entries).toEqual([
      { kind: "text", pmPos: 1, strStart: 0, strEnd: 2 },
      { kind: "gap", pmPos: 3, strStart: 2, strEnd: 2 },
      { kind: "text", pmPos: 4, strStart: 2, strEnd: 4 },
    ]);
  });
});

describe("pmRangeForOffset", () => {
  const map = buildParagraphTextMap(
    items(
      { kind: "text", text: "ab", pmPos: 1 },
      { kind: "gap", pmPos: 3 },
      { kind: "text", text: "cdef", pmPos: 4 }
    )
  );

  it("maps a match inside one text node", () => {
    const range = pmRangeForOffset(map, 3, 2);
    expect(range).toEqual({ pmStart: 5, pmEnd: 7, crossesGap: false });
  });

  it("maps a match spanning two adjacent text nodes", () => {
    const noGap = buildParagraphTextMap(
      items(
        { kind: "text", text: "ab", pmPos: 1 },
        { kind: "text", text: "cdef", pmPos: 5 }
      )
    );
    const range = pmRangeForOffset(noGap, 1, 3);
    expect(range).toEqual({ pmStart: 2, pmEnd: 7, crossesGap: false });
  });

  it("flags matches that cross a gap node", () => {
    const range = pmRangeForOffset(map, 1, 2);
    expect(range).not.toBeNull();
    expect(range?.crossesGap).toBe(true);
  });

  it("returns null for a match ending on a gap boundary", () => {
    // "ab" is 0..2, the gap sits at 2, so a match ending exactly at 2 has no
    // containing text entry on the end side.
    const range = pmRangeForOffset(map, 1, 1);
    expect(range).toEqual({ pmStart: 2, pmEnd: 3, crossesGap: false });
  });

  it("returns null when the offset is outside any text entry", () => {
    expect(pmRangeForOffset(map, 100, 2)).toBeNull();
  });

  it("returns null for negative length", () => {
    expect(pmRangeForOffset(map, 0, -1)).toBeNull();
  });
});
