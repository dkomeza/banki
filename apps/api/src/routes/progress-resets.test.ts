import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import {
  CardListResponse,
  CardResponse,
  DeckResponse,
  IntervalPreviews,
  MoveCardsResponse,
  RATINGS,
  RateCardResponse,
  StudyNextResponse,
  UndoReviewResponse,
} from "@banki/shared";
import { sql } from "drizzle-orm";
import { openDatabase } from "../db/database";
import { createCardRepository } from "../repositories/cards";
import { createDeckRepository } from "../repositories/decks";
import { type App, bootApps, codeOf, get, send, setUp } from "../testing/app";

// Progress resets (ADR-0026): `PATCH /api/cards/:id` with `resetProgress`,
// `studied` on every Card answered, `GET /api/cards/:id/intervals`, and the
// Undo a reset rules out.

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
    { front: "f", back: "b", tags: ["verb"] },
    cookie,
  );
  if (res.status !== 201) throw new Error(`Create card answered ${res.status}`);
  return CardResponse.parse(await res.json());
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

const patch = (app: App, cookie: string, cardId: string, body: unknown) =>
  send(app, "PATCH", `/api/cards/${cardId}`, body, cookie);

const intervals = (app: App, cookie: string, cardId: string) =>
  get(app, `/api/cards/${cardId}/intervals`, cookie);

/** Reads the database straight, as the routes leave it. */
function inDatabase<T>(read: (db: ReturnType<typeof openDatabase>["db"]) => T): T {
  const opened = openDatabase(dataDir());
  try {
    return read(opened.db);
  } finally {
    opened.close();
  }
}

const resetsOf = (cardId: string) =>
  inDatabase((db) =>
    db.all<{ card_id: string; user_id: string; reset_at: number }>(
      sql`SELECT card_id, user_id, reset_at FROM progress_reset WHERE card_id = ${cardId}`,
    ),
  );
const reviewsOf = (cardId: string) =>
  inDatabase((db) => db.all<{ id: string }>(sql`SELECT id FROM review WHERE card_id = ${cardId}`));
/** The Card's whole memory state, as stored. */
const memoryOf = (cardId: string) =>
  inDatabase(
    (db) =>
      db.all<Record<string, string | number | null>>(
        sql`SELECT state, due_at, stability, difficulty, reps, lapses, scheduled_days, learning_step, last_review_at FROM card WHERE id = ${cardId}`,
      )[0],
  );
const NEW_MEMORY = {
  state: "new",
  due_at: null,
  stability: 0,
  difficulty: 0,
  reps: 0,
  lapses: 0,
  scheduled_days: 0,
  learning_step: 0,
  last_review_at: null,
};

/** Another User's Card, made straight in the database; answers its ID. */
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
    const card = createCardRepository(db).create("other", deck.id, {
      front: "f",
      back: "b",
    });
    if (typeof card === "string") throw new Error(`Their card: ${card}`);
    return card.id;
  });
}

const studiedIn = async (res: Response) => CardResponse.parse(await res.json()).studied;

afterEach(() => setSystemTime());

