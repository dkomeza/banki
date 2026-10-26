import { describe, expect, test } from "bun:test";
import { CardListResponse, CardResponse, DeckListResponse, DeckResponse } from "@banki/shared";
import { type App, bootApps, codeOf, get, send, setUp } from "../testing/app";

const { boot } = bootApps();

/** A fresh app that Setup is done on, the signed-in cookie, and one Deck. */
async function signedIn() {
  const booted = boot();
  const cookie = await setUp(booted);
  const deck = await createDeck(booted.app, cookie, "Spanish");
  return { app: booted.app, cookie, deckId: deck.id };
}

async function createDeck(app: App, cookie: string, name: string) {
  const res = await send(app, "POST", "/api/decks", { name }, cookie);
  if (res.status !== 201) throw new Error(`Create deck answered ${res.status}`);
  return DeckResponse.parse(await res.json());
}

async function createCard(app: App, cookie: string, deckId: string, front = "f", back = "b") {
  const res = await send(app, "POST", `/api/decks/${deckId}/cards`, { front, back }, cookie);
  if (res.status !== 201) throw new Error(`Create card answered ${res.status}`);
  return CardResponse.parse(await res.json());
}

const frontsIn = async (app: App, cookie: string, deckId: string) =>
  CardListResponse.parse(await (await get(app, `/api/decks/${deckId}/cards`, cookie)).json()).map(
    (card) => card.front,
  );

/** Each body a create or a change refuses with 400 `invalid_request`. */
const INVALID_SIDES = [
  { front: "", back: "b" },
  { front: " \n\t ", back: "b" },
  { front: "f", back: "   " },
  { front: "f".repeat(20_001), back: "b" },
  { front: "f", back: "b".repeat(20_001) },
];

describe("POST /api/decks/:deckId/cards", () => {
  test("creates a Card exactly as typed and answers it with 201", async () => {
    const { app, cookie, deckId } = await signedIn();

    const res = await send(
      app,
      "POST",
      `/api/decks/${deckId}/cards`,
      { front: "  $x^2$ \n", back: "line one\n\nline two  " },
      cookie,
    );

    expect(res.status).toBe(201);
    const created = CardResponse.parse(await res.json());
    expect(created).toMatchObject({ deckId, front: "  $x^2$ \n", back: "line one\n\nline two  " });
    expect(
      CardResponse.parse(await (await get(app, `/api/cards/${created.id}`, cookie)).json()),
    ).toEqual(created);
  });

  test("takes a side of exactly 20,000 characters", async () => {
    const { app, cookie, deckId } = await signedIn();

    const res = await send(
      app,
      "POST",
      `/api/decks/${deckId}/cards`,
      { front: "f".repeat(20_000), back: "b".repeat(20_000) },
      cookie,
    );

    expect(res.status).toBe(201);
  });

  test("answers 400 invalid_request for a blank or too long side, or a missing one", async () => {
    const { app, cookie, deckId } = await signedIn();

    for (const body of [...INVALID_SIDES, { front: "f" }, { front: "f", back: "b", extra: 1 }]) {
      const res = await send(app, "POST", `/api/decks/${deckId}/cards`, body, cookie);
      expect(res.status).toBe(400);
      expect(await codeOf(res)).toBe("invalid_request");
    }
    expect(await frontsIn(app, cookie, deckId)).toEqual([]);
  });

  test("answers 404 not_found for an unknown or deleted Deck", async () => {
    const { app, cookie, deckId } = await signedIn();
    await send(app, "DELETE", `/api/decks/${deckId}`, undefined, cookie);

    for (const id of [deckId, "nope"]) {
      const res = await send(
        app,
        "POST",
        `/api/decks/${id}/cards`,
        { front: "f", back: "b" },
        cookie,
      );
      expect(res.status).toBe(404);
      expect(await codeOf(res)).toBe("not_found");
    }
  });

  test("answers 401 when signed out", async () => {
    const { app, deckId } = await signedIn();

    const res = await send(app, "POST", `/api/decks/${deckId}/cards`, { front: "f", back: "b" });

    expect(res.status).toBe(401);
  });
});

