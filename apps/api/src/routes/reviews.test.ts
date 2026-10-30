import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import {
  CardResponse,
  DeckResponse,
  RateCardResponse,
  SettingsResponse,
  UndoReviewResponse,
} from "@banki/shared";
import { sql } from "drizzle-orm";
import { openDatabase } from "../db/database";
import { createCardRepository } from "../repositories/cards";
import { createDeckRepository } from "../repositories/decks";
import { createReviewRepository } from "../repositories/reviews";
import { type App, bootApps, codeOf, send, setUp } from "../testing/app";

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

const settingsOf = async (res: Response) => SettingsResponse.parse(await res.json());
const deckOf = async (res: Response) => DeckResponse.parse(await res.json());

describe("POST /api/cards/:id/reviews", () => {
  test("records the Review, reschedules the Card and answers 201 with both", async () => {
    const { app, cookie, deckId, cardId } = await signedIn();
    const before = Date.now();

    const res = await send(
      app,
      "POST",
      `/api/cards/${cardId}/reviews`,
      { rating: "good", durationMs: 4200 },
      cookie,
    );

    expect(res.status).toBe(201);
    const { review, schedule } = RateCardResponse.parse(await res.json());
    expect(review).toMatchObject({
      cardId,
      deckId,
      rating: "good",
      kind: "self-rated",
      durationMs: 4200,
    });
    expect(Date.parse(review.reviewedAt)).toBeGreaterThanOrEqual(before);
    // A new Card rated Good goes to its second learning step, 10 minutes out.
    expect(schedule).toMatchObject({ state: "learning", reps: 1, lapses: 0, scheduledDays: 0 });
    expect(Date.parse(schedule.due ?? "")).toBe(Date.parse(review.reviewedAt) + 10 * 60_000);
  });

  test("takes every Rating", async () => {
    const { app, cookie, deckId } = await signedIn();

    for (const rating of ["again", "hard", "good", "easy"]) {
      const card = await createCard(app, cookie, deckId);
      const res = await send(
        app,
        "POST",
        `/api/cards/${card.id}/reviews`,
        { rating, durationMs: 0 },
        cookie,
      );
      expect(res.status).toBe(201);
    }
  });

  test("answers 400 invalid_request for a Rating that isn't one, or a duration that isn't whole ms from 0", async () => {
    const { app, cookie, cardId } = await signedIn();

    for (const body of [
      {},
      { rating: "good" },
      { durationMs: 10 },
      { rating: "perfect", durationMs: 10 },
      { rating: 3, durationMs: 10 },
      { rating: "good", durationMs: -1 },
      { rating: "good", durationMs: 1.5 },
      { rating: "good", durationMs: "10" },
      { rating: "good", durationMs: 10, kind: "graded" },
    ]) {
      const res = await send(app, "POST", `/api/cards/${cardId}/reviews`, body, cookie);
      expect(res.status).toBe(400);
      expect(await codeOf(res)).toBe("invalid_request");
    }
  });

  test("answers 404 not_found for a deleted or missing Card", async () => {
    const { app, cookie, cardId } = await signedIn();
    await send(app, "DELETE", `/api/cards/${cardId}`, undefined, cookie);

    for (const id of [cardId, "missing"]) {
      const res = await send(
        app,
        "POST",
        `/api/cards/${id}/reviews`,
        { rating: "good", durationMs: 0 },
        cookie,
      );
      expect(res.status).toBe(404);
      expect(await codeOf(res)).toBe("not_found");
    }
  });

  test("answers 401 when signed out", async () => {
    const { app, cardId } = await signedIn();

    const res = await send(app, "POST", `/api/cards/${cardId}/reviews`, {
      rating: "good",
      durationMs: 0,
    });

    expect(res.status).toBe(401);
  });
});

