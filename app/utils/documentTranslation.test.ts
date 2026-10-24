import type { Node as ProsemirrorNode } from "prosemirror-model";
import type { Transaction } from "prosemirror-state";
import { Schema } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import {
  buildMirrorDocJSON,
  collectTranslationUnits,
  hasTranslationMark,
  removeTranslations,
  type TranslationEditor,
} from "./documentTranslation";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*" },
    heading: {
      group: "block",
      content: "text*",
      attrs: { level: { default: 1 } },
    },
    bullet_list: { group: "block", content: "list_item+" },
    list_item: { content: "paragraph block*" },
    text: {},
  },
  marks: {
    translation: {
      excludes: "",
      attrs: { hash: { default: "" } },
      toDOM: () => ["span", { class: "translation-marker" }],
      parseDOM: [{ tag: ".translation-marker" }],
    },
  },
});

function paragraph(text: string, translated = false) {
  const marks = translated
    ? [schema.marks.translation.create({ hash: "abc" })]
    : undefined;
  return schema.nodes.paragraph.create(
    null,
    text ? schema.text(text, marks) : null
  );
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
  const editor: TranslationEditor = {
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

describe("#hasTranslationMark", () => {
  it("should detect translated text inside a block", () => {
    const doc = buildDoc(paragraph("你好", true));
    expect(hasTranslationMark(blocksOf(doc)[0])).toBe(true);
  });

  it("should return false for plain blocks", () => {
    const doc = buildDoc(paragraph("Hello"));
    expect(hasTranslationMark(blocksOf(doc)[0])).toBe(false);
  });
});

describe("#collectTranslationUnits", () => {
  it("should collect text blocks and list items, skipping translated blocks", () => {
    const doc = buildDoc(
      paragraph("First paragraph."),
      schema.nodes.heading.create({ level: 2 }, schema.text("A heading")),
      schema.nodes.bullet_list.create(null, [
        schema.nodes.list_item.create(null, paragraph("List item one")),
        schema.nodes.list_item.create(null, paragraph("List item two")),
      ]),
      paragraph("你好", true)
    );

    expect(collectTranslationUnits(doc)).toEqual([
      "First paragraph.",
      "A heading",
      "List item one",
      "List item two",
    ]);
  });
});

describe("#buildMirrorDocJSON", () => {
  it("should mirror the structure with translated text", () => {
    const doc = buildDoc(
      paragraph("Hello"),
      schema.nodes.heading.create({ level: 2 }, schema.text("Title")),
      schema.nodes.bullet_list.create(null, [
        schema.nodes.list_item.create(null, paragraph("Item")),
      ])
    );
    const translations = new Map([
      ["Hello", "你好"],
      ["Title", "标题"],
      ["Item", "条目"],
    ]);

    expect(buildMirrorDocJSON(doc, translations)).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "你好" }],
        },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "标题" }],
        },
        {
          type: "bullet_list",
          content: [
            {
              type: "list_item",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "条目" }],
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it("should omit blocks without a translation", () => {
    const doc = buildDoc(paragraph("Hello"), paragraph("Untranslated"));
    const translations = new Map([["Hello", "你好"]]);

    const mirror = buildMirrorDocJSON(doc, translations);
    expect(mirror?.content).toHaveLength(1);
  });

  it("should skip translated blocks left by older versions", () => {
    const doc = buildDoc(paragraph("Hello"), paragraph("你好", true));

    expect(buildMirrorDocJSON(doc, new Map())).toBeNull();
  });

  it("should return null when nothing is translated", () => {
    const doc = buildDoc(paragraph("Hello"));
    expect(buildMirrorDocJSON(doc, new Map())).toBeNull();
  });
});

describe("#removeTranslations", () => {
  it("should remove translated blocks and keep source blocks", () => {
    const doc = buildDoc(
      paragraph("Hello"),
      paragraph("你好", true),
      paragraph("World"),
      paragraph("世界", true)
    );
    const fake = createFakeEditor(doc);

    expect(removeTranslations(fake.editor)).toBe(true);

    const blocks = blocksOf(fake.lastDoc() ?? doc);
    expect(blocks.map((block) => block.textContent)).toEqual([
      "Hello",
      "World",
    ]);
  });

  it("should never empty the document", () => {
    const doc = buildDoc(paragraph("你好", true));
    const fake = createFakeEditor(doc);

    expect(removeTranslations(fake.editor)).toBe(false);
    expect(fake.dispatchCount()).toEqual(0);
  });

  it("should do nothing without translated blocks", () => {
    const doc = buildDoc(paragraph("Hello"));
    const fake = createFakeEditor(doc);

    expect(removeTranslations(fake.editor)).toBe(false);
    expect(fake.dispatchCount()).toEqual(0);
  });
});