describe("PATCH /api/cards/:id with resetProgress", () => {
  test("puts a studied Card's whole memory state back to New and logs one reset, with the edit, its Reviews untouched", async () => {
    setSystemTime(new Date("2026-05-01T10:00:00Z"));
    const { app, cookie, cardId } = await signedIn();
    const first = await rate(app, cookie, cardId);
    setSystemTime(new Date(first.schedule.due ?? ""));
    const second = await rate(app, cookie, cardId);
    expect(second.schedule.state).toBe("review");
    // Lapses and a learning step too, so every part of its memory state is off New's.
    inDatabase((db) =>
      db.run(sql`UPDATE card SET lapses = 2, learning_step = 1 WHERE id = ${cardId}`),
    );
    const studied = memoryOf(cardId);
    for (const [column, value] of Object.entries(NEW_MEMORY))
      expect(studied?.[column]).not.toBe(value);
    setSystemTime(new Date("2026-05-02T08:00:00Z"));

    const res = await patch(app, cookie, cardId, {
      back: "b2",
      resetProgress: true,
    });

    expect(res.status).toBe(200);
    expect(CardResponse.parse(await res.json())).toMatchObject({
      back: "b2",
      tags: ["verb"],
      studied: false,
    });
    expect(memoryOf(cardId)).toEqual(NEW_MEMORY);
    expect(resetsOf(cardId)).toEqual([
      {
        card_id: cardId,
        user_id: expect.any(String),
        reset_at: Date.parse("2026-05-02T08:00:00Z"),
      },
    ]);
    expect(
      reviewsOf(cardId)
        .map((r) => r.id)
        .toSorted(),
    ).toEqual([first.review.id, second.review.id].toSorted());
  });

  test("takes resetProgress alone, keeping everything else", async () => {
    const { app, cookie, cardId } = await signedIn();
    await rate(app, cookie, cardId);

    const res = await patch(app, cookie, cardId, { resetProgress: true });

    expect(res.status).toBe(200);
    expect(CardResponse.parse(await res.json())).toMatchObject({
      front: "f",
      back: "b",
      tags: ["verb"],
      studied: false,
    });
    expect(resetsOf(cardId)).toHaveLength(1);
  });

  test("alone on a studied Card moves its updatedAt", async () => {
    setSystemTime(new Date("2026-05-01T10:00:00.000Z"));
    const { app, cookie, cardId } = await signedIn();
    await rate(app, cookie, cardId);
    setSystemTime(new Date("2026-05-01T11:00:00.000Z"));

    const res = await patch(app, cookie, cardId, { resetProgress: true });

    expect(res.status).toBe(200);
    expect(CardResponse.parse(await res.json()).updatedAt).toBe("2026-05-01T11:00:00.000Z");
  });

  test("logs one row per reset", async () => {
    const { app, cookie, cardId } = await signedIn();
    await rate(app, cookie, cardId);
    await patch(app, cookie, cardId, { resetProgress: true });
    await rate(app, cookie, cardId);
    await patch(app, cookie, cardId, { resetProgress: true });

    expect(resetsOf(cardId)).toHaveLength(2);
  });

  test("on a New Card is a no-op that logs nothing", async () => {
    const { app, cookie, cardId } = await signedIn();

    const res = await patch(app, cookie, cardId, {
      front: "f2",
      resetProgress: true,
    });

    expect(res.status).toBe(200);
    expect(CardResponse.parse(await res.json())).toMatchObject({
      front: "f2",
      studied: false,
    });
    expect(resetsOf(cardId)).toEqual([]);
  });

  test("alone on a New Card changes nothing, its updatedAt included", async () => {
    setSystemTime(new Date("2026-05-01T10:00:00.000Z"));
    const { app, cookie, cardId } = await signedIn();
    setSystemTime(new Date("2026-05-01T11:00:00.000Z"));

    const res = await patch(app, cookie, cardId, { resetProgress: true });

    expect(res.status).toBe(200);
    expect(CardResponse.parse(await res.json()).updatedAt).toBe("2026-05-01T10:00:00.000Z");
    expect(resetsOf(cardId)).toEqual([]);
  });

  test("without it the memory state stays as it was", async () => {
    const { app, cookie, cardId } = await signedIn();
    await rate(app, cookie, cardId);
    const before = memoryOf(cardId);

    const res = await patch(app, cookie, cardId, { front: "f2" });

    expect(CardResponse.parse(await res.json())).toMatchObject({
      front: "f2",
      studied: true,
    });
    expect(memoryOf(cardId)).toEqual(before);
    expect(resetsOf(cardId)).toEqual([]);
  });

  test("resets nothing when the edit is refused, or the Card is gone", async () => {
    const { app, cookie, cardId } = await signedIn();
    await rate(app, cookie, cardId);

    const refused = await patch(app, cookie, cardId, {
      front: " ",
      resetProgress: true,
    });
    expect(refused.status).toBe(400);
    for (const body of [{ resetProgress: false }, { resetProgress: "yes" }]) {
      expect((await patch(app, cookie, cardId, body)).status).toBe(400);
    }
    expect(memoryOf(cardId)?.state).not.toBe("new");

    await send(app, "DELETE", `/api/cards/${cardId}`, undefined, cookie);
    const gone = await patch(app, cookie, cardId, { resetProgress: true });
    expect(gone.status).toBe(404);
    expect(memoryOf(cardId)?.state).not.toBe("new");
    expect(resetsOf(cardId)).toEqual([]);
  });

  test("answers 404 for another User's Card, and resets nothing of theirs", async () => {
    const { app, cookie } = await signedIn();
    const theirs = othersCard();
    // Studied, so a reset that reached it would put it back to New and log a row.
    inDatabase((db) =>
      db.run(sql`UPDATE card SET state = 'review', reps = 1, stability = 3 WHERE id = ${theirs}`),
    );

    const res = await patch(app, cookie, theirs, { resetProgress: true });

    expect(res.status).toBe(404);
    expect(await codeOf(res)).toBe("not_found");
    expect(resetsOf(theirs)).toEqual([]);
    expect(memoryOf(theirs)).toMatchObject({ state: "review", reps: 1, stability: 3 });
  });

  test("the reset Card comes in its learning steps once rated again", async () => {
    const { app, cookie, cardId } = await signedIn();
    await rate(app, cookie, cardId, "easy");
    await patch(app, cookie, cardId, { resetProgress: true });

    const again = await rate(app, cookie, cardId, "good");

    expect(again.schedule).toMatchObject({
      state: "learning",
      reps: 1,
      lapses: 0,
    });
  });
});

