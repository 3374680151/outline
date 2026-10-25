import type { Node as ProsemirrorNode } from "prosemirror-model";
import type { Transaction } from "prosemirror-state";
import { Schema } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import {
  applyGrammarFix,
  collectGrammarBlocks,
  collectGrammarUnits,
  filterGrammarMatches,
  grammarCategoryLabel,
  grammarIssueKind,
  isCheckableText,
  locateGrammarRange,
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
    ruleUrls: [],
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

  it("should collect Chinese text blocks", () => {
    const doc = buildDoc(paragraph("我们讨论了关于这个问题。"));

    expect(collectGrammarUnits(doc)).toEqual(["我们讨论了关于这个问题。"]);
  });
});

describe("#collectGrammarBlocks", () => {
  it("should locate blocks with their absolute positions", () => {
    const doc = buildDoc(paragraph("First."), paragraph("Second."));

    const blocks = collectGrammarBlocks(doc);

    expect(blocks.map((block) => block.text)).toEqual(["First.", "Second."]);
    expect(blocks[0].pos).toEqual(0);
    expect(blocks[1].pos).toEqual(blocks[0].pos + blocks[0].node.nodeSize);
  });

  it("should locate blocks inside list items", () => {
    const doc = buildDoc(
      schema.nodes.bullet_list.create(null, [
        schema.nodes.list_item.create(null, paragraph("List item one")),
      ])
    );

    const blocks = collectGrammarBlocks(doc);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toEqual("List item one");
    expect(blocks[0].pos).toBeGreaterThan(0);
  });
});

describe("#isCheckableText", () => {
  it("should accept English prose", () => {
    expect(isCheckableText("This is an English sentence.")).toBe(true);
  });

  it("should accept Chinese prose", () => {
    expect(isCheckableText("我们讨论了关于这个问题。")).toBe(true);
  });

  it("should reject text without letters", () => {
    expect(isCheckableText("12345 + 678 = 9012")).toBe(false);
    expect(isCheckableText("!!! ??? ...")).toBe(false);
  });
});

describe("#filterGrammarMatches", () => {
  it("should filter out misspellings of personal dictionary words", () => {
    const text = "The word Outlinee is flagged.";
    const matches = [
      { ...match(9, 8), issueType: "misspelling" },
      { ...match(0, 3), issueType: "grammar" },
    ];

    expect(
      filterGrammarMatches(text, matches, { dictionary: ["outlinee"] })
    ).toHaveLength(1);
    expect(
      filterGrammarMatches(text, matches, { dictionary: ["outlinee"] })[0]
        .issueType
    ).toEqual("grammar");
  });

  it("should keep misspellings of words outside the dictionary", () => {
    const matches = [{ ...match(0, 4), issueType: "misspelling" }];

    expect(
      filterGrammarMatches("teh test", matches, { dictionary: ["other"] })
    ).toHaveLength(1);
  });

  it("should filter out disabled rules", () => {
    const matches = [
      { ...match(0, 3), ruleId: "RULE_A" },
      { ...match(4, 2), ruleId: "RULE_B" },
    ];

    const filtered = filterGrammarMatches("an an test", matches, {
      disabledRules: ["RULE_A"],
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].ruleId).toEqual("RULE_B");
  });

  it("should keep everything without filter options", () => {
    const matches = [match(0, 2), match(3, 4)];

    expect(filterGrammarMatches("some text", matches)).toHaveLength(2);
  });
});

describe("#grammarIssueKind", () => {
  it("should color misspellings red, style hints green, others blue", () => {
    expect(
      grammarIssueKind({ ...match(0, 1), issueType: "misspelling" })
    ).toEqual("danger");
    expect(grammarIssueKind({ ...match(0, 1), issueType: "style" })).toEqual(
      "success"
    );
    expect(
      grammarIssueKind({ ...match(0, 1), issueType: "typographical" })
    ).toEqual("success");
    expect(grammarIssueKind({ ...match(0, 1), issueType: "grammar" })).toEqual(
      "accent"
    );
    expect(grammarIssueKind(match(0, 1))).toEqual("accent");
  });
});

describe("#grammarCategoryLabel", () => {
  it("should map issue types to category labels", () => {
    expect(
      grammarCategoryLabel({ ...match(0, 1), issueType: "misspelling" })
    ).toEqual("Spelling");
    expect(
      grammarCategoryLabel({ ...match(0, 1), issueType: "style" })
    ).toEqual("Style");
    expect(
      grammarCategoryLabel({ ...match(0, 1), issueType: "grammar" })
    ).toEqual("Grammar");
    expect(grammarCategoryLabel(match(0, 1))).toEqual("Other");
  });
});

describe("#locateGrammarRange", () => {
  it("should locate a flagged span within the matching block", () => {
    const doc = buildDoc(
      paragraph("Something else."),
      paragraph("这是一个测试。")
    );

    const segment = locateGrammarRange(doc, {
      unitText: "这是一个测试。",
      offset: 2,
      length: 2,
    });

    expect(segment).toBeDefined();
    expect(segment?.from).toBeGreaterThan(0);
    expect(doc.textBetween(segment!.from, segment!.to)).toEqual("一个");
  });

  it("should return undefined for unknown text", () => {
    const doc = buildDoc(paragraph("Something else."));

    expect(
      locateGrammarRange(doc, {
        unitText: "Not present.",
        offset: 0,
        length: 3,
      })
    ).toBeUndefined();
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

  it("should replace a flagged Chinese span", () => {
    const fake = createFakeEditor(
      buildDoc(paragraph("我们讨论了关于这个问题。"))
    );

    expect(
      applyGrammarFix(fake.editor, {
        unitText: "我们讨论了关于这个问题。",
        offset: 5,
        length: 2,
        replacement: "",
      })
    ).toBe(true);

    expect(fake.lastDoc()?.textContent).toEqual("我们讨论了这个问题。");
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
