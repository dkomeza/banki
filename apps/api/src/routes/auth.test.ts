import { Database as SQLite } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { ApiError, MeResponse } from "@banki/shared";
import {
  bootApps,
  cookiesFrom,
  EMAIL,
  freshIp,
  get,
  ORIGIN,
  post,
  setUp,
  signIn,
} from "../testing/app";
import { captureLogs } from "../testing/logs";

const { boot, dataDir } = bootApps();
const records = captureLogs();

const DAY_MS = 24 * 60 * 60 * 1000;

const warnings = () =>
  records
    .filter((record) => record.level === "warning")
    .map(({ category, properties }) => ({ category: category.join("."), properties }));

/** A fresh app that Setup is done on. */
async function setUpApp(overrides: Parameters<typeof boot>[0] = {}) {
  const booted = boot(overrides);
  await setUp(booted);
  return booted.app;
}

describe("signing in", () => {
  test("with the right Email and Password sets a cookie that /api/me accepts", async () => {
    const app = await setUpApp();

    const res = await signIn(app);

    expect(res.status).toBe(200);
    const me = await get(app, "/api/me", cookiesFrom(res));
    expect(me.status).toBe(200);
    expect(MeResponse.parse(await me.json())).toEqual({ email: EMAIL });
  });

  test("accepts the Email in any case", async () => {
    const app = await setUpApp();

    expect((await signIn(app, { email: "User@Example.com" })).status).toBe(200);
  });

  test("a wrong Email and a wrong Password get the same error", async () => {
    const app = await setUpApp();

    const wrongEmail = await signIn(app, { email: "someone-else@example.com" });
    const wrongPassword = await signIn(app, { password: "not the password" });

    expect([wrongEmail.status, wrongPassword.status]).toEqual([401, 401]);
    expect(await wrongEmail.json()).toEqual(await wrongPassword.json());
    expect(wrongEmail.headers.getSetCookie()).toEqual([]);
  });

  test("logs a failed sign-in at warning with the client IP", async () => {
    const app = await setUpApp();

    await signIn(app, { password: "not the password", ip: "203.0.113.20" });

    expect(warnings()).toContainEqual({
      category: "banki.auth",
      properties: { ip: "203.0.113.20", status: 401 },
    });
  });

  test.each([
    ["an Email that isn't one", { email: "not-an-email" }],
    ["a Password over 128 characters", { password: "x".repeat(129) }],
  ])("logs a sign-in refused for %s at warning with the client IP", async (_, attempt) => {
    const app = await setUpApp();

    const res = await signIn(app, { ...attempt, ip: "203.0.113.21" });

    expect(res.status).toBe(400);
    expect(warnings()).toContainEqual({
      category: "banki.auth",
      properties: { ip: "203.0.113.21", status: 400 },
    });
  });

  test("logs a rate-limited or wrong-origin sign-in on its own line, not as a failed sign-in", async () => {
    const app = await setUpApp();
    const ip = freshIp();
    for (let i = 0; i < 5; i++) await signIn(app, { password: "not the password", ip });
    records.length = 0;

    await signIn(app, { ip });
    await signIn(app, { headers: { origin: "http://evil.example" } });

    const messages = records
      .filter((record) => record.level === "warning")
      .map((record) => String(record.rawMessage));
    expect(messages).toEqual([
      expect.stringMatching(/^Sign-in rate limited/),
      expect.stringMatching(/^Refused/),
    ]);
  });

  test("the 6th attempt in a minute from one IP gets 429", async () => {
    const app = await setUpApp();
    const ip = freshIp();

    for (let i = 0; i < 5; i++) {
      expect((await signIn(app, { password: "not the password", ip })).status).toBe(401);
    }
    const limited = await signIn(app, { ip });

    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("x-retry-after"))).toBeGreaterThan(0);
    expect((await signIn(app)).status).toBe(200);
  });

  test("is refused from another origin, with a warning naming both origins", async () => {
    const app = await setUpApp();

    const res = await signIn(app, { headers: { origin: "http://evil.example" } });

    expect(res.status).toBe(403);
    expect(warnings()).toContainEqual({
      category: "banki.auth",
      properties: expect.objectContaining({ requestOrigin: "http://evil.example", origin: ORIGIN }),
    });
    expect((await signIn(app, { headers: { origin: ORIGIN } })).status).toBe(200);
  });

  test.each([
    ["http://localhost:5173", false],
    ["https://banki.example.com", true],
  ])("with ORIGIN %s sets a Secure cookie: %p", async (origin, secure) => {
    const app = await setUpApp({ origin });

    const [cookie, ...others] = (await signIn(app, { headers: { origin } })).headers.getSetCookie();

    expect(others).toEqual([]);
    expect(cookie?.includes("; Secure")).toBe(secure);
    expect(cookie?.startsWith("__Secure-")).toBe(secure);
  });

  test("keeps the browser signed in for 30 days", async () => {
    const app = await setUpApp();

    const [cookie] = (await signIn(app)).headers.getSetCookie();

    expect(cookie).toContain("Max-Age=2592000");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
  });
});

/** Moves every auth session's last refresh `ageMs` into the past. */
const ageAuthSessions = (ageMs: number) => {
  const sqlite = new SQLite(join(dataDir(), "banki.db"));
  sqlite.run("UPDATE auth_session SET expires_at = ?, updated_at = ?", [
    Date.now() + 30 * DAY_MS - ageMs,
    Date.now() - ageMs,
  ]);
  sqlite.close();
};
const expiry = () => {
  const sqlite = new SQLite(join(dataDir(), "banki.db"));
  const row = sqlite.query<{ expires_at: number }, []>("SELECT expires_at FROM auth_session").get();
  sqlite.close();
  return row?.expires_at ?? 0;
};

