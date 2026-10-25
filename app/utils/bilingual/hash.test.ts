import { describe, expect, it } from "vitest";
import { textHash } from "./hash";

describe("textHash", () => {
  it("is stable for identical input", () => {
    expect(textHash("hellow every one")).toBe(textHash("hellow every one"));
  });

  it("differs for different input", () => {
    expect(textHash("hello")).not.toBe(textHash("hellp"));
  });

  it("differs when only the length differs", () => {
    expect(textHash("abc")).not.toBe(textHash("abcd"));
  });

  it("returns a 16 character hex digest", () => {
    expect(textHash("中文内容")).toMatch(/^[0-9a-f]{16}$/);
  });
});
