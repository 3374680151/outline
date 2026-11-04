import { describe, expect, it } from "vitest";
import { Schema } from "prosemirror-model";
import { findFragmentRange } from "./findFragment";

const schema = new Schema({
  nodes: {
    doc: {
      content: "block+",
    },
    paragraph: {
      group: "block",
      content: "inline*",
    },
    text: {
      group: "inline",
    },
  },
});

function makeDoc(texts: string[]) {
  return schema.node(
    "doc",
    null,
    texts.map((text) =>
      schema.node("paragraph", null, text ? [schema.text(text)] : [])
    )
  );
}

describe("findFragmentRange", () => {
  it("locates a fragment inside a single text node", () => {
    const doc = makeDoc(["hello world", "second para"]);
    // The second paragraph starts at position 14 (11-char first paragraph
    // plus both boundaries), its content begins at 15.
    const block = doc.nodeAt(13);

    expect(
      findFragmentRange(block!, 13, "second")
    ).toEqual({
      from: 14,
      to: 20,
    });
  });

  it("returns null when the fragment is absent", () => {
    const doc = makeDoc(["hello world"]);
    const block = doc.nodeAt(0);

    expect(findFragmentRange(block!, 0, "missing")).toBeNull();
  });

  it("finds the first occurrence only", () => {
    const doc = makeDoc(["abc abc"]);
    const block = doc.nodeAt(0);

    expect(findFragmentRange(block!, 0, "abc")).toEqual({
      from: 1,
      to: 4,
    });
  });

  it("matches fragments spanning adjacent text nodes", () => {
    // A paragraph whose text is split into two text nodes, like after an
    // inline mark boundary.
    const paragraph = schema.node("paragraph", null, [
      schema.text("foo "),
      schema.text("bar"),
    ]);
    const doc = schema.node("doc", null, [paragraph]);

    expect(findFragmentRange(paragraph, 0, "foo bar")).toEqual({
      from: 1,
      to: 8,
    });
    expect(doc.textContent).toBe("foo bar");
  });
});
