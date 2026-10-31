import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import {
  CardResponse,
  DeckResponse,
  RATINGS,
  RateCardResponse,
  StudyNextResponse,
  StudyOverviewResponse,
} from "@banki/shared";
import { eq, sql } from "drizzle-orm";
import { openDatabase } from "../db/database";
import { card as cardTable } from "../db/schema";
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

/** Rates a Card, answering its new schedule. */
const rate = async (app: App, cookie: string, cardId: string, rating: string) => {
  const res = await send(
    app,
    "POST",
    `/api/cards/${cardId}/reviews`,
    { rating, durationMs: 0 },
    cookie,
  );
  if (res.status !== 201) throw new Error(`Rate answered ${res.status}`);
  return RateCardResponse.parse(await res.json()).schedule;
};

/** The whole answer of `study/next`. */
const answerOf = async (app: App, cookie: string, deckId: string, query = "") => {
  const res = await get(app, `/api/decks/${deckId}/study/next${query}`, cookie);
  expect(res.status).toBe(200);
  return StudyNextResponse.parse(await res.json());
};

const nextOf = async (app: App, cookie: string, deckId: string, query = "") =>
  (await answerOf(app, cookie, deckId, query)).next;

/** Changes the User's Settings. */
const patchSettings = async (app: App, cookie: string, body: Record<string, unknown>) => {
  const res = await send(app, "PATCH", "/api/settings", body, cookie);
  if (res.status !== 200) throw new Error(`PATCH settings answered ${res.status}`);
};

/** Writes `count` Cards in the Deck, in order; answers them. */
async function createCards(app: App, cookie: string, deckId: string, count: number) {
  const cards = [];
  for (let i = 0; i < count; i++) cards.push(await createCard(app, cookie, deckId, `card ${i}`));
  return cards;
}

