import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@server/models";
import { Team } from "@server/models";
import { buildAdmin, buildUser } from "@server/test/factories";
import { getTestServer } from "@server/test/support";

const server = getTestServer();

describe("#translations.updateConfig", () => {
  let admin: User;
  let user: User;

  beforeEach(async () => {
    admin = await buildAdmin();
    user = await buildUser({ teamId: admin.teamId });
  });

  it("should fail with status 403 for non-admin members", async () => {
    const res = await server.post("/api/translations.updateConfig", user, {
      body: {
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        targetLanguage: "zh-CN",
        apiKey: "sk-test-key",
      },
    });
    expect(res.status).toEqual(403);
  });

  it("should save the config and never return the api key", async () => {
    const res = await server.post("/api/translations.updateConfig", admin, {
      body: {
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        targetLanguage: "zh-CN",
        apiKey: "sk-test-key",
      },
    });
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.translation).toEqual({
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      targetLanguage: "zh-CN",
      configured: true,
    });
    expect(JSON.stringify(body)).not.toContain("sk-test-key");

    const team = await Team.findByPk(admin.teamId);
    expect(team?.translationSettings?.model).toEqual("gpt-4o-mini");
  });

  it("should keep the existing api key when none is provided", async () => {
    await server.post("/api/translations.updateConfig", admin, {
      body: {
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        targetLanguage: "zh-CN",
        apiKey: "sk-test-key",
      },
    });
    const res = await server.post("/api/translations.updateConfig", admin, {
      body: {
        baseUrl: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
        targetLanguage: "zh-CN",
      },
    });
    expect(res.status).toEqual(200);

    const team = await Team.findByPk(admin.teamId);
    expect(team?.getTranslationConfig()).toEqual({
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      targetLanguage: "zh-CN",
      apiKey: "sk-test-key",
    });
  });
});

describe("#translations.translate", () => {
  let admin: User;
  let user: User;
  const fetchMock = vi.fn();

  beforeEach(async () => {
    admin = await buildAdmin();
    user = await buildUser({ teamId: admin.teamId });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    vi.restoreAllMocks();
  });

  it("should translate using the built-in free provider when no llm is configured", async () => {
    // Pin the pool selection to the first (highest weighted) provider.
    vi.spyOn(Math, "random").mockReturnValue(0);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify([{ translations: [{ text: "你好，世界" }] }]),
        { status: 200 }
      )
    );

    const res = await server.post("/api/translations.translate", user, {
      body: { text: "Hello world" },
    });
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.text).toEqual("你好，世界");
    expect(body.data.engine).toEqual("microsoft");
    expect(JSON.stringify(fetchMock.mock.calls[0][0])).toContain(
      "edge.microsoft.com"
    );
  });

  it("should translate text through the configured service", async () => {
    await server.post("/api/translations.updateConfig", admin, {
      body: {
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        targetLanguage: "zh-CN",
        apiKey: "sk-test-key",
      },
    });

    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "你好，世界" } }],
        }),
        { status: 200 }
      )
    );

    const res = await server.post("/api/translations.translate", user, {
      body: { text: "Hello world" },
    });
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.text).toEqual("你好，世界");
    expect(body.data.engine).toEqual("llm");

    const [endpoint, init] = fetchMock.mock.calls[0];
    expect(endpoint).toEqual("https://api.openai.com/v1/chat/completions");
    expect(init.headers.Authorization).toEqual("Bearer sk-test-key");
    expect(JSON.parse(init.body).model).toEqual("gpt-4o-mini");
  });

  it("should fail with status 400 when the upstream service errors", async () => {
    await server.post("/api/translations.updateConfig", admin, {
      body: {
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        targetLanguage: "zh-CN",
        apiKey: "sk-test-key",
      },
    });

    fetchMock.mockResolvedValue(new Response("rate limited", { status: 429 }));

    const res = await server.post("/api/translations.translate", user, {
      body: { text: "Hello world" },
    });
    expect(res.status).toEqual(400);
  });

  it("should fail with status 400 when the text is too long", async () => {
    const res = await server.post("/api/translations.translate", user, {
      body: { text: "a".repeat(5001) },
    });
    expect(res.status).toEqual(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
