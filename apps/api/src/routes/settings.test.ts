import { describe, expect, test } from "bun:test";
import { ApiError, SettingsResponse } from "@banki/shared";
import { type App, bootApps, get, ORIGIN, setUp } from "../testing/app";

/** What a User who hasn't touched the Grading, Editor, Study or Advanced cards has. */
const UNTOUCHED_DEFAULTS = {
  model: "anthropic/claude-haiku-5.5",
  apiKey: { state: "unset" },
  autoClose: "brackets",
  desiredRetention: 90,
  newCardBatch: 20,
  learningLimit: 10,
} as const;

const { boot } = bootApps();

/** A fresh app that Setup is done on, and the signed-in cookie Setup set. */
async function signedIn() {
  const booted = boot();
  const cookie = await setUp(booted);
  return { app: booted.app, cookie };
}

const send = (app: App, method: string, path: string, body: unknown, cookie?: string) =>
  app.request(path, {
    method,
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      ...(cookie === undefined ? {} : { cookie }),
    },
    body: JSON.stringify(body),
  });

const settingsOf = async (res: Response) => SettingsResponse.parse(await res.json());

describe("GET /api/settings", () => {
  test("reads as the defaults before anything is stored: no Timezone, Day start 4", async () => {
    const { app, cookie } = await signedIn();

    const res = await get(app, "/api/settings", cookie);

    expect(res.status).toBe(200);
    expect(await settingsOf(res)).toEqual({
      timezone: null,
      dayStartHour: 4,
      ...UNTOUCHED_DEFAULTS,
    });
  });

  test("answers 401 when signed out", async () => {
    const { app } = await signedIn();

    const res = await get(app, "/api/settings");

    expect(res.status).toBe(401);
    expect(ApiError.parse(await res.json()).error.code).toBe("unauthorized");
  });
});

describe("PATCH /api/settings", () => {
  test("changes the Timezone and the Day start, and answers the new Settings", async () => {
    const { app, cookie } = await signedIn();

    const res = await send(
      app,
      "PATCH",
      "/api/settings",
      { timezone: "Asia/Tokyo", dayStartHour: 0 },
      cookie,
    );

    expect(res.status).toBe(200);
    expect(await settingsOf(res)).toEqual({
      timezone: "Asia/Tokyo",
      dayStartHour: 0,
      ...UNTOUCHED_DEFAULTS,
    });
    expect(await settingsOf(await get(app, "/api/settings", cookie))).toEqual({
      timezone: "Asia/Tokyo",
      dayStartHour: 0,
      ...UNTOUCHED_DEFAULTS,
    });
  });

  test("changes only what it is given", async () => {
    const { app, cookie } = await signedIn();
    await send(app, "PATCH", "/api/settings", { timezone: "Europe/Warsaw" }, cookie);

    const res = await send(app, "PATCH", "/api/settings", { dayStartHour: 6 }, cookie);

    expect(await settingsOf(res)).toEqual({
      timezone: "Europe/Warsaw",
      dayStartHour: 6,
      ...UNTOUCHED_DEFAULTS,
    });
  });

  test.each(["off", "brackets", "brackets-and-dollar"] as const)(
    "stores auto-close %s, and reads it back",
    async (autoClose) => {
      const { app, cookie } = await signedIn();

      const res = await send(app, "PATCH", "/api/settings", { autoClose }, cookie);

      expect(res.status).toBe(200);
      expect((await settingsOf(res)).autoClose).toBe(autoClose);
      expect((await settingsOf(await get(app, "/api/settings", cookie))).autoClose).toBe(autoClose);
    },
  );

  test("keeps auto-close when another Setting changes", async () => {
    const { app, cookie } = await signedIn();
    await send(app, "PATCH", "/api/settings", { autoClose: "off" }, cookie);

    const res = await send(app, "PATCH", "/api/settings", { dayStartHour: 6 }, cookie);

    expect(await settingsOf(res)).toEqual({
      timezone: null,
      dayStartHour: 6,
      ...UNTOUCHED_DEFAULTS,
      autoClose: "off",
    });
  });

  test.each([
    ["newCardBatch", [5, 37, 100]],
    ["learningLimit", [5, 23, 50]],
  ] as const)(
    "stores %s from its lowest to its highest, and reads it back",
    async (field, values) => {
      const { app, cookie } = await signedIn();

      for (const value of values) {
        const res = await send(app, "PATCH", "/api/settings", { [field]: value }, cookie);
        expect(res.status).toBe(200);
        expect((await settingsOf(res))[field]).toBe(value);
        expect((await settingsOf(await get(app, "/api/settings", cookie)))[field]).toBe(value);
      }
    },
  );

  test("keeps the New-card batch and the Learning limit when another Setting changes", async () => {
    const { app, cookie } = await signedIn();
    await send(app, "PATCH", "/api/settings", { newCardBatch: 40, learningLimit: 15 }, cookie);

    const res = await send(app, "PATCH", "/api/settings", { dayStartHour: 6 }, cookie);

    expect(await settingsOf(res)).toEqual({
      timezone: null,
      dayStartHour: 6,
      ...UNTOUCHED_DEFAULTS,
      newCardBatch: 40,
      learningLimit: 15,
    });
  });

  test("accepts an alias Intl accepts, such as Europe/Kiev", async () => {
    const { app, cookie } = await signedIn();

    const res = await send(app, "PATCH", "/api/settings", { timezone: "Europe/Kiev" }, cookie);

    expect(res.status).toBe(200);
    expect((await settingsOf(res)).timezone).toBe("Europe/Kiev");
  });

  test.each([
    ["an unknown Timezone", { timezone: "Mars/Olympus_Mons" }],
    ["a UTC offset", { timezone: "+02:00" }],
    ["a Timezone that isn't a string", { timezone: 2 }],
    ["an hour past 23", { dayStartHour: 24 }],
    ["a negative hour", { dayStartHour: -1 }],
    ["a part of an hour", { dayStartHour: 4.5 }],
    ["an auto-close Banki doesn't know", { autoClose: "always" }],
    ["an auto-close that isn't a string", { autoClose: true }],
    ["a New-card batch under 5", { newCardBatch: 4 }],
    ["a New-card batch over 100", { newCardBatch: 101 }],
    ["a part of a New-card batch", { newCardBatch: 12.5 }],
    ["a New-card batch that isn't a number", { newCardBatch: "20" }],
    ["a Learning limit under 5", { learningLimit: 4 }],
    ["a Learning limit over 50", { learningLimit: 51 }],
    ["a part of a Learning limit", { learningLimit: 7.5 }],
    ["a Learning limit that is null", { learningLimit: null }],
    ["something that isn't a Setting", { theme: "dark" }],
  ])("refuses %s with 400, changing nothing", async (_, body) => {
    const { app, cookie } = await signedIn();

    const res = await send(app, "PATCH", "/api/settings", body, cookie);

    expect(res.status).toBe(400);
    expect(ApiError.parse(await res.json()).error.code).toBe("invalid_request");
    expect(await settingsOf(await get(app, "/api/settings", cookie))).toEqual({
      timezone: null,
      dayStartHour: 4,
      ...UNTOUCHED_DEFAULTS,
    });
  });

  test("answers 401 when signed out", async () => {
    const { app } = await signedIn();

    expect((await send(app, "PATCH", "/api/settings", { dayStartHour: 6 })).status).toBe(401);
  });
});

