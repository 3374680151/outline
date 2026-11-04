import { describe, expect, it } from "vitest";
import { getAdaptor } from "./index";
import { hasVersionSegment, normalizeBaseURL } from "./base";

describe("base URL helpers", () => {
  it("normalizes trailing slashes and a single /v1 suffix", () => {
    expect(normalizeBaseURL("https://api.example.com/v1/")).toBe(
      "https://api.example.com"
    );
    expect(normalizeBaseURL("https://api.example.com/")).toBe(
      "https://api.example.com"
    );
  });

  it("detects version segments other than /v1", () => {
    expect(hasVersionSegment("https://open.bigmodel.cn/api/paas/v4")).toBe(
      true
    );
    expect(hasVersionSegment("https://api.example.com")).toBe(false);
    expect(hasVersionSegment("https://api.example.com/v1/openai")).toBe(true);
  });
});

describe("openai adaptor", () => {
  const adaptor = getAdaptor("openai");

  it("appends /v1 when the base URL has no version segment", () => {
    const built = adaptor.buildRequest("https://api.example.com", "key", {
      model: "gpt-test",
      messages: [
        {
          role: "system",
          content: "sys",
        },
        {
          role: "user",
          content: "hi",
        },
      ],
      temperature: 0.2,
      maxTokens: 100,
    });

    expect(built.url).toBe("https://api.example.com/v1/chat/completions");
    expect(built.headers.Authorization).toBe("Bearer key");

    const body = JSON.parse(built.body);
    expect(body.model).toBe("gpt-test");
    expect(body.messages).toEqual([
      {
        role: "system",
        content: "sys",
      },
      {
        role: "user",
        content: "hi",
      },
    ]);
    expect(body.max_tokens).toBe(100);
  });

  it("does not append /v1 when a version segment exists", () => {
    const built = adaptor.buildRequest(
      "https://open.bigmodel.cn/api/paas/v4",
      "key",
      {
        model: "glm",
        messages: [
          {
            role: "user",
            content: "hi",
          },
        ],
        temperature: 0.2,
        maxTokens: 0,
      }
    );

    expect(built.url).toBe(
      "https://open.bigmodel.cn/api/paas/v4/chat/completions"
    );
    expect(JSON.parse(built.body).max_tokens).toBeUndefined();
  });

  it("parses a completion response with usage", () => {
    const response = adaptor.parseResponse(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "hello",
            },
          },
        ],
        usage: {
          prompt_tokens: 3,
          completion_tokens: 2,
          total_tokens: 5,
        },
      })
    );

    expect(response.text).toBe("hello");
    expect(response.usage).toEqual({
      promptTokens: 3,
      completionTokens: 2,
      totalTokens: 5,
    });
  });

  it("parses an error body", () => {
    const err = adaptor.parseError(
      JSON.stringify({
        error: {
          message: "bad key",
        },
      }),
      401
    );

    expect(err.message).toBe("Upstream returned 401: bad key");
  });
});

describe("anthropic adaptor", () => {
  const adaptor = getAdaptor("anthropic");

  it("builds a messages request with system extracted and x-api-key", () => {
    const built = adaptor.buildRequest("https://api.anthropic.com", "key", {
      model: "claude-test",
      messages: [
        {
          role: "system",
          content: "be nice",
        },
        {
          role: "user",
          content: "hi",
        },
      ],
      temperature: 0.5,
      maxTokens: 100,
    });

    expect(built.url).toBe("https://api.anthropic.com/v1/messages");
    expect(built.headers["x-api-key"]).toBe("key");
    expect(built.headers["anthropic-version"]).toBe("2023-06-01");

    const body = JSON.parse(built.body);
    expect(body.system).toBe("be nice");
    expect(body.max_tokens).toBe(100);
    expect(body.messages).toEqual([
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "hi",
          },
        ],
      },
    ]);
  });

  it("clamps temperature into the allowed range", () => {
    const built = adaptor.buildRequest("https://api.anthropic.com", "key", {
      model: "claude-test",
      messages: [
        {
          role: "user",
          content: "hi",
        },
      ],
      temperature: 1.8,
      maxTokens: 10,
    });

    expect(JSON.parse(built.body).temperature).toBe(1);
  });

  it("joins all text blocks of the response", () => {
    const response = adaptor.parseResponse(
      JSON.stringify({
        type: "message",
        content: [
          {
            type: "text",
            text: "a",
          },
          {
            type: "text",
            text: "b",
          },
        ],
        usage: {
          input_tokens: 1,
          output_tokens: 2,
        },
      })
    );

    expect(response.text).toBe("ab");
    expect(response.usage.totalTokens).toBe(3);
  });
});

describe("gemini adaptor", () => {
  const adaptor = getAdaptor("gemini");

  it("builds a generateContent request with safety settings", () => {
    const built = adaptor.buildRequest(
      "https://generativelanguage.googleapis.com",
      "key",
      {
        model: "gemini-test",
        messages: [
          {
            role: "system",
            content: "sys",
          },
          {
            role: "user",
            content: "hi",
          },
        ],
        temperature: 0.2,
        maxTokens: 100,
      }
    );

    expect(built.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent"
    );
    expect(built.headers["x-goog-api-key"]).toBe("key");

    const body = JSON.parse(built.body);
    expect(body.system_instruction.parts[0].text).toBe("sys");
    expect(body.contents).toHaveLength(1);
    expect(body.contents[0].role).toBe("user");
    expect(body.generation_config.maxOutputTokens).toBe(100);
    expect(body.safety_settings).toHaveLength(4);
  });

  it("parses the response usage metadata", () => {
    const response = adaptor.parseResponse(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: "hey",
                },
              ],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 4,
          candidatesTokenCount: 1,
          totalTokenCount: 5,
        },
      })
    );

    expect(response.text).toBe("hey");
    expect(response.usage.totalTokens).toBe(5);
  });

  it("parses the model list and keeps generateContent models only", () => {
    const models = adaptor.parseListModelsResponse(
      JSON.stringify({
        models: [
          {
            name: "models/gemini-2.5-flash",
            supportedGenerationMethods: ["generateContent"],
          },
          {
            name: "models/text-embedding-004",
            supportedGenerationMethods: ["embedContent"],
          },
        ],
      })
    );

    expect(models).toEqual(["gemini-2.5-flash"]);
  });
});
