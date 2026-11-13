import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import {
  CardHistoryResponse,
  CardResponse,
  DeckResponse,
  RateCardResponse,
  type ReviewRequest,
} from "@banki/shared";
import { sql } from "drizzle-orm";
import { openDatabase } from "../db/database";
import { createCardRepository } from "../repositories/cards";
import { createDeckRepository } from "../repositories/decks";
import { resetProgress } from "../repositories/progress-resets";
import { createReviewRepository } from "../repositories/reviews";
import { type App, bootApps, codeOf, get, send, setUp } from "../testing/app";

// A Card's history (CONTEXT.md: Review): `GET /api/cards/:id/history`, its
// Reviews and Progress resets newest first in the Write order (ADR-0026).

const { boot, dataDir } = bootApps();

/** A fresh app that Setup is done on, the signed-in cookie, and one Deck with one Card. */
async function signedIn() {
  const booted = boot();
  const cookie = await setUp(booted);
  const deck = await createDeck(booted.app, cookie, "Spanish");
  const card = await createCard(booted.app, cookie, deck.id);
  return { app: booted.app, cookie, deckId: deck.id, cardId: card.id };
}

async function createDeck(app: App, cookie: string, name: string) {
  const res = await send(app, "POST", "/api/decks", { name }, cookie);
  if (res.status !== 201) throw new Error(`Create deck answered ${res.status}`);
  return DeckResponse.parse(await res.json());
}

async function createCard(app: App, cookie: string, deckId: string) {
  const res = await send(
    app,
    "POST",
    `/api/decks/${deckId}/cards`,
    { front: "f", back: "b" },
    cookie,
  );
  if (res.status !== 201) throw new Error(`Create card answered ${res.status}`);
  return CardResponse.parse(await res.json());
}

const rate = async (
  app: App,
  cookie: string,
  cardId: string,
  body: ReviewRequest = { rating: "good", durationMs: 1000 },
) => {
  const res = await send(app, "POST", `/api/cards/${cardId}/reviews`, body, cookie);
  if (res.status !== 201) throw new Error(`Rate answered ${res.status}`);
  return RateCardResponse.parse(await res.json()).review;
};

async function resetProgressOf(app: App, cookie: string, cardId: string) {
  const res = await send(app, "PATCH", `/api/cards/${cardId}`, { resetProgress: true }, cookie);
  if (res.status !== 200) throw new Error(`Reset answered ${res.status}`);
}

const historyRes = (app: App, cookie: string, cardId: string) =>
  get(app, `/api/cards/${cardId}/history`, cookie);

async function history(app: App, cookie: string, cardId: string) {
  const res = await historyRes(app, cookie, cardId);
  expect(res.status).toBe(200);
  return CardHistoryResponse.parse(await res.json()).entries;
}

/** Works on the database straight, as the routes leave it. */
function inDatabase<T>(read: (db: ReturnType<typeof openDatabase>["db"]) => T): T {
  const opened = openDatabase(dataDir());
  try {
    return read(opened.db);
  } finally {
    opened.close();
  }
}

/** The Progress resets of the Card, as stored, oldest first. */
const resetsOf = (cardId: string) =>
  inDatabase((db) =>
    db.all<{ id: string; reset_at: number }>(
      sql`SELECT id, reset_at FROM progress_reset WHERE card_id = ${cardId} ORDER BY seq`,
    ),
  );

/** Another User's Card, made straight in the database with a Review and a Progress reset; answers its ID. */
function othersCard() {
  return inDatabase((db) => {
    db.run(
      sql`INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('other', 'n', 'o@x.y', 1, 0, 0)`,
    );
    const deck = createDeckRepository(db).create("other", {
      name: "Theirs",
      description: null,
      folderId: null,
    });
    if (typeof deck === "string") throw new Error(`Their deck: ${deck}`);
    const card = createCardRepository(db).create("other", deck.id, { front: "f", back: "b" });
    if (typeof card === "string" || "deckFull" in card)
      throw new Error(`Their card: ${JSON.stringify(card)}`);
    createReviewRepository(db).rate("other", card.id, { rating: "good", durationMs: 1 });
    resetProgress(db, "other", card.id, new Date());
    return card.id;
  });
}

afterEach(() => setSystemTime());

