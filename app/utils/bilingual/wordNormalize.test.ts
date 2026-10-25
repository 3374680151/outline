import { describe, expect, it } from "vitest";
import { normalizeEnglishWord, wordAtOffset } from "./wordNormalize";

describe("normalizeEnglishWord", () => {
  it("accepts plain words", () => {
    expect(normalizeEnglishWord("hello")).toBe("hello");
  });

  it("folds curly apostrophes", () => {
    expect(normalizeEnglishWord("don’t")).toBe("don't");
  });

  it("accepts hyphenated words", () => {
    expect(normalizeEnglishWord("well-known")).toBe("well-known");
  });

  it("trims whitespace", () => {
    expect(normalizeEnglishWord("  word  ")).toBe("word");
  });

  it("rejects phrases with spaces", () => {
    expect(normalizeEnglishWord("two words")).toBeNull();
  });

  it("rejects numbers and symbols", () => {
    expect(normalizeEnglishWord("123")).toBeNull();
    expect(normalizeEnglishWord("he@llo")).toBeNull();
  });

  it("rejects words longer than 64 characters", () => {
    expect(normalizeEnglishWord("a".repeat(65))).toBeNull();
    expect(normalizeEnglishWord("a".repeat(64))).toBe("a".repeat(64));
  });

  it("rejects empty input", () => {
    expect(normalizeEnglishWord("")).toBeNull();
  });
});

describe("wordAtOffset", () => {
  const text = "hellow every one, can you help me learn english";

  it("returns the word under the offset", () => {
    expect(wordAtOffset(text, 2)).toBe("hellow");
    expect(wordAtOffset(text, 5)).toBe("hellow");
    expect(wordAtOffset(text, 7)).toBe("every");
  });

  it("includes apostrophes in the word", () => {
    expect(wordAtOffset("don’t stop", 2)).toBe("don’t");
  });

  it("returns null on whitespace and punctuation", () => {
    expect(wordAtOffset(text, 6)).toBeNull();
    expect(wordAtOffset(text, 16)).toBeNull();
  });

  it("returns null for out of range offsets", () => {
    expect(wordAtOffset(text, -1)).toBeNull();
    expect(wordAtOffset(text, text.length + 1)).toBeNull();
  });

  it("returns the last word at the text end boundary", () => {
    expect(wordAtOffset("word", 3)).toBe("word");
  });
});
