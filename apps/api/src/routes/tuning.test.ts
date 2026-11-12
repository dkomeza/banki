import { describe, expect, test } from "bun:test";
import {
  CardResponse,
  DeckResponse,
  TUNING_REVIEW_INTERVAL,
  TuneResponse,
  TuningStatus,
} from "@banki/shared";
import { sql } from "drizzle-orm";
import { openDatabase } from "../db/database";
import { createCardRepository } from "../repositories/cards";
import { createDeckRepository } from "../repositories/decks";
import { createReviewRepository } from "../repositories/reviews";
import { DEFAULT_PARAMETERS } from "../scheduling/fsrs";
import type { Optimizer } from "../scheduling/tuning";
import { bootApps, codeOf, get, send, setUp } from "../testing/app";

const { boot, dataDir } = bootApps();

const DAY = 24 * 60 * 60 * 1000;
const TUNED = DEFAULT_PARAMETERS.map((weight, i) => (i === 3 ? 20 : weight));

/** An optimizer that fits `TUNED`, which predicts better than any other Parameters. */
const improving: Optimizer = {
  computeParameters: async () => TUNED,
  evaluate: (parameters) => (parameters === TUNED ? 0.3 : 0.5),
};

/** Gives the User `userId` (the signed-in one unless named) a Card rated over a few days. */
function rateOverDays(userId?: string) {
  const opened = openDatabase(dataDir());
  try {
    const owner =
      userId ??
      opened.db.all<{ id: string }>(sql`SELECT id FROM user ORDER BY created_at LIMIT 1`)[0]?.id;
    if (owner === undefined) throw new Error("No User");
    const deck = createDeckRepository(opened.db).create(owner, {
      name: `Deck ${Math.random()}`,
      description: null,
      folderId: null,
    });
    if (typeof deck === "string") throw new Error(deck);
    const card = createCardRepository(opened.db).create(owner, deck.id, { front: "f", back: "b" });
    if (typeof card === "string") throw new Error(card);
    const reviews = createReviewRepository(opened.db);
    for (const days of [0, 0.01, 3, 10]) {
      const now = new Date(Date.parse("2026-05-01T10:00:00Z") + days * DAY);
      reviews.rate(owner, card.id, { rating: "good", durationMs: 0 }, { now });
    }
  } finally {
    opened.close();
  }
}

const statusOf = async (res: Response) => TuningStatus.parse(await res.json());

describe("GET /api/tuning", () => {
  test("answers the defaults, with nothing tried yet", async () => {
    const booted = boot();
    const cookie = await setUp(booted);

    const res = await get(booted.app, "/api/tuning", cookie);

    expect(res.status).toBe(200);
    expect(await statusOf(res)).toEqual({
      parameters: "default",
      tuned: null,
      lastAttempt: null,
      reviewsUntilAutomatic: TUNING_REVIEW_INTERVAL,
      paused: false,
      running: false,
      recommendedRetention: null,
    });
  });

  test("answers 401 signed out", async () => {
    const booted = boot();
    await setUp(booted);
    expect((await get(booted.app, "/api/tuning")).status).toBe(401);
    expect((await send(booted.app, "POST", "/api/tuning", {})).status).toBe(401);
    expect((await send(booted.app, "POST", "/api/tuning/reset", {})).status).toBe(401);
  });
});

