import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { CardResponse, DeckResponse, Statistics } from "@banki/shared";
import { sql } from "drizzle-orm";
import { openDatabase } from "../db/database";
import { createDeckRepository } from "../repositories/decks";
import { bootApps, codeOf, get, send, setUp } from "../testing/app";

const { boot, dataDir } = bootApps();

// Noon on Study day 2026-05-31, in UTC with the default Day start at 04:00.
const NOW = new Date("2026-05-31T12:00:00Z");

beforeEach(() => setSystemTime(NOW));
afterEach(() => setSystemTime());

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

/** A fresh app that Setup is done on, the signed-in cookie, and a Deck with one rated Card. */
async function signedIn() {
  const booted = boot();
  const cookie = await setUp(booted);
  const deck = DeckResponse.parse(
    await (await send(booted.app, "POST", "/api/decks", { name: "Spanish" }, cookie)).json(),
  );
  const card = CardResponse.parse(
    await (
      await send(
        booted.app,
        "POST",
        `/api/decks/${deck.id}/cards`,
        { front: "f", back: "b" },
        cookie,
      )
    ).json(),
  );
  const rated = await send(
    booted.app,
    "POST",
    `/api/cards/${card.id}/reviews`,
    { rating: "good", durationMs: 30_000 },
    cookie,
  );
  if (rated.status !== 201) throw new Error(`Rate answered ${rated.status}`);
  return { app: booted.app, cookie, deckId: deck.id };
}

describe("GET /api/statistics", () => {
  test.each(["7", "30", "90", "all"] as const)("answers the body for range %p", async (range) => {
    const { app, cookie } = await signedIn();
    const res = await get(app, `/api/statistics?range=${range}`, cookie);
    expect(res.status).toBe(200);
    const stats = Statistics.parse(await res.json());
    expect(stats.range).toBe(range);
    expect(stats.to).toBe("2026-05-31");
    expect(stats.calendar).toEqual([{ day: "2026-05-31", reviews: 1, ms: 30_000 }]);
    expect(stats.cards).toEqual({ new: 0, learning: 1, learned: 0 });
  });

  test("takes 30 days when the range is left out", async () => {
    const { app, cookie } = await signedIn();
    const stats = Statistics.parse(await (await get(app, "/api/statistics", cookie)).json());
    expect(stats).toMatchObject({ range: "30", from: "2026-05-02" });
  });

  test.each(["14", "", "ALL"])("answers 400 for the range %p", async (range) => {
    const { app, cookie } = await signedIn();
    const res = await get(app, `/api/statistics?range=${range}`, cookie);
    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe("invalid_request");
  });

  test("needs a signed-in User", async () => {
    const { app } = await signedIn();
    expect((await get(app, "/api/statistics")).status).toBe(401);
  });
});

describe("GET /api/decks/:deckId/statistics", () => {
  test.each(["7", "30", "90", "all"] as const)("answers the body for range %p", async (range) => {
    const { app, cookie, deckId } = await signedIn();
    const res = await get(app, `/api/decks/${deckId}/statistics?range=${range}`, cookie);
    expect(res.status).toBe(200);
    const stats = Statistics.parse(await res.json());
    expect(stats.range).toBe(range);
    expect(stats.minutes.points.reduce((sum, p) => sum + p.ms, 0)).toBe(30_000);
  });

  test("answers 400 for a bad range", async () => {
    const { app, cookie, deckId } = await signedIn();
    const res = await get(app, `/api/decks/${deckId}/statistics?range=365`, cookie);
    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe("invalid_request");
  });

  test("answers 404 for a deleted, unknown or other User's Deck", async () => {
    const { app, cookie, deckId } = await signedIn();
    const theirs = othersDeck();
    expect((await send(app, "DELETE", `/api/decks/${deckId}`, undefined, cookie)).status).toBe(200);
    for (const id of [deckId, theirs, "nope"]) {
      const res = await get(app, `/api/decks/${id}/statistics`, cookie);
      expect(res.status).toBe(404);
      expect(await codeOf(res)).toBe("not_found");
    }
  });
});