describe("GET /api/decks/:deckId/cards", () => {
  test("lists the Deck's live Cards, newest first", async () => {
    const { app, cookie, deckId } = await signedIn();
    await createCard(app, cookie, deckId, "first");
    await Bun.sleep(2);
    const deleted = await createCard(app, cookie, deckId, "deleted");
    await Bun.sleep(2);
    await createCard(app, cookie, deckId, "second");
    await send(app, "DELETE", `/api/cards/${deleted.id}`, undefined, cookie);

    expect(await frontsIn(app, cookie, deckId)).toEqual(["second", "first"]);
  });

  test("answers 404 not_found for an unknown or deleted Deck", async () => {
    const { app, cookie, deckId } = await signedIn();
    await send(app, "DELETE", `/api/decks/${deckId}`, undefined, cookie);

    for (const id of [deckId, "nope"]) {
      const res = await get(app, `/api/decks/${id}/cards`, cookie);
      expect(res.status).toBe(404);
      expect(await codeOf(res)).toBe("not_found");
    }
  });

  test("answers 401 when signed out", async () => {
    const { app, deckId } = await signedIn();

    expect((await get(app, `/api/decks/${deckId}/cards`)).status).toBe(401);
  });
});

describe("GET /api/cards/:id", () => {
  test("answers 404 not_found for an unknown, deleted, or deleted Deck's Card", async () => {
    const { app, cookie, deckId } = await signedIn();
    const deleted = await createCard(app, cookie, deckId);
    await send(app, "DELETE", `/api/cards/${deleted.id}`, undefined, cookie);
    const otherDeck = await createDeck(app, cookie, "Kanji");
    const inDeletedDeck = await createCard(app, cookie, otherDeck.id);
    await send(app, "DELETE", `/api/decks/${otherDeck.id}`, undefined, cookie);

    for (const id of [deleted.id, inDeletedDeck.id, "nope"]) {
      const res = await get(app, `/api/cards/${id}`, cookie);
      expect(res.status).toBe(404);
      expect(await codeOf(res)).toBe("not_found");
    }
  });

  test("answers 401 when signed out", async () => {
    const { app, cookie, deckId } = await signedIn();
    const card = await createCard(app, cookie, deckId);

    expect((await get(app, `/api/cards/${card.id}`)).status).toBe(401);
  });
});

describe("PATCH /api/cards/:id", () => {
  test("changes the Front and the Back exactly as typed", async () => {
    const { app, cookie, deckId } = await signedIn();
    const card = await createCard(app, cookie, deckId, "old", "old");

    const res = await send(
      app,
      "PATCH",
      `/api/cards/${card.id}`,
      { front: " new ", back: "new\n" },
      cookie,
    );

    expect(res.status).toBe(200);
    expect(CardResponse.parse(await res.json())).toMatchObject({
      id: card.id,
      front: " new ",
      back: "new\n",
      createdAt: card.createdAt,
    });
  });

  test("changes only the side it is given", async () => {
    const { app, cookie, deckId } = await signedIn();
    const card = await createCard(app, cookie, deckId, "front", "back");

    const res = await send(app, "PATCH", `/api/cards/${card.id}`, { back: "other" }, cookie);

    expect(CardResponse.parse(await res.json())).toMatchObject({ front: "front", back: "other" });
  });

  test("answers 400 invalid_request for a blank or too long side, or nothing to change", async () => {
    const { app, cookie, deckId } = await signedIn();
    const card = await createCard(app, cookie, deckId, "front", "back");

    for (const body of [...INVALID_SIDES, {}, { deckId }]) {
      const res = await send(app, "PATCH", `/api/cards/${card.id}`, body, cookie);
      expect(res.status).toBe(400);
      expect(await codeOf(res)).toBe("invalid_request");
    }
    expect(
      CardResponse.parse(await (await get(app, `/api/cards/${card.id}`, cookie)).json()),
    ).toMatchObject({ front: "front", back: "back" });
  });

  test("answers 404 not_found for an unknown, deleted, or deleted Deck's Card", async () => {
    const { app, cookie, deckId } = await signedIn();
    const deleted = await createCard(app, cookie, deckId);
    await send(app, "DELETE", `/api/cards/${deleted.id}`, undefined, cookie);
    const otherDeck = await createDeck(app, cookie, "Kanji");
    const inDeletedDeck = await createCard(app, cookie, otherDeck.id);
    await send(app, "DELETE", `/api/decks/${otherDeck.id}`, undefined, cookie);

    for (const id of [deleted.id, inDeletedDeck.id, "nope"]) {
      const res = await send(app, "PATCH", `/api/cards/${id}`, { front: "x" }, cookie);
      expect(res.status).toBe(404);
      expect(await codeOf(res)).toBe("not_found");
    }
  });
});

