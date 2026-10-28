import { describe, expect, test } from "bun:test";
import { CardResponse, DeckResponse, DeleteResponse, TagListResponse } from "@banki/shared";
import { type App, bootApps, codeOf, get, send, setUp } from "../testing/app";

const { boot } = bootApps();

/** A fresh app that Setup is done on, the signed-in cookie, and one Deck. */
async function signedIn() {
  const booted = boot();
  const cookie = await setUp(booted);
  const deckId = await createDeck(booted.app, cookie, "Spanish");
  return { app: booted.app, cookie, deckId };
}

async function createDeck(app: App, cookie: string, name: string) {
  const res = await send(app, "POST", "/api/decks", { name }, cookie);
  if (res.status !== 201) throw new Error(`Create deck answered ${res.status}`);
  return DeckResponse.parse(await res.json()).id;
}

const post = (app: App, cookie: string, deckId: string, body: unknown) =>
  send(app, "POST", `/api/decks/${deckId}/cards`, body, cookie);

async function createCard(app: App, cookie: string, deckId: string, tags: string[]) {
  const res = await post(app, cookie, deckId, { front: "f", back: "b", tags });
  if (res.status !== 201) throw new Error(`Create card answered ${res.status}`);
  return CardResponse.parse(await res.json());
}

const tagsOf = async (app: App, cookie: string) =>
  TagListResponse.parse(await (await get(app, "/api/tags", cookie)).json());

/** Each list of Tags a create or a change refuses with 400 `invalid_request`. */
const INVALID_TAGS = [
  ["two words"],
  ["verb,"],
  ["taylor's"],
  [""],
  ["a".repeat(51)],
  Array.from({ length: 21 }, (_, i) => `t${i}`),
  "verb",
  [1],
];

describe("a Card's Tags", () => {
  test("a create lowercases them, drops duplicates and answers them A–Z", async () => {
    const { app, cookie, deckId } = await signedIn();

    const res = await post(app, cookie, deckId, {
      front: "f",
      back: "b",
      tags: ["Verb", "irregular", "VERB", "動詞"],
    });

    expect(res.status).toBe(201);
    const created = CardResponse.parse(await res.json());
    expect(created.tags).toEqual(["irregular", "verb", "動詞"]);
    const found = CardResponse.parse(
      await (await get(app, `/api/cards/${created.id}`, cookie)).json(),
    );
    expect(found.tags).toEqual(["irregular", "verb", "動詞"]);
    const listed = await (await get(app, `/api/decks/${deckId}/cards`, cookie)).json();
    expect(listed).toEqual([created]);
  });

  test("a create without Tags makes a Card with none", async () => {
    const { app, cookie, deckId } = await signedIn();
    const res = await post(app, cookie, deckId, { front: "f", back: "b" });
    expect(CardResponse.parse(await res.json()).tags).toEqual([]);
  });

  test("a create takes 20 Tags of 50 characters", async () => {
    const { app, cookie, deckId } = await signedIn();
    const tags = Array.from({ length: 20 }, (_, i) => `${i}`.padEnd(50, "x"));
    expect((await post(app, cookie, deckId, { front: "f", back: "b", tags })).status).toBe(201);
  });

  test("a create answers 400 invalid_request for a Tag breaking the rules, or 21", async () => {
    const { app, cookie, deckId } = await signedIn();

    for (const tags of INVALID_TAGS) {
      const res = await post(app, cookie, deckId, { front: "f", back: "b", tags });
      expect(res.status).toBe(400);
      expect(await codeOf(res)).toBe("invalid_request");
    }
    expect(await tagsOf(app, cookie)).toEqual([]);
  });

  test("a PATCH may carry only Tags, which replace the Card's", async () => {
    const { app, cookie, deckId } = await signedIn();
    const created = await createCard(app, cookie, deckId, ["verb", "b1"]);

    const res = await send(
      app,
      "PATCH",
      `/api/cards/${created.id}`,
      { tags: ["Exam", "verb"] },
      cookie,
    );

    expect(res.status).toBe(200);
    expect(CardResponse.parse(await res.json())).toMatchObject({
      front: "f",
      back: "b",
      tags: ["exam", "verb"],
    });
  });

  test("a PATCH without Tags keeps them", async () => {
    const { app, cookie, deckId } = await signedIn();
    const created = await createCard(app, cookie, deckId, ["verb"]);

    const res = await send(app, "PATCH", `/api/cards/${created.id}`, { front: "g" }, cookie);

    expect(CardResponse.parse(await res.json()).tags).toEqual(["verb"]);
  });

  test("a PATCH answers 400 invalid_request for a Tag breaking the rules, or 21", async () => {
    const { app, cookie, deckId } = await signedIn();
    const created = await createCard(app, cookie, deckId, ["verb"]);

    for (const tags of INVALID_TAGS) {
      const res = await send(app, "PATCH", `/api/cards/${created.id}`, { tags }, cookie);
      expect(res.status).toBe(400);
      expect(await codeOf(res)).toBe("invalid_request");
    }
    expect(await tagsOf(app, cookie)).toEqual(["verb"]);
  });
});

describe("GET /api/tags", () => {
  test("answers the Tags of every live Card in every live Deck, once each, A–Z", async () => {
    const { app, cookie, deckId } = await signedIn();
    const calculus = await createDeck(app, cookie, "Calculus");
    await createCard(app, cookie, deckId, ["verb", "exam"]);
    await createCard(app, cookie, deckId, ["noun"]);
    await createCard(app, cookie, calculus, ["series", "exam"]);

    expect(await tagsOf(app, cookie)).toEqual(["exam", "noun", "series", "verb"]);
  });

  test("leaves out a deleted Card's Tags, and has them back on Undo", async () => {
    const { app, cookie, deckId } = await signedIn();
    await createCard(app, cookie, deckId, ["verb"]);
    const deleted = await createCard(app, cookie, deckId, ["noun", "verb"]);

    const res = await send(app, "DELETE", `/api/cards/${deleted.id}`, undefined, cookie);
    const { deletionId } = DeleteResponse.parse(await res.json());
    expect(await tagsOf(app, cookie)).toEqual(["verb"]);

    await send(app, "POST", `/api/deletions/${deletionId}/restore`, undefined, cookie);
    expect(await tagsOf(app, cookie)).toEqual(["noun", "verb"]);
    const found = CardResponse.parse(
      await (await get(app, `/api/cards/${deleted.id}`, cookie)).json(),
    );
    expect(found.tags).toEqual(["noun", "verb"]);
  });

  test("leaves out the Tags of a deleted Deck's Cards", async () => {
    const { app, cookie, deckId } = await signedIn();
    await createCard(app, cookie, deckId, ["verb"]);

    await send(app, "DELETE", `/api/decks/${deckId}`, undefined, cookie);

    expect(await tagsOf(app, cookie)).toEqual([]);
  });

  test("answers 401 when signed out", async () => {
    const { app } = await signedIn();
    expect((await get(app, "/api/tags")).status).toBe(401);
  });
});