describe("Desired retention", () => {
  test("Settings hold 90% until changed, and take whole percents from 70 to 97", async () => {
    const { app, cookie } = await signedIn();

    expect(
      (await settingsOf(await send(app, "GET", "/api/settings", undefined, cookie)))
        .desiredRetention,
    ).toBe(90);

    for (const value of [70, 85, 97]) {
      const res = await send(app, "PATCH", "/api/settings", { desiredRetention: value }, cookie);
      expect(res.status).toBe(200);
      expect((await settingsOf(res)).desiredRetention).toBe(value);
    }

    for (const value of [69, 98, 85.5, "85", null]) {
      const res = await send(app, "PATCH", "/api/settings", { desiredRetention: value }, cookie);
      expect(res.status).toBe(400);
      expect(await codeOf(res)).toBe("invalid_request");
    }
  });

  test("a Deck follows Settings (null) until given its own, and can follow them again", async () => {
    const { app, cookie, deckId } = await signedIn();

    expect(
      (await deckOf(await send(app, "GET", `/api/decks/${deckId}`, undefined, cookie)))
        .desiredRetention,
    ).toBeNull();

    const own = await send(app, "PATCH", `/api/decks/${deckId}`, { desiredRetention: 85 }, cookie);
    expect(own.status).toBe(200);
    expect(await deckOf(own)).toMatchObject({ id: deckId, name: "Spanish", desiredRetention: 85 });

    const follows = await send(
      app,
      "PATCH",
      `/api/decks/${deckId}`,
      { desiredRetention: null },
      cookie,
    );
    expect(follows.status).toBe(200);
    expect((await deckOf(follows)).desiredRetention).toBeNull();

    for (const value of [69, 98, 85.5, "85"]) {
      const res = await send(
        app,
        "PATCH",
        `/api/decks/${deckId}`,
        { desiredRetention: value },
        cookie,
      );
      expect(res.status).toBe(400);
      expect(await codeOf(res)).toBe("invalid_request");
    }
  });
});

/** Makes another User, straight in the database, with a Card they rated once; answers the Review's ID. */
function othersReview() {
  const opened = openDatabase(dataDir());
  try {
    opened.db.run(
      sql`INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('other', 'n', 'o@x.y', 1, 0, 0)`,
    );
    const deck = createDeckRepository(opened.db).create("other", {
      name: "Theirs",
      description: null,
      folderId: null,
    });
    if (typeof deck === "string") throw new Error(`Their deck: ${deck}`);
    const card = createCardRepository(opened.db).create("other", deck.id, {
      front: "f",
      back: "b",
    });
    if (typeof card === "string") throw new Error(`Their card: ${card}`);
    const rated = createReviewRepository(opened.db).rate("other", card.id, {
      rating: "good",
      durationMs: 0,
    });
    if (rated === "not_found") throw new Error("Their review: not_found");
    return rated.review.id;
  } finally {
    opened.close();
  }
}

const rate = async (app: App, cookie: string, cardId: string, rating = "good") => {
  const res = await send(
    app,
    "POST",
    `/api/cards/${cardId}/reviews`,
    { rating, durationMs: 1000 },
    cookie,
  );
  if (res.status !== 201) throw new Error(`Rate answered ${res.status}`);
  return RateCardResponse.parse(await res.json());
};
const undo = (app: App, cookie: string, reviewId: string) =>
  send(app, "DELETE", `/api/reviews/${reviewId}`, undefined, cookie);
const undone = async (res: Response) => {
  expect(res.status).toBe(200);
  return UndoReviewResponse.parse(await res.json());
};
const reviewsOf = (cardId: string) => {
  const opened = openDatabase(dataDir());
  try {
    return opened.db.all<{ id: string }>(sql`SELECT id FROM review WHERE card_id = ${cardId}`);
  } finally {
    opened.close();
  }
};

