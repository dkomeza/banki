import { describe, expect, test } from "bun:test";
import { CardResponse, DeckResponse, StudyNextResponse } from "@banki/shared";
import { sql } from "drizzle-orm";
import { openDatabase } from "../db/database";
import { createDeckRepository } from "../repositories/decks";
import { type App, bootApps, codeOf, get, send, setUp } from "../testing/app";

const { boot, dataDir } = bootApps();

/** Makes another User, straight in the database, with a Deck of their own; answers its ID. */
function othersDeck() {
  const opened = openDatabase(dataDir());
  try {
    opened.db.run(
      sql`INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('other', 'n', 'o@x.y', 1, 0, 0)`,
    );
    const created = createDeckRepository(opened.db).create("other", {
      name: "Theirs",
      description: null,
      folderId: null,
    });
    if (typeof created === "string") throw new Error(`Their deck: ${created}`);
    return created.id;
  } finally {
    opened.close();
  }
}

/** A fresh app that Setup is done on, the signed-in cookie, and one empty Deck. */
async function signedIn() {
  const booted = boot();
  const cookie = await setUp(booted);
  const deck = await createDeck(booted.app, cookie, "Spanish");
  return { booted, app: booted.app, cookie, deckId: deck.id };
}

async function createDeck(app: App, cookie: string, name: string) {
  const res = await send(app, "POST", "/api/decks", { name }, cookie);
  if (res.status !== 201) throw new Error(`Create deck answered ${res.status}`);
  return DeckResponse.parse(await res.json());
}

async function createCard(app: App, cookie: string, deckId: string, front = "f") {
  const res = await send(app, "POST", `/api/decks/${deckId}/cards`, { front, back: "b" }, cookie);
  if (res.status !== 201) throw new Error(`Create card answered ${res.status}`);
  return CardResponse.parse(await res.json());
}

const rate = async (app: App, cookie: string, cardId: string, rating: string) => {
  const res = await send(
    app,
    "POST",
    `/api/cards/${cardId}/reviews`,
    { rating, durationMs: 0 },
    cookie,
  );
  if (res.status !== 201) throw new Error(`Rate answered ${res.status}`);
};

const nextOf = async (app: App, cookie: string, deckId: string, query = "") => {
  const res = await get(app, `/api/decks/${deckId}/study/next${query}`, cookie);
  expect(res.status).toBe(200);
  return StudyNextResponse.parse(await res.json()).next;
};

describe("GET /api/decks/:deckId/study/next", () => {
  test("answers the next Card, its schedule and its kind", async () => {
    const { app, cookie, deckId } = await signedIn();
    const card = await createCard(app, cookie, deckId);

    const next = await nextOf(app, cookie, deckId);

    expect(next).toEqual({
      card,
      schedule: {
        state: "new",
        due: null,
        stability: 0,
        difficulty: 0,
        reps: 0,
        lapses: 0,
        scheduledDays: 0,
        lastReview: null,
      },
      kind: "new",
    });
  });

  test("answers next: null for an empty Deck", async () => {
    const { app, cookie, deckId } = await signedIn();

    expect(await nextOf(app, cookie, deckId)).toBeNull();
  });

  test("answers a learning Card, with kind learning, once nothing else is left", async () => {
    const { app, cookie, deckId } = await signedIn();
    const card = await createCard(app, cookie, deckId);
    await rate(app, cookie, card.id, "again");

    const next = await nextOf(app, cookie, deckId, `?newShown=1&after=${card.id}`);

    expect(next?.kind).toBe("learning");
    expect(next?.card.id).toBe(card.id);
    expect(next?.schedule.state).toBe("learning");
  });

  test("takes an empty `after` as none", async () => {
    const { app, cookie, deckId } = await signedIn();
    const card = await createCard(app, cookie, deckId);

    expect((await nextOf(app, cookie, deckId, "?after="))?.card.id).toBe(card.id);
  });

  test("never answers the Card just shown while another is left", async () => {
    const { app, cookie, deckId } = await signedIn();
    const first = await createCard(app, cookie, deckId, "first");
    const second = await createCard(app, cookie, deckId, "second");
    await rate(app, cookie, first.id, "again");

    const next = await nextOf(app, cookie, deckId, `?newShown=1&after=${first.id}`);

    expect(next?.card.id).toBe(second.id);
    expect(next?.kind).toBe("new");
  });

  test("takes its positions from the counters, 0 when left out", async () => {
    const { app, cookie, deckId } = await signedIn();
    // Two new Cards, oldest first; no reviews, so the counters only say how many are left.
    const first = await createCard(app, cookie, deckId, "first");
    await createCard(app, cookie, deckId, "second");

    expect((await nextOf(app, cookie, deckId))?.card.id).toBe(first.id);
    expect((await nextOf(app, cookie, deckId, "?reviewsShown=0&newShown=0"))?.card.id).toBe(
      first.id,
    );
    expect((await nextOf(app, cookie, deckId, "?reviewsShown=3&newShown=2"))?.card.id).toBe(
      first.id,
    );
  });

  test("answers 400 invalid_request for a counter that isn't a whole number from 0", async () => {
    const { app, cookie, deckId } = await signedIn();

    for (const query of [
      "?reviewsShown=-1",
      "?reviewsShown=1.5",
      "?reviewsShown=",
      "?newShown=abc",
      "?newShown=1e2",
      "?newShown=1&newShown=2",
    ]) {
      const res = await get(app, `/api/decks/${deckId}/study/next${query}`, cookie);
      expect(res.status).toBe(400);
      expect(await codeOf(res)).toBe("invalid_request");
    }
  });

  test("leaves out deleted Cards", async () => {
    const { app, cookie, deckId } = await signedIn();
    const gone = await createCard(app, cookie, deckId, "gone");
    const kept = await createCard(app, cookie, deckId, "kept");
    await send(app, "DELETE", `/api/cards/${gone.id}`, undefined, cookie);

    expect((await nextOf(app, cookie, deckId))?.card.id).toBe(kept.id);
    await send(app, "DELETE", `/api/cards/${kept.id}`, undefined, cookie);
    expect(await nextOf(app, cookie, deckId)).toBeNull();
  });

  test("answers 404 not_found for a deleted, missing or other User's Deck", async () => {
    const { app, cookie, deckId } = await signedIn();
    await createCard(app, cookie, deckId);
    await send(app, "DELETE", `/api/decks/${deckId}`, undefined, cookie);
    const theirs = othersDeck();

    for (const id of [deckId, "missing", theirs]) {
      const res = await get(app, `/api/decks/${id}/study/next`, cookie);
      expect(res.status).toBe(404);
      expect(await codeOf(res)).toBe("not_found");
    }
  });

  test("answers 401 when signed out", async () => {
    const { app, deckId } = await signedIn();

    const res = await get(app, `/api/decks/${deckId}/study/next`);

    expect(res.status).toBe(401);
  });
});