describe("DELETE /api/cards/:id", () => {
  test("deletes the Card softly with 204, after which it answers 404", async () => {
    const { app, cookie, deckId } = await signedIn();
    const card = await createCard(app, cookie, deckId);

    const res = await send(app, "DELETE", `/api/cards/${card.id}`, undefined, cookie);

    expect(res.status).toBe(204);
    expect((await get(app, `/api/cards/${card.id}`, cookie)).status).toBe(404);
    expect(await frontsIn(app, cookie, deckId)).toEqual([]);
    const again = await send(app, "DELETE", `/api/cards/${card.id}`, undefined, cookie);
    expect(again.status).toBe(404);
    expect(await codeOf(again)).toBe("not_found");
  });

  test("answers 401 when signed out", async () => {
    const { app, cookie, deckId } = await signedIn();
    const card = await createCard(app, cookie, deckId);

    expect((await send(app, "DELETE", `/api/cards/${card.id}`, undefined)).status).toBe(401);
  });
});

describe("POST /api/cards/:id/restore", () => {
  test("brings a deleted Card back and answers it", async () => {
    const { app, cookie, deckId } = await signedIn();
    const card = await createCard(app, cookie, deckId, "back again");
    await send(app, "DELETE", `/api/cards/${card.id}`, undefined, cookie);

    const res = await send(app, "POST", `/api/cards/${card.id}/restore`, undefined, cookie);

    expect(res.status).toBe(200);
    expect(CardResponse.parse(await res.json())).toMatchObject({
      id: card.id,
      front: "back again",
    });
    expect(await frontsIn(app, cookie, deckId)).toEqual(["back again"]);
  });

  test("answers 404 not_found when the Deck was deleted meanwhile, or for an unknown Card", async () => {
    const { app, cookie, deckId } = await signedIn();
    const card = await createCard(app, cookie, deckId);
    await send(app, "DELETE", `/api/cards/${card.id}`, undefined, cookie);
    await send(app, "DELETE", `/api/decks/${deckId}`, undefined, cookie);

    for (const id of [card.id, "nope"]) {
      const res = await send(app, "POST", `/api/cards/${id}/restore`, undefined, cookie);
      expect(res.status).toBe(404);
      expect(await codeOf(res)).toBe("not_found");
    }
  });

  test("answers 401 when signed out", async () => {
    const { app, cookie, deckId } = await signedIn();
    const card = await createCard(app, cookie, deckId);
    await send(app, "DELETE", `/api/cards/${card.id}`, undefined, cookie);

    expect((await send(app, "POST", `/api/cards/${card.id}/restore`, undefined)).status).toBe(401);
  });
});

describe("a Deck's card count", () => {
  test("GET /api/decks/:id and the list answer the Deck's live cardCount", async () => {
    const { app, cookie, deckId } = await signedIn();
    await createCard(app, cookie, deckId);
    const deleted = await createCard(app, cookie, deckId);
    await createCard(app, cookie, deckId);
    await send(app, "DELETE", `/api/cards/${deleted.id}`, undefined, cookie);

    expect(
      DeckResponse.parse(await (await get(app, `/api/decks/${deckId}`, cookie)).json()).cardCount,
    ).toBe(2);
    expect(
      DeckListResponse.parse(await (await get(app, "/api/decks", cookie)).json()).map(
        (deck) => deck.cardCount,
      ),
    ).toEqual([2]);
  });

  test("deleting a Folder deletes the Cards of its Decks", async () => {
    const { app, cookie } = await signedIn();
    const folderRes = await send(app, "POST", "/api/folders", { name: "Maths" }, cookie);
    const folder = (await folderRes.json()) as { id: string };
    const deckRes = await send(
      app,
      "POST",
      "/api/decks",
      { name: "Calculus", folderId: folder.id },
      cookie,
    );
    const deck = DeckResponse.parse(await deckRes.json());
    const card = await createCard(app, cookie, deck.id);

    await send(app, "DELETE", `/api/folders/${folder.id}`, undefined, cookie);

    expect((await get(app, `/api/cards/${card.id}`, cookie)).status).toBe(404);
    const restore = await send(app, "POST", `/api/cards/${card.id}/restore`, undefined, cookie);
    expect(restore.status).toBe(404);
  });
});
