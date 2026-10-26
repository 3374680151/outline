import { describe, expect, it } from "vitest";
import { canAutoWrite, reduceBlockState } from "./statusMachine";

const initial = {
  status: "empty" as const,
  sourceHash: "",
  autoText: "",
};

describe("reduceBlockState", () => {
  it("goes pending on translation start and auto on success", () => {
    const started = reduceBlockState(initial, false, {
      type: "translationStarted",
      sourceHash: "h1",
    });
    expect(started.status).toBe("pending");

    const done = reduceBlockState(started, false, {
      type: "translationSucceeded",
      sourceHash: "h1",
      autoText: "你好",
    });
    expect(done.status).toBe("auto");
    expect(done.autoText).toBe("你好");
    expect(done.humanEdited).toBe(false);
  });

  it("marks manual on human edit and never auto-writes over it", () => {
    const auto = reduceBlockState(initial, false, {
      type: "translationSucceeded",
      sourceHash: "h1",
      autoText: "你好",
    });
    const manual = reduceBlockState(auto, false, { type: "targetManuallyEdited" });
    expect(manual.status).toBe("manual");

    const afterSourceChange = reduceBlockState(manual, true, {
      type: "sourceTextChanged",
      targetMatchesAuto: false,
      sourceHash: "h2",
    });
    expect(afterSourceChange.status).toBe("stale");

    // Without an explicit retranslate confirmation the block stays stale.
    expect(
      reduceBlockState(afterSourceChange, true, {
        type: "sourceTextChanged",
        targetMatchesAuto: false,
        sourceHash: "h3",
      }).status
    ).toBe("stale");
  });

  it("re-enters the translation flow after a confirmed retranslate", () => {
    const stale = reduceBlockState(initial, false, { type: "targetManuallyEdited" });
    const pending = reduceBlockState(stale, true, {
      type: "retranslateConfirmed",
      sourceHash: "h9",
    });
    expect(pending.status).toBe("pending");
    expect(pending.humanEdited).toBe(false);
  });

  it("keeps skipped blocks untouched by source changes", () => {
    const skipped = reduceBlockState(initial, false, { type: "markedSkipped" });
    const after = reduceBlockState(skipped, false, {
      type: "sourceTextChanged",
      targetMatchesAuto: false,
      sourceHash: "h1",
    });
    expect(after.status).toBe("skipped");
  });

  it("records failure state", () => {
    const failed = reduceBlockState(initial, false, {
      type: "translationFailed",
      message: "upstream error",
    });
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("upstream error");
  });
});

describe("canAutoWrite", () => {
  const auto = {
    status: "auto" as const,
    sourceHash: "h1",
    autoText: "机器译文",
  };

  it("allows writing when the mirror text matches the auto text", () => {
    expect(canAutoWrite(auto, "机器译文")).toBe(true);
  });

  it("allows writing into an empty block", () => {
    expect(canAutoWrite(auto, "")).toBe(true);
  });

  it("refuses when a human changed the text", () => {
    expect(canAutoWrite(auto, "人工改过的内容")).toBe(false);
  });

  it("refuses manual and skipped blocks regardless of content", () => {
    expect(canAutoWrite({ ...auto, status: "manual" }, "机器译文")).toBe(false);
    expect(canAutoWrite({ ...auto, status: "skipped" }, "")).toBe(false);
  });
});