describe("GET /api/decks/:deckId/study/next", () => {
  test("answers the next Card, its schedule, its kind and its Interval previews", async () => {
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
      intervals: {
        again: expect.objectContaining({ state: "learning", scheduledDays: 0 }),
        hard: expect.objectContaining({ state: "learning", scheduledDays: 0 }),
        good: expect.objectContaining({ state: "learning", scheduledDays: 0 }),
        easy: expect.objectContaining({ state: "review" }),
      },
    });
  });

  describe("each Interval preview is what its Rating then gives", () => {
    afterEach(() => setSystemTime());

    for (const rating of RATINGS) {
      test(`for ${rating}, of a new Card and of one due for review`, async () => {
        setSystemTime(new Date("2026-05-01T10:00:00Z"));
        const { app, cookie, deckId } = await signedIn();
        const fresh = await createCard(app, cookie, deckId, "fresh");

        const shown = await nextOf(app, cookie, deckId);
        expect(shown?.card.id).toBe(fresh.id);
        const after = await rate(app, cookie, fresh.id, rating);
        expect(shown?.intervals[rating]).toEqual({
          state: after.state,
          scheduledDays: after.scheduledDays,
          due: after.due ?? "",
        });

        // Another Card, past its learning steps and due a few days later.
        const old = await createCard(app, cookie, deckId, "old");
        await send(app, "DELETE", `/api/cards/${fresh.id}`, undefined, cookie);
        const learning = await rate(app, cookie, old.id, "good");
        setSystemTime(new Date(learning.due ?? ""));
        const graduated = await rate(app, cookie, old.id, "good");
        expect(graduated.state).toBe("review");
        setSystemTime(new Date(Date.parse(graduated.due ?? "") + 60 * 60_000));

        const due = await nextOf(app, cookie, deckId);
        expect(due?.kind).toBe("review");
        const again = await rate(app, cookie, old.id, rating);
        expect(due?.intervals[rating]).toEqual({
          state: again.state,
          scheduledDays: again.scheduledDays,
          due: again.due ?? "",
        });
      });
    }
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

  test("answers 400 invalid_request for batches that isn't a whole number from 1", async () => {
    const { app, cookie, deckId } = await signedIn();

    for (const query of ["?batches=0", "?batches=-1", "?batches=1.5", "?batches=", "?batches=x"]) {
      const res = await get(app, `/api/decks/${deckId}/study/next${query}`, cookie);
      expect(res.status).toBe(400);
      expect(await codeOf(res)).toBe("invalid_request");
    }
  });

  describe("the New-card batch", () => {
    test("is 20 New cards to begin with, then holds the rest back, saying how many", async () => {
      const { app, cookie, deckId } = await signedIn();
      await createCards(app, cookie, deckId, 22);

      expect(await answerOf(app, cookie, deckId, "?newShown=19")).toEqual({
        next: expect.objectContaining({ kind: "new" }),
        newHeld: 0,
      });
      expect(await answerOf(app, cookie, deckId, "?newShown=20")).toEqual({
        next: null,
        newHeld: 22,
      });
    });

    test("takes batches as 1 when left out, and allows another batch's New cards for each", async () => {
      const { app, cookie, deckId } = await signedIn();
      await patchSettings(app, cookie, { newCardBatch: 5 });
      const cards = await createCards(app, cookie, deckId, 7);

      expect((await answerOf(app, cookie, deckId, "?newShown=5")).newHeld).toBe(7);
      expect((await answerOf(app, cookie, deckId, "?newShown=5&batches=1")).newHeld).toBe(7);
      expect(await answerOf(app, cookie, deckId, "?newShown=5&batches=2")).toEqual({
        next: expect.objectContaining({ card: cards[0], kind: "new" }),
        newHeld: 0,
      });
    });

    test("is read from the Settings on every call", async () => {
      const { app, cookie, deckId } = await signedIn();
      await createCards(app, cookie, deckId, 3);
      expect((await nextOf(app, cookie, deckId, "?newShown=5"))?.kind).toBe("new");

      await patchSettings(app, cookie, { newCardBatch: 5 });

      expect(await answerOf(app, cookie, deckId, "?newShown=5")).toEqual({
        next: null,
        newHeld: 3,
      });
    });
  });

  describe("the Learning limit", () => {
    test("pauses New cards while that many Cards are in learning, read on every call", async () => {
      const { app, cookie, deckId } = await signedIn();
      const cards = await createCards(app, cookie, deckId, 6);
      // Five of them into their learning steps, due again in a minute.
      for (const card of cards.slice(0, 5)) await rate(app, cookie, card.id, "again");
      const fifth = cards[4]?.id ?? "";
      const query = `?newShown=5&after=${fifth}`;

      // 5 in learning, under the default limit of 10.
      expect(await nextOf(app, cookie, deckId, query)).toEqual(
        expect.objectContaining({ card: cards[5], kind: "new" }),
      );

      await patchSettings(app, cookie, { learningLimit: 5 });

      // Paused, with nothing else: the learning Card due soonest is shown early.
      const answer = await answerOf(app, cookie, deckId, query);
      expect(answer.next?.kind).toBe("learning");
      expect(answer.next?.card.id).toBe(cards[0]?.id);
      expect(answer.newHeld).toBe(0);
    });
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

/** Puts the Card in `state`, due at `dueAt`, straight in the database. */
function setCard(cardId: string, state: "learning" | "review" | "relearning", dueAt: string) {
  const opened = openDatabase(dataDir());
  try {
    opened.db
      .update(cardTable)
      .set({ state, dueAt: new Date(dueAt), stability: 5, lastReviewAt: new Date(0) })
      .where(eq(cardTable.id, cardId))
      .run();
  } finally {
    opened.close();
  }
}

const overviewOf = async (app: App, cookie: string, deckId: string) => {
  const res = await get(app, `/api/decks/${deckId}/study/overview`, cookie);
  expect(res.status).toBe(200);
  return StudyOverviewResponse.parse(await res.json());
};

describe("GET /api/decks/:deckId/study/overview", () => {
  afterEach(() => setSystemTime());

  test("answers nothing to study for an empty Deck", async () => {
    const { app, cookie, deckId } = await signedIn();

    expect(await overviewOf(app, cookie, deckId)).toEqual({
      due: 0,
      new: 0,
      newTotal: 0,
      estimateMs: 0,
      nextDue: null,
    });
  });

  test("counts review Cards due before the next Day start and every Card in its learning steps, not reviews due later", async () => {
    // 10:00 UTC on 1 May; with Day start 4:00 UTC, today ends at 2 May 04:00.
    setSystemTime(new Date("2026-05-01T10:00:00Z"));
    const { app, cookie, deckId } = await signedIn();
    await patchSettings(app, cookie, { timezone: "UTC", dayStartHour: 4 });
    const [overdue, today, tomorrow, learning, relearning, learningLater] = await createCards(
      app,
      cookie,
      deckId,
      6,
    );
    setCard(overdue?.id ?? "", "review", "2026-04-20T04:00:00Z");
    setCard(today?.id ?? "", "review", "2026-05-01T04:00:00Z");
    setCard(tomorrow?.id ?? "", "review", "2026-05-02T04:00:00Z");
    setCard(learning?.id ?? "", "learning", "2026-05-01T09:55:00Z");
    setCard(relearning?.id ?? "", "relearning", "2026-05-01T10:05:00Z");
    // A learning step that ends after the Day start still counts.
    setCard(learningLater?.id ?? "", "learning", "2026-05-02T05:00:00Z");

    const overview = await overviewOf(app, cookie, deckId);

    expect(overview.due).toBe(5);
    // Learning Cards count at the review rate: 5 × 10 s with no Reviews yet.
    expect(overview.estimateMs).toBe(5 * 10_000);
  });

  test("caps new by the New-card batch, read on every call, and leaves newTotal uncapped", async () => {
    const { app, cookie, deckId } = await signedIn();
    await createCards(app, cookie, deckId, 7);
    await patchSettings(app, cookie, { newCardBatch: 5 });

    expect(await overviewOf(app, cookie, deckId)).toMatchObject({
      new: 5,
      newTotal: 7,
      estimateMs: 5 * 60_000,
    });

    await patchSettings(app, cookie, { newCardBatch: 20 });
    expect(await overviewOf(app, cookie, deckId)).toMatchObject({ new: 7, newTotal: 7 });
  });

  test("estimates from the User's own Reviews once there are 20 Card-days", async () => {
    setSystemTime(new Date("2026-05-01T10:00:00Z"));
    const { app, cookie, deckId } = await signedIn();
    const cards = await createCards(app, cookie, deckId, 21);
    // 20 New cards rated today, 30 s each; one left New.
    for (const card of cards.slice(0, 20)) {
      const res = await send(
        app,
        "POST",
        `/api/cards/${card.id}/reviews`,
        { rating: "easy", durationMs: 30_000 },
        cookie,
      );
      expect(res.status).toBe(201);
    }

    expect(await overviewOf(app, cookie, deckId)).toMatchObject({
      due: 0,
      new: 1,
      estimateMs: 30_000,
    });
  });

  test("answers the first Study day after today with review Cards due, and how many", async () => {
    setSystemTime(new Date("2026-05-01T10:00:00Z"));
    const { app, cookie, deckId } = await signedIn();
    await patchSettings(app, cookie, { timezone: "UTC", dayStartHour: 4 });
    const [a, b, c, learning] = await createCards(app, cookie, deckId, 4);
    setCard(a?.id ?? "", "review", "2026-05-04T04:00:00Z");
    setCard(b?.id ?? "", "review", "2026-05-04T04:00:00Z");
    setCard(c?.id ?? "", "review", "2026-05-09T04:00:00Z");
    // A learning Card is due today, whenever its step ends.
    setCard(learning?.id ?? "", "learning", "2026-05-03T05:00:00Z");

    expect((await overviewOf(app, cookie, deckId)).nextDue).toEqual({
      day: "2026-05-04",
      count: 2,
    });
  });

  test("names the next due day in the User's Timezone and Day start", async () => {
    // 23:00 UTC on 1 May is 08:00 on 2 May in Tokyo.
    setSystemTime(new Date("2026-05-01T23:00:00Z"));
    const { app, cookie, deckId } = await signedIn();
    const [card] = await createCards(app, cookie, deckId, 1);
    // 3 May 06:00 in Tokyo.
    setCard(card?.id ?? "", "review", "2026-05-02T21:00:00Z");

    await patchSettings(app, cookie, { timezone: "UTC", dayStartHour: 4 });
    expect((await overviewOf(app, cookie, deckId)).nextDue).toEqual({
      day: "2026-05-02",
      count: 1,
    });

    await patchSettings(app, cookie, { timezone: "Asia/Tokyo", dayStartHour: 4 });
    expect((await overviewOf(app, cookie, deckId)).nextDue).toEqual({
      day: "2026-05-03",
      count: 1,
    });

    // With Day start 7:00 in Tokyo, 3 May 06:00 belongs to 2 May: today, so due.
    await patchSettings(app, cookie, { dayStartHour: 7 });
    expect(await overviewOf(app, cookie, deckId)).toMatchObject({ due: 1, nextDue: null });
  });

  test("answers nextDue: null when no review Card is ever due", async () => {
    const { app, cookie, deckId } = await signedIn();
    const [learning] = await createCards(app, cookie, deckId, 2);
    setCard(learning?.id ?? "", "learning", "2026-05-01T10:00:00Z");

    expect((await overviewOf(app, cookie, deckId)).nextDue).toBeNull();
  });

  test("leaves out deleted Cards", async () => {
    setSystemTime(new Date("2026-05-01T10:00:00Z"));
    const { app, cookie, deckId } = await signedIn();
    const [fresh, due, later] = await createCards(app, cookie, deckId, 3);
    setCard(due?.id ?? "", "review", "2026-04-30T04:00:00Z");
    setCard(later?.id ?? "", "review", "2026-05-05T04:00:00Z");
    for (const card of [fresh, due, later]) {
      await send(app, "DELETE", `/api/cards/${card?.id}`, undefined, cookie);
    }

    expect(await overviewOf(app, cookie, deckId)).toEqual({
      due: 0,
      new: 0,
      newTotal: 0,
      estimateMs: 0,
      nextDue: null,
    });
  });

  test("answers 404 not_found for a deleted, missing or other User's Deck", async () => {
    const { app, cookie, deckId } = await signedIn();
    await createCard(app, cookie, deckId);
    await send(app, "DELETE", `/api/decks/${deckId}`, undefined, cookie);
    const theirs = othersDeck();

    for (const id of [deckId, "missing", theirs]) {
      const res = await get(app, `/api/decks/${id}/study/overview`, cookie);
      expect(res.status).toBe(404);
      expect(await codeOf(res)).toBe("not_found");
    }
  });

  test("answers 401 when signed out", async () => {
    const { app, deckId } = await signedIn();

    expect((await get(app, `/api/decks/${deckId}/study/overview`)).status).toBe(401);
  });
});
