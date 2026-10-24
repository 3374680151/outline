import type { Node as ProsemirrorNode } from "prosemirror-model";
import type { Transaction } from "prosemirror-state";
import { Schema } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import {
  applyGrammarFix,
  collectGrammarUnits,
  filterGrammarMatches,
  isCheckableText,
  type GrammarEditor,
  type GrammarMatch,
} from "./documentGrammar";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*" },
    heading: {
      group: "block",
      content: "text*",
      attrs: { level: { default: 1 } },
    },
    code_block: { group: "block", content: "text*" },
    bullet_list: { group: "block", content: "list_item+" },
    list_item: { content: "paragraph block*" },
    text: {},
  },
  marks: {
    strong: {},
  },
});

function paragraph(text: string) {
  return schema.nodes.paragraph.create(null, text ? schema.text(text) : null);
}

function buildDoc(...blocks: ProsemirrorNode[]) {
  return schema.nodes.doc.create(null, blocks);
}

function blocksOf(doc: ProsemirrorNode): ProsemirrorNode[] {
  const blocks: ProsemirrorNode[] = [];
  doc.forEach((child) => blocks.push(child));
  return blocks;
}

function createFakeEditor(doc: ProsemirrorNode) {
  const state = EditorState.create({ doc });
  const dispatched: ProsemirrorNode[] = [];
  const editor: GrammarEditor = {
    view: {
      state,
      dispatch: (tr: Transaction) => {
        dispatched.push(tr.doc);
      },
    },
  };
  return {
    editor,
    lastDoc: () => dispatched[dispatched.length - 1] ?? null,
    dispatchCount: () => dispatched.length,
  };
}

function match(offset: number, length: number, value?: string): GrammarMatch {
  return {
    message: "Possible typo",
    offset,
    length,
    replacements: value ? [{ value }] : [],
  };
}

describe("#collectGrammarUnits", () => {
  it("should collect text blocks and list items, skipping code blocks", () => {
    const doc = buildDoc(
      paragraph("First paragraph."),
      schema.nodes.heading.create({ level: 2 }, schema.text("A heading")),
      schema.nodes.code_block.create(null, schema.text("const a = 1;")),
      schema.nodes.bullet_list.create(null, [
        schema.nodes.list_item.create(null, paragraph("List item one")),
      ])
    );

    expect(collectGrammarUnits(doc)).toEqual([
      "First paragraph.",
      "A heading",
      "List item one",
    ]);
  });

  it("should skip empty blocks", () => {
    const doc = buildDoc(paragraph(""), paragraph("Hello"));

    expect(collectGrammarUnits(doc)).toEqual(["Hello"]);
  });
});

describe("#isCheckableText", () => {
  it("should accept English prose", () => {
    expect(isCheckableText("This is an English sentence.")).toBe(true);
  });

  it("should reject text without enough Latin letters", () => {
    expect(isCheckableText("你好，世界！")).toBe(false);
    expect(isCheckableText("12345 + 678 = 9012")).toBe(false);
    expect(isCheckableText("ab")).toBe(false);
  });
});

describe("#filterGrammarMatches", () => {
  it("should filter out matches that overlap CJK characters", () => {
    const text = "用 the wrong word 和 an test";
    const matches = [
      { ...match(2, 3), message: "Use a instead of an" },
      { ...match(17, 1), message: "Unknown word" },
    ];

    expect(filterGrammarMatches(text, matches)).toHaveLength(1);
    expect(filterGrammarMatches(text, matches)[0].offset).toEqual(2);
  });
});

describe("#applyGrammarFix", () => {
  it("should replace the flagged span in the matching block", () => {
    const doc = buildDoc(
      paragraph("Something else."),
      paragraph("This is an test.")
    );
    const fake = createFakeEditor(doc);

    expect(
      applyGrammarFix(fake.editor, {
        unitText: "This is an test.",
        offset: 8,
        length: 2,
        replacement: "a",
      })
    ).toBe(true);

    expect(fake.lastDoc() && blocksOf(fake.lastDoc())[1].textContent).toEqual(
      "This is a test."
    );
  });

  it("should keep the marks of the replaced text", () => {
    const marked = schema.nodes.paragraph.create(null, [
      schema.text("This is "),
      schema.text("teh", [schema.marks.strong.create()]),
      schema.text(" story."),
    ]);
    const fake = createFakeEditor(buildDoc(marked));

    expect(
      applyGrammarFix(fake.editor, {
        unitText: "This is teh story.",
        offset: 8,
        length: 3,
        replacement: "the",
      })
    ).toBe(true);

    const doc = fake.lastDoc();
    expect(doc && doc.textContent).toEqual("This is the story.");

    let found: ProsemirrorNode | undefined;
    doc?.descendants((child) => {
      if (child.isText && child.text === "the") {
        found = child;
      }
      return !found;
    });
    expect(found?.marks.map((mark) => mark.type.name)).toEqual(["strong"]);
  });

  it("should fix text inside nested containers", () => {
    const doc = buildDoc(
      schema.nodes.bullet_list.create(null, [
        schema.nodes.list_item.create(null, paragraph("This is an test.")),
      ])
    );
    const fake = createFakeEditor(doc);

    expect(
      applyGrammarFix(fake.editor, {
        unitText: "This is an test.",
        offset: 8,
        length: 2,
        replacement: "a",
      })
    ).toBe(true);

    expect(fake.lastDoc()?.textContent).toEqual("This is a test.");
  });

  it("should do nothing when the checked text is no longer present", () => {
    const fake = createFakeEditor(buildDoc(paragraph("Changed entirely.")));

    expect(
      applyGrammarFix(fake.editor, {
        unitText: "This is an test.",
        offset: 8,
        length: 2,
        replacement: "a",
      })
    ).toBe(false);
    expect(fake.dispatchCount()).toEqual(0);
  });

  it("should do nothing when the span is out of bounds", () => {
    const fake = createFakeEditor(buildDoc(paragraph("This is an test.")));

    expect(
      applyGrammarFix(fake.editor, {
        unitText: "This is an test.",
        offset: 200,
        length: 2,
        replacement: "a",
      })
    ).toBe(false);
    expect(fake.dispatchCount()).toEqual(0);
  });
});
