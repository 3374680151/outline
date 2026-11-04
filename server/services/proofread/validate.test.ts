import { describe, expect, it } from "vitest";
import {
  extractJsonArray,
  isPureCJK,
  parseAndValidate,
  MAX_SUGGESTIONS,
} from "./validate";

describe("proofread validation", () => {
  describe("extractJsonArray", () => {
    it("parses a bare array", () => {
      expect(extractJsonArray('[{"original":"a"}]')).toEqual([
        { original: "a" },
      ]);
    });

    it("parses an array wrapped in a code fence with prose", () => {
      const raw = 'Here you go:\n```json\n[{"original":"a"}]\n```\nDone.';
      expect(extractJsonArray(raw)).toEqual([{ original: "a" }]);
    });

    it("returns null when there is no array", () => {
      expect(extractJsonArray("no JSON here")).toBeNull();
      expect(extractJsonArray("inverted ] bracket [")).toBeNull();
    });

    it("returns null when the body is not valid JSON", () => {
      expect(extractJsonArray("[not json]")).toBeNull();
    });
  });

  describe("parseAndValidate", () => {
    const source =
      "every one , can learn to write well if they practice daily.";

    it("keeps suggestions whose fragment exists verbatim in the source", () => {
      const raw = JSON.stringify([
        {
          original: "every one",
          suggestion: "everyone",
          category: "spelling",
          reason: "不定代词应合写。",
        },
      ]);

      expect(parseAndValidate(raw, source)).toEqual([
        {
          original: "every one",
          suggestion: "everyone",
          category: "spelling",
          reason: "不定代词应合写。",
        },
      ]);
    });

    it("drops suggestions with a fragment that is not a substring", () => {
      const raw = JSON.stringify([
        {
          original: "everyone",
          suggestion: "every one",
          category: "spelling",
          reason: "不在原文中。",
        },
        {
          original: "practice",
          suggestion: "practise",
          category: "spelling",
          reason: "动词拼写在美式英语中为 practice。",
        },
      ]);

      expect(parseAndValidate(raw, source)).toHaveLength(1);
      expect(parseAndValidate(raw, source)[0].original).toBe("practice");
    });

    it("drops items with an unknown category or empty reason", () => {
      const raw = JSON.stringify([
        {
          original: "practice",
          suggestion: "practise",
          category: "tone",
          reason: "x",
        },
        {
          original: "practice",
          suggestion: "practise",
          category: "grammar",
          reason: "",
        },
        {
          original: "practice",
          suggestion: "practise",
          category: "grammar",
          reason: "ok",
        },
      ]);

      expect(parseAndValidate(raw, source)).toHaveLength(1);
    });

    it("drops items whose suggestion equals the original", () => {
      const raw = JSON.stringify([
        {
          original: "practice",
          suggestion: "practice",
          category: "grammar",
          reason: "same",
        },
      ]);

      expect(parseAndValidate(raw, source)).toHaveLength(0);
    });

    it("deduplicates identical original+suggestion pairs", () => {
      const raw = JSON.stringify([
        {
          original: "every one",
          suggestion: "everyone",
          category: "spelling",
          reason: "a",
        },
        {
          original: "every one",
          suggestion: "everyone",
          category: "spelling",
          reason: "b",
        },
      ]);

      expect(parseAndValidate(raw, source)).toHaveLength(1);
    });

    it("caps the number of suggestions", () => {
      const items = Array.from(
        {
          length: MAX_SUGGESTIONS + 5,
        },
        (_, index) => ({
          original: `word${index}`,
          suggestion: `fixed${index}`,
          category: "grammar",
          reason: "r",
        })
      );
      const longSource = items
        .map((item) => item.original)
        .join(" and more ");

      expect(parseAndValidate(JSON.stringify(items), longSource)).toHaveLength(
        MAX_SUGGESTIONS
      );
    });

    it("returns an empty list for unparseable output", () => {
      expect(parseAndValidate("I cannot do that", source)).toEqual([]);
    });
  });

  describe("isPureCJK", () => {
    it("detects pure CJK text", () => {
      expect(isPureCJK("大家好，你们好。")).toBe(true);
    });

    it("does not flag English text", () => {
      expect(isPureCJK("every one can learn")).toBe(false);
    });

    it("does not flag mixed text", () => {
      expect(isPureCJK("大家好 everyone")).toBe(false);
    });
  });
});
