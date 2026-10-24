import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetFreeTranslationPool, translateFree } from "./pool";

const fetchMock = vi.fn();
const randomMock = vi.spyOn(Math, "random");

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  // Selecting the first ready provider deterministically keeps the fallback
  // order assertions stable: microsoft, google, transmart, volcengine,
  // alibaba, youdao, bilibili, mymemory.
  randomMock.mockReturnValue(0);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  randomMock.mockReturnValue(0.5);
  resetFreeTranslationPool();
});

function microsoftResponse(text: string): Response {
  return new Response(JSON.stringify([{ translations: [{ text }] }]), {
    status: 200,
  });
}

function googleHtmlResponse(text: string): Response {
  return new Response(JSON.stringify([[`<pre>${text}</pre>`]]), {
    status: 200,
  });
}

function bilibiliResponse(content: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
    }),
    {
      status: 200,
    }
  );
}

describe("#translateFree", () => {
  it("should translate via microsoft and escape html markup", async () => {
    // The endpoint re-encodes entity literals, so the response keeps the
    // original "&amp;" literal of the source text.
    fetchMock.mockResolvedValue(microsoftResponse("你好 &amp;amp; 世界"));

    const result = await translateFree(
      "Hello &amp; <b>world</b>",
      "auto",
      "zh-CN"
    );

    expect(result).toEqual({
      text: "你好 &amp; 世界",
      engine: "microsoft",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(
      "https://edge.microsoft.com/translate/translatetext"
    );
    expect(String(url)).toContain("isEnterpriseClient=false");
    expect(init.body).toEqual(
      JSON.stringify(["Hello &amp;amp; &lt;b&gt;world&lt;/b&gt;"])
    );
  });

  it("should fall back to google when microsoft fails", async () => {
    fetchMock.mockImplementation(async (url: URL | string) => {
      if (String(url).includes("edge.microsoft.com")) {
        return new Response("unavailable", { status: 503 });
      }
      return googleHtmlResponse("你好，世界");
    });

    const result = await translateFree("Hello world", "auto", "zh-CN");

    expect(result).toEqual({
      text: "你好，世界",
      engine: "google",
    });
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      "translate-pa.googleapis.com/v1/translateHtml"
    );

    const [, init] = fetchMock.mock.calls[1];
    expect(init.headers["X-Goog-API-Key"]).toContain("AIzaSy");
  });

  it("should walk the pool down to bilibili and strip thinking blocks", async () => {
    fetchMock.mockImplementation(async (url: URL | string) => {
      if (String(url).includes("index-translate.bilibili.com")) {
        return bilibiliResponse("<think>reasoning</think>你好，世界");
      }
      return new Response("unavailable", { status: 503 });
    });

    const result = await translateFree("Hello world", "auto", "zh-CN");

    expect(result.text).toEqual("你好，世界");
    expect(result.engine).toEqual("bilibili");
    // Google alone makes two calls: translateHtml then the gtx fallback.
    expect(fetchMock).toHaveBeenCalledTimes(8);
  });

  it("should skip a provider that is cooling down", async () => {
    fetchMock.mockImplementation(async (url: URL | string) => {
      if (String(url).includes("edge.microsoft.com")) {
        return new Response("unavailable", { status: 503 });
      }
      return googleHtmlResponse("你好，世界");
    });
    await translateFree("Hello world", "auto", "zh-CN");

    fetchMock.mockClear();
    fetchMock.mockImplementation(async (url: URL | string) => {
      if (String(url).includes("edge.microsoft.com")) {
        return microsoftResponse("你好");
      }
      return googleHtmlResponse("你好，世界");
    });

    const result = await translateFree("Hello again", "auto", "zh-CN");

    expect(result.engine).toEqual("google");
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes("edge.microsoft.com")
      )
    ).toBe(false);
  });

  it("should throw a validation error when every provider fails", async () => {
    fetchMock.mockResolvedValue(new Response("down", { status: 500 }));

    await expect(translateFree("Hello world", "auto", "zh-CN")).rejects.toThrow(
      "temporarily unavailable"
    );
    // Eight providers, plus Google's second endpoint attempt.
    expect(fetchMock).toHaveBeenCalledTimes(9);
  });

  it("should bench mymemory for the day when its quota is exhausted", async () => {
    fetchMock.mockImplementation(async (url: URL | string) => {
      if (String(url).includes("api.mymemory.translated.net")) {
        return new Response(
          JSON.stringify({ responseStatus: "200", quotaFinished: true }),
          { status: 200 }
        );
      }
      return new Response("unavailable", { status: 503 });
    });

    await expect(translateFree("Hello world", "auto", "zh-CN")).rejects.toThrow(
      "temporarily unavailable"
    );

    fetchMock.mockClear();
    await expect(translateFree("Hello again", "auto", "zh-CN")).rejects.toThrow(
      "temporarily unavailable"
    );
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes("api.mymemory.translated.net")
      )
    ).toBe(false);
  });
});
