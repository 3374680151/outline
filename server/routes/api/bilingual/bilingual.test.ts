import type { Collection, Document, User } from "@server/models";
import {
  buildCollection,
  buildDocument,
  buildUser,
} from "@server/test/factories";
import { getTestServer } from "@server/test/support";

const server = getTestServer();

describe("#bilingual.create", () => {
  let user: User;
  let anotherUser: User;
  let collection: Collection;
  let document: Document;

  beforeEach(async () => {
    user = await buildUser();
    anotherUser = await buildUser();
    collection = await buildCollection({
      createdById: user.id,
      teamId: user.teamId,
    });
    document = await buildDocument({
      createdById: user.id,
      teamId: user.teamId,
      collectionId: collection.id,
    });
  });

  it("should require authentication", async () => {
    const res = await server.post("/api/bilingual.create", {
      body: { documentId: document.id },
    });
    expect(res.status).toEqual(401);
  });

  it("should require update access to the source document", async () => {
    const res = await server.post("/api/bilingual.create", anotherUser, {
      body: { documentId: document.id },
    });
    expect(res.status).toEqual(403);
  });

  it("should create a pair with a same-titled Chinese twin", async () => {
    const res = await server.post("/api/bilingual.create", user, {
      body: { documentId: document.id },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.pair.sourceDocumentId).toEqual(document.id);
    expect(body.data.pair.targetDocumentId).toBeTruthy();
    expect(body.data.target.title).toEqual(document.title);
    expect(body.data.target.language).toEqual("zh");
  });

  it("should create the mirror as an unattached draft", async () => {
    const res = await server.post("/api/bilingual.create", user, {
      body: { documentId: document.id },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.target.collectionId).toEqual(null);
    expect(body.data.target.publishedAt).toEqual(null);
  });

  it("should reject a document that is already paired", async () => {
    await server.post("/api/bilingual.create", user, {
      body: { documentId: document.id },
    });
    const res = await server.post("/api/bilingual.create", user, {
      body: { documentId: document.id },
    });
    expect(res.status).toEqual(400);
  });

  it("should create two documents when given only a title", async () => {
    const res = await server.post("/api/bilingual.create", user, {
      body: { title: "Product plan", collectionId: collection.id },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.source.title).toEqual("Product plan");
    expect(body.data.target.title).toEqual("Product plan");
    expect(body.data.pair.sourceDocumentId).toEqual(body.data.source.id);
    expect(body.data.pair.targetDocumentId).toEqual(body.data.target.id);
  });
});

describe("#bilingual.info", () => {
  let user: User;
  let collection: Collection;
  let document: Document;

  beforeEach(async () => {
    user = await buildUser();
    collection = await buildCollection({
      createdById: user.id,
      teamId: user.teamId,
    });
    document = await buildDocument({
      createdById: user.id,
      teamId: user.teamId,
      collectionId: collection.id,
    });
  });

  it("returns a null pair for an unpaired document", async () => {
    const res = await server.post("/api/bilingual.info", user, {
      body: { documentId: document.id },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.pair).toEqual(null);
  });

  it("returns the pair for either side", async () => {
    const created = await server.post("/api/bilingual.create", user, {
      body: { documentId: document.id },
    });
    const createdBody = await created.json();
    const targetId = createdBody.data.target.id;

    for (const id of [document.id, targetId]) {
      const res = await server.post("/api/bilingual.info", user, {
        body: { documentId: id },
      });
      const body = await res.json();

      expect(res.status).toEqual(200);
      expect(body.data.pair.sourceDocumentId).toEqual(document.id);
      expect(body.data.pair.targetDocumentId).toEqual(targetId);
    }
  });
});

describe("#bilingual.updateState", () => {
  let user: User;
  let collection: Collection;
  let document: Document;

  beforeEach(async () => {
    user = await buildUser();
    collection = await buildCollection({
      createdById: user.id,
      teamId: user.teamId,
    });
    document = await buildDocument({
      createdById: user.id,
      teamId: user.teamId,
      collectionId: collection.id,
    });
  });

  it("persists block states", async () => {
    const created = await server.post("/api/bilingual.create", user, {
      body: { documentId: document.id },
    });
    const createdBody = await created.json();
    const pairId = createdBody.data.pair.id;

    const res = await server.post("/api/bilingual.updateState", user, {
      body: {
        pairId,
        blockStates: [
          { status: "auto", sourceHash: "abc", autoText: "你好" },
          { status: "manual", sourceHash: "def", autoText: "" },
        ],
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.pair.blockStates).toHaveLength(2);
    expect(body.data.pair.blockStates[0].autoText).toEqual("你好");

    // Reload from the server to verify persistence.
    const info = await server.post("/api/bilingual.info", user, {
      body: { documentId: document.id },
    });
    const infoBody = await info.json();
    expect(infoBody.data.pair.blockStates).toHaveLength(2);
    expect(infoBody.data.pair.blockStates[1].status).toEqual("manual");
  });

  it("persists incremental block state changes", async () => {
    const created = await server.post("/api/bilingual.create", user, {
      body: { documentId: document.id },
    });
    const createdBody = await created.json();
    const pairId = createdBody.data.pair.id;

    const first = await server.post("/api/bilingual.updateState", user, {
      body: {
        pairId,
        changes: [
          { index: 1, status: "auto", sourceHash: "h1", autoText: "第一段" },
        ],
      },
    });
    expect(first.status).toEqual(200);

    const second = await server.post("/api/bilingual.updateState", user, {
      body: {
        pairId,
        changes: [
          { index: 3, status: "manual", sourceHash: "h2", autoText: "" },
        ],
      },
    });
    const body = await second.json();

    expect(second.status).toEqual(200);
    expect(body.data.pair.blockStates).toHaveLength(4);
    expect(body.data.pair.blockStates[1].autoText).toEqual("第一段");
    expect(body.data.pair.blockStates[3].status).toEqual("manual");
    expect(body.data.pair.blockStates[0].status).toEqual("empty");
  });
});

describe("#bilingual.list", () => {
  let user: User;
  let collection: Collection;
  let document: Document;

  beforeEach(async () => {
    user = await buildUser();
    collection = await buildCollection({
      createdById: user.id,
      teamId: user.teamId,
    });
    document = await buildDocument({
      createdById: user.id,
      teamId: user.teamId,
      collectionId: collection.id,
    });
  });

  it("lists pairs of the team with titles", async () => {
    await server.post("/api/bilingual.create", user, {
      body: { documentId: document.id },
    });
    const res = await server.post("/api/bilingual.list", user, { body: {} });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.pairs).toHaveLength(1);
    expect(body.data.pairs[0].sourceTitle).toEqual(document.title);
  });
});

describe("#bilingual.saveMerged", () => {
  let user: User;
  let collection: Collection;
  let document: Document;

  beforeEach(async () => {
    user = await buildUser();
    collection = await buildCollection({
      createdById: user.id,
      teamId: user.teamId,
    });
    document = await buildDocument({
      createdById: user.id,
      teamId: user.teamId,
      collectionId: collection.id,
      text: "First paragraph\n\nSecond paragraph",
    });
  });

  it("creates one merged document with interleaved translations", async () => {
    const created = await server.post("/api/bilingual.create", user, {
      body: { documentId: document.id },
    });
    const createdBody = await created.json();
    const pairId = createdBody.data.pair.id;
    const targetId = createdBody.data.target.id;

    // Write translated content into the mirror document.
    const updated = await server.post("/api/documents.update", user, {
      body: {
        id: targetId,
        text: "第一段\n\n第二段",
      },
    });
    expect(updated.status).toEqual(200);

    const res = await server.post("/api/bilingual.saveMerged", user, {
      body: { pairId, title: "Merged" },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.document.title).toEqual("Merged");

    // The markdown of the merged document interleaves source paragraphs
    // with their translations as quotes.
    const text = body.data.document.text as string;
    expect(text).toContain("First paragraph");
    expect(text).toContain("> 第一段");
    expect(text).toContain("Second paragraph");
    expect(text).toContain("> 第二段");
  });
});

describe("document deletion cascades to the pair", () => {
  let user: User;
  let collection: Collection;
  let document: Document;

  beforeEach(async () => {
    user = await buildUser();
    collection = await buildCollection({
      createdById: user.id,
      teamId: user.teamId,
    });
    document = await buildDocument({
      createdById: user.id,
      teamId: user.teamId,
      collectionId: collection.id,
    });
  });

  it("deletes the mirror document and the pair with the source", async () => {
    const created = await server.post("/api/bilingual.create", user, {
      body: { documentId: document.id },
    });
    const createdBody = await created.json();
    const targetId = createdBody.data.target.id;

    const deleted = await server.post("/api/documents.delete", user, {
      body: { id: document.id },
    });
    expect(deleted.status).toEqual(200);

    const info = await server.post("/api/bilingual.info", user, {
      body: { documentId: targetId },
    });
    expect(info.status).toEqual(404);
  });
});