describe("GET /api/cards/:id/history", () => {
  test("answers a Card with no Reviews and no Progress resets with no entries", async () => {
    const { app, cookie, cardId } = await signedIn();

    expect(await history(app, cookie, cardId)).toEqual([]);
  });

  test("answers Reviews of both kinds and a Progress reset between them, newest first, with their fields", async () => {
    const { app, cookie, deckId, cardId } = await signedIn();
    setSystemTime(new Date("2026-05-01T10:00:00.000Z"));
    const selfRated = await rate(app, cookie, cardId, { rating: "easy", durationMs: 4000 });
    setSystemTime(new Date("2026-05-02T10:00:00.000Z"));
    await resetProgressOf(app, cookie, cardId);
    setSystemTime(new Date("2026-05-03T10:00:00.000Z"));
    const graded = await rate(app, cookie, cardId, {
      rating: "again",
      durationMs: 120_000,
      suggestedRating: "hard",
      model: "anthropic/claude-haiku-5.5",
    });

    const entries = await history(app, cookie, cardId);

    const [reset] = resetsOf(cardId);
    expect(entries).toEqual([
      {
        type: "review",
        id: graded.id,
        cardId,
        deckId,
        reviewedAt: "2026-05-03T10:00:00.000Z",
        rating: "again",
        kind: "graded",
        suggestedRating: "hard",
        model: "anthropic/claude-haiku-5.5",
        durationMs: 120_000,
      },
      { type: "progress-reset", id: reset?.id ?? "", resetAt: "2026-05-02T10:00:00.000Z" },
      {
        type: "review",
        id: selfRated.id,
        cardId,
        deckId,
        reviewedAt: "2026-05-01T10:00:00.000Z",
        rating: "easy",
        kind: "self-rated",
        suggestedRating: null,
        model: null,
        durationMs: 4000,
      },
    ]);
  });

  test("follows the Write order, not the moments, when the clock steps back across a Progress reset", async () => {
    const { app, cookie, cardId } = await signedIn();
    setSystemTime(new Date("2026-05-03T10:00:00.000Z"));
    const first = await rate(app, cookie, cardId);
    setSystemTime(new Date("2026-05-02T10:00:00.000Z"));
    await resetProgressOf(app, cookie, cardId);
    setSystemTime(new Date("2026-05-01T10:00:00.000Z"));
    const after = await rate(app, cookie, cardId);

    const entries = await history(app, cookie, cardId);

    const [reset = ""] = resetsOf(cardId).map((r) => r.id);
    expect(entries.map((e) => [e.type, e.id])).toEqual([
      ["review", after.id],
      ["progress-reset", reset],
      ["review", first.id],
    ]);
  });

  test("keeps every Progress reset in its place, and the Reviews before each", async () => {
    const { app, cookie, cardId } = await signedIn();
    const first = await rate(app, cookie, cardId);
    await resetProgressOf(app, cookie, cardId);
    const second = await rate(app, cookie, cardId);
    await resetProgressOf(app, cookie, cardId);

    const entries = await history(app, cookie, cardId);

    const [older = "", newer = ""] = resetsOf(cardId).map((r) => r.id);
    expect(entries.map((e) => e.id)).toEqual([newer, second.id, older, first.id]);
  });

  test("lists the Reviews given in another Deck before a Move", async () => {
    const { app, cookie, cardId } = await signedIn();
    const before = await rate(app, cookie, cardId);
    const other = await createDeck(app, cookie, "Verbs");
    const moved = await send(
      app,
      "POST",
      "/api/cards/move",
      { cardIds: [cardId], deckId: other.id },
      cookie,
    );
    expect(moved.status).toBe(200);
    const after = await rate(app, cookie, cardId);

    const entries = await history(app, cookie, cardId);

    expect(entries.map((e) => e.id)).toEqual([after.id, before.id]);
    // A Review follows its Card to the new Deck (ADR-0021).
    expect(entries.map((e) => (e.type === "review" ? e.deckId : null))).toEqual([
      other.id,
      other.id,
    ]);
  });

  test("leaves out an undone Review", async () => {
    const { app, cookie, cardId } = await signedIn();
    const kept = await rate(app, cookie, cardId);
    const undone = await rate(app, cookie, cardId, { rating: "again", durationMs: 1 });
    const res = await send(app, "DELETE", `/api/reviews/${undone.id}`, undefined, cookie);
    expect(res.status).toBe(200);

    const entries = await history(app, cookie, cardId);

    expect(entries.map((e) => e.id)).toEqual([kept.id]);
  });

  test("leaves out the entries of the User's other Cards", async () => {
    const { app, cookie, deckId, cardId } = await signedIn();
    const mine = await rate(app, cookie, cardId);
    const other = await createCard(app, cookie, deckId);
    await rate(app, cookie, other.id);
    await resetProgressOf(app, cookie, other.id);

    expect((await history(app, cookie, cardId)).map((e) => e.id)).toEqual([mine.id]);
  });

  test("leaves out another User's entries, even ones naming the Card", async () => {
    const { app, cookie, deckId, cardId } = await signedIn();
    const mine = await rate(app, cookie, cardId);
    othersCard();
    inDatabase((db) => {
      db.run(
        sql`INSERT INTO progress_reset (id, user_id, card_id, reset_at, seq) VALUES ('their-reset', 'other', ${cardId}, 0, 100)`,
      );
      db.run(
        sql`INSERT INTO review (id, user_id, card_id, deck_id, reviewed_at, rating, kind, duration_ms, card_before, seq) VALUES ('their-review', 'other', ${cardId}, ${deckId}, 0, 'good', 'self-rated', 1, '{}', 101)`,
      );
    });

    expect((await history(app, cookie, cardId)).map((e) => e.id)).toEqual([mine.id]);
  });

  test("answers 404 not_found for an unknown Card, another User's, a deleted one, or one in a deleted Deck", async () => {
    const { app, cookie, deckId, cardId } = await signedIn();
    const theirs = othersCard();
    const other = await createDeck(app, cookie, "Verbs");
    const inDeleted = await createCard(app, cookie, other.id);
    await rate(app, cookie, inDeleted.id);
    await send(app, "DELETE", `/api/decks/${other.id}`, undefined, cookie);
    const deleted = await createCard(app, cookie, deckId);
    await rate(app, cookie, deleted.id);
    await send(app, "DELETE", `/api/cards/${deleted.id}`, undefined, cookie);

    for (const id of ["missing", theirs, deleted.id, inDeleted.id]) {
      const res = await historyRes(app, cookie, id);
      expect(res.status).toBe(404);
      expect(await codeOf(res)).toBe("not_found");
    }
    expect((await historyRes(app, cookie, cardId)).status).toBe(200);
  });

  test("answers 401 when signed out", async () => {
    const { app, cardId } = await signedIn();

    expect((await historyRes(app, "", cardId)).status).toBe(401);
  });
});
