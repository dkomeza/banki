import { describe, expect, test } from "bun:test";
import { CardResponse, DeckResponse, RateCardResponse, SettingsResponse } from "@banki/shared";
import { type App, bootApps, codeOf, send, setUp } from "../testing/app";

const { boot } = bootApps();

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