describe("staying signed in", () => {
  test("using Banki a day or more after the last refresh slides the expiry forward", async () => {
    const booted = boot();
    const app = booted.app;
    // Setup's auth session is the only one.
    const cookie = await setUp(booted);
    ageAuthSessions(2 * DAY_MS);

    const res = await get(app, "/api/me", cookie);

    expect(res.status).toBe(200);
    expect(expiry()).toBeGreaterThan(Date.now() + 30 * DAY_MS - 60_000);
    expect(res.headers.getSetCookie()).toContainEqual(expect.stringContaining("Max-Age=2592000"));
  });

  test("using Banki within a day of the last refresh leaves the expiry alone", async () => {
    const booted = boot();
    const app = booted.app;
    // Setup's auth session is the only one.
    const cookie = await setUp(booted);
    ageAuthSessions(DAY_MS / 2);
    const before = expiry();

    const res = await get(app, "/api/me", cookie);

    expect(res.status).toBe(200);
    expect(expiry()).toBe(before);
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  test("an expired auth session is signed out", async () => {
    const booted = boot();
    const app = booted.app;
    // Setup's auth session is the only one.
    const cookie = await setUp(booted);
    ageAuthSessions(31 * DAY_MS);

    expect((await get(app, "/api/me", cookie)).status).toBe(401);
  });

  test("get-session answers the signed-in User, and null when signed out", async () => {
    const app = await setUpApp();
    const cookie = cookiesFrom(await signIn(app));

    const signedIn = await get(app, "/api/auth/get-session", cookie);
    const signedOut = await get(app, "/api/auth/get-session");

    expect(signedIn.status).toBe(200);
    expect(await signedIn.json()).toMatchObject({ user: { email: EMAIL } });
    expect(await signedOut.json()).toBeNull();
  });
});

describe("signing out", () => {
  test("ends the auth session, so the old cookie gets 401", async () => {
    const app = await setUpApp();
    const cookie = cookiesFrom(await signIn(app));

    const res = await post(app, "/api/auth/sign-out", {}, { headers: { cookie, origin: ORIGIN } });

    expect(res.status).toBe(200);
    expect((await get(app, "/api/me", cookie)).status).toBe(401);
  });

  test("is refused from another origin", async () => {
    const app = await setUpApp();
    const cookie = cookiesFrom(await signIn(app));

    const res = await post(
      app,
      "/api/auth/sign-out",
      {},
      { headers: { cookie, origin: "http://evil.example" } },
    );

    expect(res.status).toBe(403);
    expect((await get(app, "/api/me", cookie)).status).toBe(200);
  });
});

describe("deny by default", () => {
  const unauthorized = { error: { code: "unauthorized", message: "Sign in to continue" } };

  test.each([
    ["GET", "/api/me"],
    ["GET", "/api"],
    ["GET", "/api/nope"],
    ["POST", "/api/nope"],
    ["POST", "/api/auth/update-user"],
    ["POST", "/api/auth/sign-up/email"],
    ["GET", "/api/auth/list-sessions"],
    // A public path with a method that isn't public is unknown too.
    ["GET", "/api/auth/sign-in/email"],
    ["GET", "/api/auth/sign-out"],
    ["POST", "/api/auth/get-session"],
    ["PUT", "/api/setup"],
    ["DELETE", "/api/setup"],
    ["POST", "/api/health"],
  ])("%s %s answers 401 unauthorized when signed out", async (method, path) => {
    const app = await setUpApp();

    const res = await app.request(path, { method });

    expect(res.status).toBe(401);
    expect(ApiError.parse(await res.json())).toEqual(unauthorized);
  });

  test.each([
    ["GET", "/api/nope"],
    ["GET", "/api"],
    ["POST", "/api/auth/update-user"],
    ["POST", "/api/auth/change-password"],
    ["POST", "/api/auth/sign-up/email"],
    ["GET", "/api/auth/list-sessions"],
    ["POST", "/api/auth/revoke-sessions"],
    ["GET", "/api/auth/ok"],
  ])("%s %s answers the JSON 404 when signed in", async (method, path) => {
    const app = await setUpApp();
    const cookie = cookiesFrom(await signIn(app));

    const res = await app.request(path, {
      method,
      headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
      body: method === "POST" ? JSON.stringify({ name: "x", newPassword: "x".repeat(10) }) : null,
    });

    expect(res.status).toBe(404);
    expect(ApiError.parse(await res.json()).error.code).toBe("not_found");
  });

  test.each(["/api/health", "/api/setup", "/api/auth/get-session", "/api/me"])(
    "HEAD %s answers 401 when signed out",
    async (path) => {
      const app = await setUpApp();

      expect((await app.request(path, { method: "HEAD" })).status).toBe(401);
    },
  );

  test("POST to Setup, sign-in and sign-out stays public", async () => {
    const app = await setUpApp();

    const setup = await post(app, "/api/setup", { token: "t", email: EMAIL, password: "12345678" });
    const signInRes = await signIn(app, { password: "not the password" });
    const signOut = await post(app, "/api/auth/sign-out", {});

    expect(setup.status).toBe(409);
    expect(await signInRes.json()).toMatchObject({ code: "INVALID_EMAIL_OR_PASSWORD" });
    expect(signOut.status).toBe(200);
  });

  test("health, Setup status and get-session stay public", async () => {
    const app = await setUpApp();

    const statuses = await Promise.all(
      ["/api/health", "/api/setup", "/api/auth/get-session"].map(
        async (path) => (await get(app, path)).status,
      ),
    );

    expect(statuses).toEqual([200, 200, 200]);
  });
});