describe("studied", () => {
  test("is false for a New Card and true once rated, on every route that answers a Card", async () => {
    const { app, cookie, deckId, cardId } = await signedIn();
    const other = await createDeck(app, cookie, "Verbs");

    expect(await studiedIn(await get(app, `/api/cards/${cardId}`, cookie))).toBe(false);
    const next = StudyNextResponse.parse(
      await (await get(app, `/api/decks/${deckId}/study/next`, cookie)).json(),
    );
    expect(next.next?.card.studied).toBe(false);

    const { review } = await rate(app, cookie, cardId);

    expect(await studiedIn(await get(app, `/api/cards/${cardId}`, cookie))).toBe(true);
    expect(await studiedIn(await patch(app, cookie, cardId, { front: "f2" }))).toBe(true);
    const listed = CardListResponse.parse(
      await (await get(app, `/api/decks/${deckId}/cards`, cookie)).json(),
    );
    expect(listed.map((c) => c.studied)).toEqual([true]);
    const shown = StudyNextResponse.parse(
      await (await get(app, `/api/decks/${deckId}/study/next`, cookie)).json(),
    );
    expect(shown.next?.card.studied).toBe(true);

    // The Card an Undo answers is as it is after the Undo: New again.
    const undone = UndoReviewResponse.parse(
      await (await send(app, "DELETE", `/api/reviews/${review.id}`, undefined, cookie)).json(),
    );
    expect(undone.card.studied).toBe(false);

    await rate(app, cookie, cardId);
    const moved = MoveCardsResponse.parse(
      await (
        await send(app, "POST", "/api/cards/move", { cardIds: [cardId], deckId: other.id }, cookie)
      ).json(),
    );
    expect(moved.cards.map((c) => c.studied)).toEqual([true]);
  });
});