describe("POST /api/tuning", () => {
  test("tunes now, answering the result and the new status, with its Recommended retention", async () => {
    const booted = boot({}, { tuningOptimizer: improving });
    const cookie = await setUp(booted);
    rateOverDays();

    const res = await send(booted.app, "POST", "/api/tuning", {}, cookie);

    expect(res.status).toBe(200);
    const body = TuneResponse.parse(await res.json());
    expect(body).toMatchObject({
      result: "applied",
      status: {
        parameters: "tuned",
        tuned: { reviews: 4 },
        lastAttempt: { trigger: "manual", outcome: "applied" },
        reviewsUntilAutomatic: TUNING_REVIEW_INTERVAL,
        paused: false,
        running: false,
      },
    });
    expect(body.status.recommendedRetention).toBeGreaterThanOrEqual(70);
    expect(body.status.recommendedRetention).toBeLessThanOrEqual(97);
    expect(await statusOf(await get(booted.app, "/api/tuning", cookie))).toEqual(body.status);
  });

  test("with FSRS's own optimizer, a handful of Reviews isn't enough", async () => {
    const booted = boot();
    const cookie = await setUp(booted);
    rateOverDays();

    const res = await send(booted.app, "POST", "/api/tuning", {}, cookie);

    expect(TuneResponse.parse(await res.json())).toMatchObject({
      result: "not_enough_data",
      status: {
        parameters: "default",
        lastAttempt: { outcome: "not_enough_data" },
        recommendedRetention: null,
      },
    });
  });

  test("leaves another User's Tuning alone", async () => {
    const booted = boot({}, { tuningOptimizer: improving });
    const cookie = await setUp(booted);
    const opened = openDatabase(dataDir());
    opened.db.run(
      sql`INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('other', 'n', 'o@x.y', 1, 0, 0)`,
    );
    opened.close();
    rateOverDays("other");

    const res = await send(booted.app, "POST", "/api/tuning", {}, cookie);

    // Theirs are no Reviews of the signed-in User's.
    expect(TuneResponse.parse(await res.json())).toMatchObject({
      result: "not_enough_data",
      status: { parameters: "default" },
    });
  });
});

describe("POST /api/tuning/reset", () => {
  test("answers 409 defaults_in_use while the defaults are in use", async () => {
    const booted = boot();
    const cookie = await setUp(booted);

    const res = await send(booted.app, "POST", "/api/tuning/reset", {}, cookie);

    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("defaults_in_use");
  });

  test("resets to the defaults, with no Recommended retention, and pauses automatic Tuning, until Tune now", async () => {
    const booted = boot({}, { tuningOptimizer: improving });
    const cookie = await setUp(booted);
    rateOverDays();
    await send(booted.app, "POST", "/api/tuning", {}, cookie);

    const res = await send(booted.app, "POST", "/api/tuning/reset", {}, cookie);

    expect(res.status).toBe(200);
    expect(await statusOf(res)).toMatchObject({
      parameters: "default",
      tuned: null,
      lastAttempt: { trigger: "reset", outcome: "reset" },
      paused: true,
      recommendedRetention: null,
    });
    const again = await send(booted.app, "POST", "/api/tuning", {}, cookie);
    expect(TuneResponse.parse(await again.json()).status).toMatchObject({
      parameters: "tuned",
      paused: false,
      recommendedRetention: expect.any(Number),
    });
  });
});

describe("POST /api/cards/:id/reviews", () => {
  test("starts an automatic Tuning once the Review count is 200 above the newest log row's", async () => {
    const booted = boot({}, { tuningOptimizer: improving });
    const cookie = await setUp(booted);
    for (let i = 0; i < (TUNING_REVIEW_INTERVAL - 4) / 4; i += 1) rateOverDays();
    const deck = await send(booted.app, "POST", "/api/decks", { name: "Spanish" }, cookie);
    const { id: deckId } = DeckResponse.parse(await deck.json());
    const card = await send(
      booted.app,
      "POST",
      `/api/decks/${deckId}/cards`,
      { front: "f", back: "b" },
      cookie,
    );
    const { id: cardId } = CardResponse.parse(await card.json());
    const rate = () =>
      send(
        booted.app,
        "POST",
        `/api/cards/${cardId}/reviews`,
        { rating: "good", durationMs: 0 },
        cookie,
      );
    for (let i = 0; i < 3; i += 1) await rate();
    expect(
      (await statusOf(await get(booted.app, "/api/tuning", cookie))).reviewsUntilAutomatic,
    ).toBe(1);

    expect((await rate()).status).toBe(201);

    let status = await statusOf(await get(booted.app, "/api/tuning", cookie));
    for (let tries = 0; status.lastAttempt === null && tries < 50; tries += 1) {
      await Bun.sleep(10);
      status = await statusOf(await get(booted.app, "/api/tuning", cookie));
    }
    expect(status).toMatchObject({
      parameters: "tuned",
      lastAttempt: { trigger: "automatic", outcome: "applied" },
      reviewsUntilAutomatic: TUNING_REVIEW_INTERVAL,
    });
  });
});
