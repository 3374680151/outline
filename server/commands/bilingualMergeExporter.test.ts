import type { BilingualBlockState } from "@shared/types/bilingual";
import { mergeBilingualContent } from "./bilingualMergeExporter";

/**
 * Builds a paragraph node for the given text.
 *
 * @param text The text of the paragraph.
 * @returns The ProseMirror paragraph node.
 */
function paragraph(text: string) {
  return { type: "paragraph", content: text ? [{ type: "text", text }] : [] };
}

/**
 * Builds the persisted translation state of a block.
 *
 * @param autoText The translated text.
 * @param status The block status.
 * @returns The block state.
 */
function state(
  autoText: string,
  status: BilingualBlockState["status"] = "auto"
): BilingualBlockState {
  return { status, sourceHash: "hash", autoText };
}

describe("mergeBilingualContent", () => {
  it("interleaves each source paragraph with its translation as a quote", () => {
    const merged = mergeBilingualContent(
      { type: "doc", content: [paragraph("Hello"), paragraph("World")] } as never,
      {
        type: "doc",
        content: [paragraph("你好"), paragraph("世界")],
      } as never
    );

    expect(merged.content).toHaveLength(4);
    expect(merged.content?.[0]).toMatchObject({ type: "paragraph" });
    expect(merged.content?.[1]).toMatchObject({ type: "blockquote" });
    expect(JSON.stringify(merged.content?.[1])).toContain("你好");
  });

  it("falls back to the recorded block state when the mirror content lags", () => {
    // The mirror document has not been persisted yet – the collaboration
    // store debounce means its content is still empty at save time.
    const merged = mergeBilingualContent(
      { type: "doc", content: [paragraph("Hello")] } as never,
      { type: "doc", content: [] } as never,
      [state("你好")]
    );

    expect(merged.content).toHaveLength(2);
    expect(JSON.stringify(merged.content?.[1])).toContain("你好");
  });

  it("does not pair a translation with an empty source block", () => {
    const merged = mergeBilingualContent(
      { type: "doc", content: [paragraph("Hello"), paragraph("")] } as never,
      { type: "doc", content: [paragraph("你好"), paragraph("世界")] } as never
    );

    // The empty paragraph is kept as part of the source structure, but the
    // translation that happens to sit at the same index is not attached to it.
    expect(merged.content).toHaveLength(3);
    expect(merged.content?.[2]).toMatchObject({ type: "paragraph" });
  });

  it("ignores failed and skipped translations", () => {
    const merged = mergeBilingualContent(
      { type: "doc", content: [paragraph("Hello")] } as never,
      { type: "doc", content: [] } as never,
      [state("你好", "failed")]
    );

    expect(merged.content).toHaveLength(1);
  });

  it("never duplicates non-text blocks", () => {
    const image = { type: "image", attrs: { src: "/api/files.x" } };
    const merged = mergeBilingualContent(
      { type: "doc", content: [image] } as never,
      { type: "doc", content: [paragraph("图")] } as never,
      [state("图")]
    );

    expect(merged.content).toHaveLength(1);
  });

  it("handles a missing mirror document", () => {
    const merged = mergeBilingualContent(
      { type: "doc", content: [paragraph("Hello")] } as never,
      null
    );

    expect(merged.content).toHaveLength(1);
  });
});