describe("GET /api/cards/:id/intervals", () => {
  test("answers each Rating's Interval preview, equal to what that Rating then gives", async () => {
    setSystemTime(new Date("2026-05-01T10:00:00Z"));
    const { app, cookie, cardId } = await signedIn();
    const learning = await rate(app, cookie, cardId);
    setSystemTime(new Date(learning.schedule.due ?? ""));

    const res = await intervals(app, cookie, cardId);
    expect(res.status).toBe(200);
    const previews = IntervalPreviews.parse(await res.json());

    for (const rating of RATINGS) {
      const given = await rate(app, cookie, cardId, rating);
      expect(given.schedule).toMatchObject({
        state: previews[rating].state,
        scheduledDays: previews[rating].scheduledDays,
      });
      expect(given.schedule.due).toBe(previews[rating].due);
      await send(app, "DELETE", `/api/reviews/${given.review.id}`, undefined, cookie);
    }
  });

  test("goes by the Deck's own Desired retention, not the one in Settings", async () => {
    setSystemTime(new Date("2026-05-01T10:00:00Z"));
    const { app, cookie, deckId, cardId } = await signedIn();
    const learning = await rate(app, cookie, cardId);
    setSystemTime(new Date(learning.schedule.due ?? ""));
    await rate(app, cookie, cardId);
    const following = IntervalPreviews.parse(await (await intervals(app, cookie, cardId)).json());
    await send(app, "PATCH", `/api/decks/${deckId}`, { desiredRetention: 70 }, cookie);

    const res = await intervals(app, cookie, cardId);
    const own = IntervalPreviews.parse(await res.json());

    expect(own.good.scheduledDays).toBeGreaterThan(following.good.scheduledDays);
    for (const rating of RATINGS) {
      const given = await rate(app, cookie, cardId, rating);
      expect(given.schedule).toMatchObject({
        state: own[rating].state,
        scheduledDays: own[rating].scheduledDays,
      });
      await send(app, "DELETE", `/api/reviews/${given.review.id}`, undefined, cookie);
    }
  });

  test("after a reset, answers a New Card's previews, as study/next shows them", async () => {
    setSystemTime(new Date("2026-05-01T10:00:00Z"));
    const { app, cookie, deckId, cardId } = await signedIn();
    const fresh = StudyNextResponse.parse(
      await (await get(app, `/api/decks/${deckId}/study/next`, cookie)).json(),
    ).next?.intervals;
    await rate(app, cookie, cardId, "easy");
    await patch(app, cookie, cardId, { resetProgress: true });

    const res = await intervals(app, cookie, cardId);

    expect(fresh).toBeDefined();
    expect(IntervalPreviews.parse(await res.json())).toEqual(IntervalPreviews.parse(fresh));
  });

  test("answers 404 not_found for a missing Card, another User's, a deleted one, or one in a deleted Deck", async () => {
    const { app, cookie, deckId, cardId } = await signedIn();
    const theirs = othersCard();
    const other = await createDeck(app, cookie, "Verbs");
    const inDeleted = await createCard(app, cookie, other.id);
    await send(app, "DELETE", `/api/decks/${other.id}`, undefined, cookie);
    const deleted = await createCard(app, cookie, deckId);
    await send(app, "DELETE", `/api/cards/${deleted.id}`, undefined, cookie);

    for (const id of ["missing", theirs, deleted.id, inDeleted.id]) {
      const res = await intervals(app, cookie, id);
      expect(res.status).toBe(404);
      expect(await codeOf(res)).toBe("not_found");
    }
    expect((await intervals(app, cookie, cardId)).status).toBe(200);
  });

  test("answers 401 when signed out", async () => {
    const { app, cardId } = await signedIn();

    expect((await intervals(app, "", cardId)).status).toBe(401);
  });
});

