import { describe, expect, test } from "bun:test";
import { ApiError, SettingsResponse } from "@banki/shared";
import { type App, bootApps, get, ORIGIN, setUp } from "../testing/app";

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
    expect(await settingsOf(res)).toEqual({ timezone: null, dayStartHour: 4 });
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
    expect(await settingsOf(res)).toEqual({ timezone: "Asia/Tokyo", dayStartHour: 0 });
    expect(await settingsOf(await get(app, "/api/settings", cookie))).toEqual({
      timezone: "Asia/Tokyo",
      dayStartHour: 0,
    });
  });

  test("changes only what it is given", async () => {
    const { app, cookie } = await signedIn();
    await send(app, "PATCH", "/api/settings", { timezone: "Europe/Warsaw" }, cookie);

    const res = await send(app, "PATCH", "/api/settings", { dayStartHour: 6 }, cookie);

    expect(await settingsOf(res)).toEqual({ timezone: "Europe/Warsaw", dayStartHour: 6 });
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
    ["something that isn't a Setting", { theme: "dark" }],
  ])("refuses %s with 400, changing nothing", async (_, body) => {
    const { app, cookie } = await signedIn();

    const res = await send(app, "PATCH", "/api/settings", body, cookie);

    expect(res.status).toBe(400);
    expect(ApiError.parse(await res.json()).error.code).toBe("invalid_request");
    expect(await settingsOf(await get(app, "/api/settings", cookie))).toEqual({
      timezone: null,
      dayStartHour: 4,
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
    expect(await settingsOf(res)).toEqual({ timezone: "Europe/Warsaw", dayStartHour: 4 });
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
    expect(await settingsOf(res)).toEqual({ timezone: "Europe/Warsaw", dayStartHour: 4 });
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

    expect(await settingsOf(res)).toEqual({ timezone: "Asia/Tokyo", dayStartHour: 6 });
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

    expect(await settingsOf(res)).toEqual({ timezone: "Europe/Warsaw", dayStartHour: 6 });
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