describe("DELETE /api/reviews/:id", () => {
  afterEach(() => setSystemTime());

  test("deletes the Review and puts back the memory state from before it, with fresh previews", async () => {
    const { app, cookie, cardId } = await signedIn();
    const first = await rate(app, cookie, cardId, "again");
    const second = await rate(app, cookie, cardId, "good");

    const back = await undone(await undo(app, cookie, second.review.id));
    expect(back.card).toMatchObject({ id: cardId, front: "f", back: "b" });
    expect(back.schedule).toEqual(first.schedule);
    expect(back.intervals.good.state).toBe("learning");
    expect(reviewsOf(cardId).map((r) => r.id)).toEqual([first.review.id]);

    // Rate, rate, undo, undo: back to new, with no Review left.
    const fresh = await undone(await undo(app, cookie, first.review.id));
    expect(fresh.schedule).toMatchObject({ state: "new", due: null, reps: 0, lastReview: null });
    expect(fresh.intervals.again).toMatchObject({ state: "learning", scheduledDays: 0 });
    expect(reviewsOf(cardId)).toEqual([]);
  });

  test("a Card rated again after an Undo schedules as if the undone Rating was never given", async () => {
    setSystemTime(new Date("2026-05-01T10:00:00Z"));
    const { app, cookie, cardId } = await signedIn();
    const easy = await rate(app, cookie, cardId, "easy");
    await undo(app, cookie, easy.review.id);

    const again = await rate(app, cookie, cardId, "easy");

    expect(again.schedule).toEqual(easy.schedule);
  });

  test("reschedules the restored state when the Deck's Desired retention changed since", async () => {
    setSystemTime(new Date("2026-05-01T10:00:00Z"));
    const { app, cookie, deckId, cardId } = await signedIn();
    const learning = await rate(app, cookie, cardId, "good");
    setSystemTime(new Date(learning.schedule.due ?? ""));
    const graduated = await rate(app, cookie, cardId, "good");
    setSystemTime(new Date(graduated.schedule.due ?? ""));
    const latest = await rate(app, cookie, cardId, "good");

    // With no change, the Undo puts the graduated state back as it was.
    const same = await undone(await undo(app, cookie, latest.review.id));
    expect(same.schedule).toEqual(graduated.schedule);

    const relatest = await rate(app, cookie, cardId, "good");
    await send(app, "PATCH", `/api/decks/${deckId}`, { desiredRetention: 75 }, cookie);
    const moved = await undone(await undo(app, cookie, relatest.review.id));

    expect(moved.schedule).toMatchObject({
      state: "review",
      stability: graduated.schedule.stability,
      reps: graduated.schedule.reps,
      lastReview: graduated.schedule.lastReview,
    });
    expect(moved.schedule.scheduledDays).toBeGreaterThan(graduated.schedule.scheduledDays);
  });

  test("answers 409 review_not_newest for a Review that isn't its Card's newest, and keeps it", async () => {
    const { app, cookie, cardId } = await signedIn();
    const first = await rate(app, cookie, cardId);
    await rate(app, cookie, cardId);

    const res = await undo(app, cookie, first.review.id);

    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("review_not_newest");
    expect(reviewsOf(cardId)).toHaveLength(2);
  });

  test("answers 404 not_found for a missing Review, an undone one, another User's, or one whose Card is deleted", async () => {
    const { app, cookie, cardId } = await signedIn();
    const gone = await rate(app, cookie, cardId);
    await undone(await undo(app, cookie, gone.review.id));
    const theirs = othersReview();
    const deleted = await rate(app, cookie, cardId);
    await send(app, "DELETE", `/api/cards/${cardId}`, undefined, cookie);

    for (const id of ["missing", gone.review.id, theirs, deleted.review.id]) {
      const res = await undo(app, cookie, id);
      expect(res.status).toBe(404);
      expect(await codeOf(res)).toBe("not_found");
    }
    expect(reviewsOf(cardId)).toHaveLength(1);
  });

  test("answers 401 when signed out", async () => {
    const { app, cookie, cardId } = await signedIn();
    const { review } = await rate(app, cookie, cardId);

    expect((await undo(app, "", review.id)).status).toBe(401);
  });
});
