import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import {
  CardListResponse,
  DeckListResponse,
  DeckResponse,
  DeleteResponse,
  PlanCheckResponse,
  PlanResponse,
} from "@banki/shared";
import { sql } from "drizzle-orm";
import { openDatabase } from "../db/database";
import { createDeckRepository } from "../repositories/decks";
import { type App, bootApps, codeOf, get, send, setUp } from "../testing/app";

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

/** How many Plan rows the database holds. */
function planRows() {
  const opened = openDatabase(dataDir());
  try {
    return opened.db.values<[number]>(sql`SELECT count(*) FROM plan`)[0]?.[0];
  } finally {
    opened.close();
  }
}

/** A fresh app that Setup is done on, the signed-in cookie, and one empty Deck. */
async function signedIn() {
  const booted = boot();
  const cookie = await setUp(booted);
  const res = await send(booted.app, "POST", "/api/decks", { name: "Spanish" }, cookie);
  const deck = DeckResponse.parse(await res.json());
  return { app: booted.app, cookie, deckId: deck.id };
}

const putPlan = (app: App, cookie: string, deckId: string, body: unknown) =>
  send(app, "PUT", `/api/decks/${deckId}/plan`, body, cookie);

const checkOf = (app: App, cookie: string, deckId: string, deadline: string, minutes: number) =>
  get(app, `/api/decks/${deckId}/plan/check?deadline=${deadline}&dailyMinutes=${minutes}`, cookie);

const deckOf = async (app: App, cookie: string, deckId: string) =>
  DeckResponse.parse(await (await get(app, `/api/decks/${deckId}`, cookie)).json());

async function createCards(app: App, cookie: string, deckId: string, count: number) {
  for (let i = 0; i < count; i++) {
    const res = await send(
      app,
      "POST",
      `/api/decks/${deckId}/cards`,
      { front: `f${i}`, back: "b" },
      cookie,
    );
    if (res.status !== 201) throw new Error(`Create card answered ${res.status}`);
  }
}