describe("PUT /api/settings/timezone/initial", () => {
  test("stores this browser's zone when no Timezone is stored", async () => {
    const { app, cookie } = await signedIn();

    const res = await send(
      app,
      "PUT",
      "/api/settings/timezone/initial",
      { timezone: "Europe/Warsaw" },
      cookie,
    );

    expect(res.status).toBe(200);
    expect(await settingsOf(res)).toEqual({
      timezone: "Europe/Warsaw",
      dayStartHour: 4,
      ...UNTOUCHED_DEFAULTS,
    });
  });

  test("changes nothing once a Timezone is stored, answering the stored Settings", async () => {
    const { app, cookie } = await signedIn();
    await send(app, "PUT", "/api/settings/timezone/initial", { timezone: "Europe/Warsaw" }, cookie);

    const res = await send(
      app,
      "PUT",
      "/api/settings/timezone/initial",
      { timezone: "America/New_York" },
      cookie,
    );

    expect(res.status).toBe(200);
    expect(await settingsOf(res)).toEqual({
      timezone: "Europe/Warsaw",
      dayStartHour: 4,
      ...UNTOUCHED_DEFAULTS,
    });
  });

  test("never overwrites a Timezone chosen on the Settings page", async () => {
    const { app, cookie } = await signedIn();
    await send(app, "PATCH", "/api/settings", { timezone: "Asia/Tokyo", dayStartHour: 6 }, cookie);

    const res = await send(
      app,
      "PUT",
      "/api/settings/timezone/initial",
      { timezone: "Europe/Warsaw" },
      cookie,
    );

    expect(await settingsOf(res)).toEqual({
      timezone: "Asia/Tokyo",
      dayStartHour: 6,
      ...UNTOUCHED_DEFAULTS,
    });
  });

  test("fills in a Timezone when only the Day start was stored", async () => {
    const { app, cookie } = await signedIn();
    await send(app, "PATCH", "/api/settings", { dayStartHour: 6 }, cookie);

    const res = await send(
      app,
      "PUT",
      "/api/settings/timezone/initial",
      { timezone: "Europe/Warsaw" },
      cookie,
    );

    expect(await settingsOf(res)).toEqual({
      timezone: "Europe/Warsaw",
      dayStartHour: 6,
      ...UNTOUCHED_DEFAULTS,
    });
  });

  test("refuses an unknown Timezone with 400", async () => {
    const { app, cookie } = await signedIn();

    const res = await send(
      app,
      "PUT",
      "/api/settings/timezone/initial",
      { timezone: "Nowhere/Special" },
      cookie,
    );

    expect(res.status).toBe(400);
  });

  test("answers 401 when signed out", async () => {
    const { app } = await signedIn();

    const res = await send(app, "PUT", "/api/settings/timezone/initial", {
      timezone: "Europe/Warsaw",
    });

    expect(res.status).toBe(401);
  });
});