describe("DELETE /api/reviews/:id after a Progress reset", () => {
  test("answers 409 review_before_progress_reset for a Review from before it, and keeps it", async () => {
    const { app, cookie, cardId } = await signedIn();
    const before = await rate(app, cookie, cardId);
    await patch(app, cookie, cardId, { resetProgress: true });

    const res = await send(app, "DELETE", `/api/reviews/${before.review.id}`, undefined, cookie);

    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("review_before_progress_reset");
    expect(reviewsOf(cardId)).toHaveLength(1);
    expect(memoryOf(cardId)?.state).toBe("new");
  });

  test("still undoes a Rating given after it, back to New", async () => {
    const { app, cookie, cardId } = await signedIn();
    await rate(app, cookie, cardId, "easy");
    await patch(app, cookie, cardId, { resetProgress: true });
    const after = await rate(app, cookie, cardId);

    const res = await send(app, "DELETE", `/api/reviews/${after.review.id}`, undefined, cookie);

    expect(res.status).toBe(200);
    const back = UndoReviewResponse.parse(await res.json());
    expect(back.schedule).toMatchObject({ state: "new", reps: 0 });
    expect(back.card.studied).toBe(false);
  });

  test("counts only the Card's own resets: another Card's, logged since, leaves its Undo as it was", async () => {
    const { app, cookie, deckId, cardId } = await signedIn();
    const other = await createCard(app, cookie, deckId);
    await rate(app, cookie, other.id);
    const mine = await rate(app, cookie, cardId);
    await patch(app, cookie, other.id, { resetProgress: true });

    const res = await send(app, "DELETE", `/api/reviews/${mine.review.id}`, undefined, cookie);

    expect(res.status).toBe(200);
    expect(reviewsOf(cardId)).toHaveLength(0);
    expect(memoryOf(cardId)?.state).toBe("new");
  });

  test("goes by the newest reset: a Rating between two resets can't be undone", async () => {
    const { app, cookie, cardId } = await signedIn();
    await rate(app, cookie, cardId);
    await patch(app, cookie, cardId, { resetProgress: true });
    const between = await rate(app, cookie, cardId);
    await patch(app, cookie, cardId, { resetProgress: true });

    const res = await send(app, "DELETE", `/api/reviews/${between.review.id}`, undefined, cookie);

    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("review_before_progress_reset");
    expect(reviewsOf(cardId)).toHaveLength(2);
    expect(memoryOf(cardId)?.state).toBe("new");
  });

  test("orders by what happened, not by the clock: a same-moment Rating after a reset undoes", async () => {
    setSystemTime(new Date("2026-05-01T10:00:00.000Z"));
    const { app, cookie, cardId } = await signedIn();
    await rate(app, cookie, cardId);
    await patch(app, cookie, cardId, { resetProgress: true });
    const after = await rate(app, cookie, cardId);

    const res = await send(app, "DELETE", `/api/reviews/${after.review.id}`, undefined, cookie);

    expect(res.status).toBe(200);
  });

  test("orders by what happened, not by the clock: a reset logged at an earlier moment still holds", async () => {
    setSystemTime(new Date("2026-05-01T10:00:00.000Z"));
    const { app, cookie, cardId } = await signedIn();
    const before = await rate(app, cookie, cardId);
    // The server's clock steps back between the Rating and the reset.
    setSystemTime(new Date("2026-05-01T09:00:00.000Z"));
    await patch(app, cookie, cardId, { resetProgress: true });

    const res = await send(app, "DELETE", `/api/reviews/${before.review.id}`, undefined, cookie);

    expect(res.status).toBe(409);
    expect(memoryOf(cardId)?.state).toBe("new");
  });

  test("orders by what happened, not by the clock: a Rating after a reset, at an earlier moment, is the newest", async () => {
    setSystemTime(new Date("2026-05-01T10:00:00.000Z"));
    const { app, cookie, cardId } = await signedIn();
    const before = await rate(app, cookie, cardId);
    await patch(app, cookie, cardId, { resetProgress: true });
    // The server's clock steps back before the Card is rated again.
    setSystemTime(new Date("2026-05-01T09:00:00.000Z"));
    const after = await rate(app, cookie, cardId);

    const old = await send(app, "DELETE", `/api/reviews/${before.review.id}`, undefined, cookie);
    expect(old.status).toBe(409);
    expect(await codeOf(old)).toBe("review_not_newest");
    expect(reviewsOf(cardId)).toHaveLength(2);

    const res = await send(app, "DELETE", `/api/reviews/${after.review.id}`, undefined, cookie);
    expect(res.status).toBe(200);
    expect(UndoReviewResponse.parse(await res.json()).schedule).toMatchObject({
      state: "new",
    });
    expect(reviewsOf(cardId)).toHaveLength(1);

    // The newest Review now, the one from before the reset still stands.
    const again = await send(app, "DELETE", `/api/reviews/${before.review.id}`, undefined, cookie);
    expect(again.status).toBe(409);
    expect(await codeOf(again)).toBe("review_before_progress_reset");
    expect(reviewsOf(cardId)).toHaveLength(1);
  });
});

describe("the Write order", () => {
  test("numbers a User's Reviews and Progress resets together, one after another", async () => {
    const { app, cookie, cardId, deckId } = await signedIn();
    const other = await createCard(app, cookie, deckId);
    const first = await rate(app, cookie, cardId);
    await patch(app, cookie, cardId, { resetProgress: true });
    const second = await rate(app, cookie, other.id);

    const order = inDatabase((db) =>
      db.all<{ id: string; seq: number }>(
        sql`SELECT id, seq FROM review UNION ALL SELECT 'reset', seq FROM progress_reset ORDER BY seq`,
      ),
    );
    expect(order).toEqual([
      { id: first.review.id, seq: 1 },
      { id: "reset", seq: 2 },
      { id: second.review.id, seq: 3 },
    ]);
  });
});