describe("PUT /api/decks/:deckId/plan", () => {
  test("creates the Plan and answers it; the Deck answers it as its plan", async () => {
    const { app, cookie, deckId } = await signedIn();

    const res = await putPlan(app, cookie, deckId, { deadline: "2026-07-01", dailyMinutes: 30 });

    expect(res.status).toBe(200);
    expect(PlanResponse.parse(await res.json())).toEqual({
      deadline: "2026-07-01",
      dailyMinutes: 30,
    });
    expect((await deckOf(app, cookie, deckId)).plan).toEqual({
      deadline: "2026-07-01",
      dailyMinutes: 30,
    });
  });

  test("replaces the Plan the Deck has, keeping one", async () => {
    const { app, cookie, deckId } = await signedIn();
    await putPlan(app, cookie, deckId, { deadline: "2026-07-01", dailyMinutes: 30 });

    const res = await putPlan(app, cookie, deckId, { deadline: "2026-08-15", dailyMinutes: 45 });

    expect(res.status).toBe(200);
    expect((await deckOf(app, cookie, deckId)).plan).toEqual({
      deadline: "2026-08-15",
      dailyMinutes: 45,
    });
    expect(planRows()).toBe(1);
  });

  test("lists each Deck with its plan, null without one", async () => {
    const { app, cookie, deckId } = await signedIn();
    await send(app, "POST", "/api/decks", { name: "Other" }, cookie);
    await putPlan(app, cookie, deckId, { deadline: "2026-07-01", dailyMinutes: 30 });

    const decks = DeckListResponse.parse(await (await get(app, "/api/decks", cookie)).json());

    expect(decks.find((d) => d.id === deckId)?.plan).toEqual({
      deadline: "2026-07-01",
      dailyMinutes: 30,
    });
    expect(decks.find((d) => d.id !== deckId)?.plan).toBeNull();
  });

  test.each([
    ["today", "2026-05-31", 400],
    ["tomorrow", "2026-06-01", 200],
    ["2 years out", "2028-05-31", 200],
    ["a day past 2 years", "2028-06-01", 400],
    ["not a date", "2026-02-30", 400],
  ])("takes a Deadline of %s or not", async (_, deadline, status) => {
    const { app, cookie, deckId } = await signedIn();

    const res = await putPlan(app, cookie, deckId, { deadline, dailyMinutes: 30 });

    expect(res.status).toBe(status);
    if (status === 400) expect(await codeOf(res)).toBe("invalid_request");
  });

  test.each([
    [4, 400],
    [5, 200],
    [600, 200],
    [601, 400],
  ])("takes %p minutes or not", async (dailyMinutes, status) => {
    const { app, cookie, deckId } = await signedIn();

    const res = await putPlan(app, cookie, deckId, { deadline: "2026-07-01", dailyMinutes });

    expect(res.status).toBe(status);
    if (status === 400) expect(await codeOf(res)).toBe("invalid_request");
  });

  test("reads today by the Timezone in Settings", async () => {
    // 23:30 UTC on 31 May is already 1 June, 13:30, on Kiritimati (UTC+14).
    setSystemTime(new Date("2026-05-31T23:30:00Z"));
    const { app, cookie, deckId } = await signedIn();
    const tomorrowInUtc = { deadline: "2026-06-01", dailyMinutes: 30 };
    expect((await putPlan(app, cookie, deckId, tomorrowInUtc)).status).toBe(200);

    await send(app, "PATCH", "/api/settings", { timezone: "Pacific/Kiritimati" }, cookie);

    expect((await putPlan(app, cookie, deckId, tomorrowInUtc)).status).toBe(400);
  });

  test("answers 404 for a missing, a deleted and another User's Deck", async () => {
    const { app, cookie, deckId } = await signedIn();
    const body = { deadline: "2026-07-01", dailyMinutes: 30 };
    await send(app, "DELETE", `/api/decks/${deckId}`, undefined, cookie);

    for (const id of ["missing", deckId, othersDeck()]) {
      const res = await putPlan(app, cookie, id, body);
      expect(res.status).toBe(404);
      expect(await codeOf(res)).toBe("not_found");
    }
  });

  test("answers 401 signed out", async () => {
    const { app, deckId } = await signedIn();

    const res = await putPlan(app, "", deckId, { deadline: "2026-07-01", dailyMinutes: 30 });

    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/decks/:deckId/plan", () => {
  test("removes the Plan, so the Deck answers none", async () => {
    const { app, cookie, deckId } = await signedIn();
    await putPlan(app, cookie, deckId, { deadline: "2026-07-01", dailyMinutes: 30 });

    const res = await send(app, "DELETE", `/api/decks/${deckId}/plan`, undefined, cookie);

    expect(res.status).toBe(204);
    expect((await deckOf(app, cookie, deckId)).plan).toBeNull();
    expect(planRows()).toBe(0);
  });

  test("answers 204 also when there was no Plan", async () => {
    const { app, cookie, deckId } = await signedIn();

    const res = await send(app, "DELETE", `/api/decks/${deckId}/plan`, undefined, cookie);

    expect(res.status).toBe(204);
  });

  test("answers 404 for a missing, a deleted and another User's Deck", async () => {
    const { app, cookie, deckId } = await signedIn();
    await send(app, "DELETE", `/api/decks/${deckId}`, undefined, cookie);

    for (const id of ["missing", deckId, othersDeck()]) {
      const res = await send(app, "DELETE", `/api/decks/${id}/plan`, undefined, cookie);
      expect(res.status).toBe(404);
      expect(await codeOf(res)).toBe("not_found");
    }
  });
});

describe("a Deck's delete, Restore and Removal", () => {
  test("keep the Plan through a delete and a Restore, and remove it with a Removal", async () => {
    const { app, cookie, deckId } = await signedIn();
    await putPlan(app, cookie, deckId, { deadline: "2026-07-01", dailyMinutes: 30 });

    const deleted = await send(app, "DELETE", `/api/decks/${deckId}`, undefined, cookie);
    const { deletionId } = DeleteResponse.parse(await deleted.json());
    expect(planRows()).toBe(1);
    await send(app, "POST", `/api/deletions/${deletionId}/restore`, undefined, cookie);
    expect((await deckOf(app, cookie, deckId)).plan).toEqual({
      deadline: "2026-07-01",
      dailyMinutes: 30,
    });

    const again = await send(app, "DELETE", `/api/decks/${deckId}`, undefined, cookie);
    const second = DeleteResponse.parse(await again.json()).deletionId;
    const removed = await send(app, "DELETE", `/api/deletions/${second}`, undefined, cookie);
    expect(removed.status).toBe(204);
    expect(planRows()).toBe(0);
  });
});

describe("GET /api/decks/:deckId/plan/check", () => {
  test("answers the check and saves nothing", async () => {
    const { app, cookie, deckId } = await signedIn();
    await createCards(app, cookie, deckId, 7);

    // Tomorrow's Deadline leaves today: 5 minutes is 5 New cards at 60 s.
    const res = await checkOf(app, cookie, deckId, "2026-06-01", 5);

    expect(res.status).toBe(200);
    expect(PlanCheckResponse.parse(await res.json())).toEqual({
      newCards: 7,
      unlearned: 2,
      neededMinutes: 10,
    });
    expect((await deckOf(app, cookie, deckId)).plan).toBeNull();
  });

  test("leaves the Deck's deleted Cards out", async () => {
    const { app, cookie, deckId } = await signedIn();
    await createCards(app, cookie, deckId, 3);
    const cards = CardListResponse.parse(
      await (await get(app, `/api/decks/${deckId}/cards`, cookie)).json(),
    );
    await send(app, "DELETE", `/api/cards/${cards[0]?.id}`, undefined, cookie);

    const res = await checkOf(app, cookie, deckId, "2026-06-01", 30);

    expect(PlanCheckResponse.parse(await res.json()).newCards).toBe(2);
  });

  test("answers nothing to learn for an empty Deck", async () => {
    const { app, cookie, deckId } = await signedIn();

    const res = await checkOf(app, cookie, deckId, "2026-07-01", 30);

    expect(await res.json()).toEqual({ newCards: 0, unlearned: 0, neededMinutes: 5 });
  });

  test.each([
    ["2026-05-31", 30],
    ["2028-06-01", 30],
    ["2026-07-01", 4],
    ["2026-07-01", 601],
  ])("answers 400 for a Deadline of %s at %p minutes", async (deadline, minutes) => {
    const { app, cookie, deckId } = await signedIn();

    const res = await checkOf(app, cookie, deckId, deadline, minutes);

    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe("invalid_request");
  });

  test("answers 400 without a Deadline", async () => {
    const { app, cookie, deckId } = await signedIn();

    const res = await get(app, `/api/decks/${deckId}/plan/check?dailyMinutes=30`, cookie);

    expect(res.status).toBe(400);
  });

  test("answers 404 for a missing, a deleted and another User's Deck", async () => {
    const { app, cookie, deckId } = await signedIn();
    await send(app, "DELETE", `/api/decks/${deckId}`, undefined, cookie);

    for (const id of ["missing", deckId, othersDeck()]) {
      const res = await checkOf(app, cookie, id, "2026-07-01", 30);
      expect(res.status).toBe(404);
      expect(await codeOf(res)).toBe("not_found");
    }
  });
});
