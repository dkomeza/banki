import { describe, expect, test } from "bun:test";
import { ApiError, MeResponse } from "@banki/shared";
import {
  type App,
  bootApps,
  cookiesFrom,
  EMAIL,
  freshIp,
  get,
  PASSWORD,
  post,
  setUp,
  signIn,
} from "../testing/app";
import { captureLogs } from "../testing/logs";

const { boot } = bootApps();
const records = captureLogs();

/** A fresh app that Setup is done on, and the signed-in cookie Setup set. */
async function signedIn() {
  const booted = boot();
  const cookie = await setUp(booted);
  return { app: booted.app, cookie };
}

const changeEmail = (
  app: App,
  cookie: string,
  body: { email: unknown; password: unknown },
  ip = freshIp(),
) => post(app, "/api/me/email", body, { ip, headers: { cookie } });

const emailOf = async (app: App, cookie: string) =>
  MeResponse.parse(await (await get(app, "/api/me", cookie)).json()).email;

const errorOf = async (res: Response) => ApiError.parse(await res.json()).error;

describe("POST /api/me/email", () => {
  test("with the right Password changes the Email, trimmed and lowercased", async () => {
    const { app, cookie } = await signedIn();

    const res = await changeEmail(app, cookie, {
      email: "  New.Address@Example.COM ",
      password: PASSWORD,
    });

    expect(res.status).toBe(200);
    expect(MeResponse.parse(await res.json())).toEqual({ email: "new.address@example.com" });
    expect(await emailOf(app, cookie)).toBe("new.address@example.com");
  });

  test("signing in then works with the new Email and not the old one", async () => {
    const { app, cookie } = await signedIn();
    await changeEmail(app, cookie, { email: "new@example.com", password: PASSWORD });

    expect((await signIn(app, { email: "new@example.com" })).status).toBe(200);
    expect((await signIn(app, { email: EMAIL })).status).toBe(401);
  });

  test("keeps every other device signed in", async () => {
    const { app, cookie } = await signedIn();
    const otherDevice = cookiesFrom(await signIn(app));

    await changeEmail(app, cookie, { email: "new@example.com", password: PASSWORD });

    expect((await get(app, "/api/me", otherDevice)).status).toBe(200);
    expect((await get(app, "/api/me", cookie)).status).toBe(200);
  });

  test("refuses a wrong Password with wrong_password, keeping the Email", async () => {
    const { app, cookie } = await signedIn();

    const res = await changeEmail(app, cookie, {
      email: "new@example.com",
      password: "not the password",
    });

    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe("wrong_password");
    expect(await emailOf(app, cookie)).toBe(EMAIL);
  });

  test.each([
    ["an Email that isn't one", "not-an-email"],
    ["an empty Email", "   "],
    ["no Email at all", undefined],
  ])("refuses %s with invalid_email", async (_, email) => {
    const { app, cookie } = await signedIn();

    const res = await changeEmail(app, cookie, { email, password: PASSWORD });

    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe("invalid_email");
    expect(await emailOf(app, cookie)).toBe(EMAIL);
  });

  test("refuses the Email the User already has, in any case, with same_email", async () => {
    const { app, cookie } = await signedIn();

    const res = await changeEmail(app, cookie, { email: " USER@example.com", password: PASSWORD });

    expect(res.status).toBe(409);
    expect(await errorOf(res)).toEqual({
      code: "same_email",
      message: "That's already your Email",
    });
  });

  test("answers 401 when signed out", async () => {
    const { app } = await signedIn();

    const res = await post(app, "/api/me/email", { email: "new@example.com", password: PASSWORD });

    expect(res.status).toBe(401);
  });

  test("the 6th attempt in a minute from one IP gets 429, logged at warning", async () => {
    const { app, cookie } = await signedIn();
    const ip = freshIp();
    for (let i = 0; i < 5; i++) {
      const res = await changeEmail(
        app,
        cookie,
        { email: "new@example.com", password: "not the password" },
        ip,
      );
      expect(res.status).toBe(403);
    }

    const limited = await changeEmail(
      app,
      cookie,
      { email: "new@example.com", password: PASSWORD },
      ip,
    );

    expect(limited.status).toBe(429);
    expect((await errorOf(limited)).code).toBe("rate_limited");
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await emailOf(app, cookie)).toBe(EMAIL);
    expect(records.map((record) => String(record.rawMessage))).toContainEqual(
      expect.stringMatching(/^Email change rate limited/),
    );
    // Another IP isn't held back.
    const other = await changeEmail(app, cookie, { email: "new@example.com", password: PASSWORD });
    expect(other.status).toBe(200);
  });

  test("logs a refused change at warning with the client IP", async () => {
    const { app, cookie } = await signedIn();

    await changeEmail(
      app,
      cookie,
      { email: "new@example.com", password: "not the password" },
      "203.0.113.30",
    );

    expect(
      records
        .filter((record) => record.level === "warning")
        .map(({ category, properties }) => ({ category: category.join("."), properties })),
    ).toContainEqual({
      category: "banki.auth",
      properties: { ip: "203.0.113.30", status: 403 },
    });
  });
});
