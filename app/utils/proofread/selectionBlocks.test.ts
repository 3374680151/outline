import { describe, expect, it } from "vitest";
import { Schema, type Node as PMNode } from "prosemirror-model";
import { selectionBlocks } from "./selectionBlocks";

const schema = new Schema({
  nodes: {
    doc: {
      content: "block+",
    },
    paragraph: {
      group: "block",
      content: "inline*",
    },
    heading: {
      group: "block",
      content: "inline*",
    },
    code_block: {
      group: "block",
      content: "text*",
      code: true,
    },
    text: {
      group: "inline",
    },
  },
});

function makeDoc(...nodes: PMNode[]) {
  return schema.node("doc", null, nodes);
}

function para(text: string) {
  return schema.node("paragraph", null, text ? [schema.text(text)] : []);
}

/** The content range of the top-level child at the given index. */
function contentRange(doc: PMNode, index: number) {
  let found: { from: number; to: number } | undefined;
  doc.forEach((node, offset, childIndex) => {
    if (childIndex === index) {
      found = {
        from: offset + 1,
        to: offset + node.nodeSize - 1,
      };
    }
  });

  if (!found) {
    throw new Error(`No child at index ${index}`);
  }

  return found;
}

describe("selectionBlocks", () => {
  it("returns the selected text for a selection inside one paragraph", () => {
    const doc = makeDoc(para("hello world"), para("second"));
    const first = contentRange(doc, 0);

    const blocks = selectionBlocks(
      doc,
      first.from + 6,
      first.from + 11
    );

    expect(blocks).toEqual([
      {
        blockFrom: 0,
        blockIndex: 0,
        text: "world",
      },
    ]);
  });

  it("splits a selection spanning two paragraphs into two texts", () => {
    const doc = makeDoc(para("alpha beta"), para("gamma delta"));
    const first = contentRange(doc, 0);
    const second = contentRange(doc, 1);

    const blocks = selectionBlocks(doc, first.from + 6, second.from + 5);

    expect(blocks).toEqual([
      {
        blockFrom: 0,
        blockIndex: 0,
        text: "beta",
      },
      {
        blockFrom: second.from - 1,
        blockIndex: 1,
        text: "gamma",
      },
    ]);
  });

  it("checks every checkable block a whole-document selection covers", () => {
    const doc = makeDoc(
      schema.node("heading", null, [schema.text("Title")]),
      para("one"),
      para("two"),
      para("three")
    );
    const blocks = selectionBlocks(doc, 1, doc.content.size - 1);

    expect(blocks?.map((block) => block.text)).toEqual([
      "Title",
      "one",
      "two",
      "three",
    ]);
    expect(blocks?.map((block) => block.blockIndex)).toEqual([0, 1, 2, 3]);
  });

  it("skips empty paragraphs and non-checkable blocks", () => {
    const doc = makeDoc(
      para("before"),
      para(""),
      schema.node("code_block", null, [schema.text("const x = 1;")]),
      para("after")
    );
    const blocks = selectionBlocks(doc, 1, doc.content.size - 1);

    expect(blocks?.map((block) => block.text)).toEqual(["before", "after"]);
  });

  it("returns null for an empty selection", () => {
    const doc = makeDoc(para("hello"));
    const first = contentRange(doc, 0);

    expect(selectionBlocks(doc, first.from, first.from)).toBeNull();
  });

  it("returns null when the selection covers no checkable block", () => {
    const doc = makeDoc(
      schema.node("code_block", null, [schema.text("code only")])
    );

    expect(selectionBlocks(doc, 1, doc.content.size - 1)).toBeNull();
  });

  it("returns null when the selection only covers empty paragraphs", () => {
    const doc = makeDoc(para(""), para(""));

    expect(selectionBlocks(doc, 1, doc.content.size - 1)).toBeNull();
  });
});
