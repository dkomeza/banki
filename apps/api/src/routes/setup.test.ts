import { describe, expect, test } from "bun:test";
import { ApiError, MeResponse, SetupStatus } from "@banki/shared";
import { bootApps, cookiesFrom, EMAIL, freshIp, get, PASSWORD, post, setUp } from "../testing/app";
import { captureLogs } from "../testing/logs";

const { boot } = bootApps();
const records = captureLogs();

const errorCode = async (res: Response) => ApiError.parse(await res.json()).error.code;

describe("GET /api/setup", () => {
  test("says setUp is false before Setup and true after", async () => {
    const booted = boot();

    const before = await get(booted.app, "/api/setup");
    expect(before.status).toBe(200);
    expect(SetupStatus.parse(await before.json())).toEqual({ setUp: false });

    await setUp(booted);

    expect(SetupStatus.parse(await (await get(booted.app, "/api/setup")).json())).toEqual({
      setUp: true,
    });
  });
});

describe("POST /api/setup", () => {
  test("creates the User, signs them in and answers 204", async () => {
    const booted = boot();
    const token = booted.setupToken?.value;

    const res = await post(booted.app, "/api/setup", { token, email: EMAIL, password: PASSWORD });

    expect(res.status).toBe(204);
    const me = await get(booted.app, "/api/me", cookiesFrom(res));
    expect(me.status).toBe(200);
    expect(MeResponse.parse(await me.json())).toEqual({ email: EMAIL });
  });

  test("stores the Email trimmed and lowercased", async () => {
    const booted = boot();

    const cookie = await setUp(booted, { email: "  Someone@Example.COM " });

    const me = await get(booted.app, "/api/me", cookie);
    expect(MeResponse.parse(await me.json())).toEqual({ email: "someone@example.com" });
  });

  test("the new Password signs in", async () => {
    const booted = boot();
    await setUp(booted);

    const res = await post(booted.app, "/api/auth/sign-in/email", {
      email: EMAIL,
      password: PASSWORD,
    });

    expect(res.status).toBe(200);
  });

  test.each([
    ["a missing token", { email: EMAIL, password: PASSWORD }],
    ["an invalid email", { token: "t", email: "not-an-email", password: PASSWORD }],
    ["a 7-character password", { token: "t", email: EMAIL, password: "1234567" }],
    ["a 129-character password", { token: "t", email: EMAIL, password: "x".repeat(129) }],
    ["a body that isn't an object", ["token"]],
  ])("answers 400 invalid_request for %s", async (_, body) => {
    const { app } = boot();

    const res = await post(app, "/api/setup", body);

    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("invalid_request");
  });

  test("answers 400 invalid_request for malformed JSON and for no JSON at all", async () => {
    const { app } = boot();
    const send = (body: string, headers: Record<string, string> = {}) =>
      app.request("/api/setup", {
        method: "POST",
        headers: { "x-forwarded-for": freshIp(), ...headers },
        body,
      });

    const malformed = await send("{", { "content-type": "application/json" });
    const notJson = await send("token=t");

    expect([malformed.status, notJson.status]).toEqual([400, 400]);
    expect([await errorCode(malformed), await errorCode(notJson)]).toEqual([
      "invalid_request",
      "invalid_request",
    ]);
  });

  test.each([8, 128])("accepts a %d-character password", async (length) => {
    const { app, setupToken } = boot();

    const res = await post(app, "/api/setup", {
      token: setupToken?.value,
      email: EMAIL,
      password: "x".repeat(length),
    });

    expect(res.status).toBe(204);
  });

  test("answers 409 already_set_up once a User exists, whatever the token", async () => {
    const booted = boot();
    const token = booted.setupToken?.value;
    await setUp(booted);

    const again = await post(booted.app, "/api/setup", { token, email: EMAIL, password: PASSWORD });
    const wrongToken = await post(booted.app, "/api/setup", {
      token: "wrong",
      email: EMAIL,
      password: PASSWORD,
    });

    expect([again.status, wrongToken.status]).toEqual([409, 409]);
    expect(await errorCode(again)).toBe("already_set_up");
  });

  test("answers 409 after a restart, when there is no Setup token at all", async () => {
    const first = boot();
    const token = first.setupToken?.value;
    await setUp(first);
    first.close();

    const second = boot();
    expect(second.setupToken).toBeUndefined();
    const res = await post(second.app, "/api/setup", { token, email: EMAIL, password: PASSWORD });

    expect(res.status).toBe(409);
  });

  test("checks the body before whether Banki is set up", async () => {
    const booted = boot();
    await setUp(booted);

    const res = await post(booted.app, "/api/setup", { email: EMAIL });

    expect(res.status).toBe(400);
  });

  test("answers 403 invalid_setup_token for a wrong token and creates no User", async () => {
    const { app } = boot();

    const res = await post(app, "/api/setup", { token: "wrong", email: EMAIL, password: PASSWORD });

    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("invalid_setup_token");
    expect(SetupStatus.parse(await (await get(app, "/api/setup")).json())).toEqual({
      setUp: false,
    });
  });

  test("logs a wrong token at warning with the client IP", async () => {
    const { app } = boot();

    await post(
      app,
      "/api/setup",
      { token: "wrong", email: EMAIL, password: PASSWORD },
      { ip: "203.0.113.9" },
    );

    expect(records).toContainEqual(
      expect.objectContaining({
        level: "warning",
        category: ["banki", "setup"],
        properties: { ip: "203.0.113.9" },
      }),
    );
  });

  test("refuses the token of an earlier start", async () => {
    const first = boot();
    const oldToken = first.setupToken?.value;
    first.close();

    const second = boot();
    const res = await post(second.app, "/api/setup", {
      token: oldToken,
      email: EMAIL,
      password: PASSWORD,
    });

    expect(second.setupToken?.value).not.toBe(oldToken);
    expect(res.status).toBe(403);
  });

  test("allows 5 attempts per minute per IP, then answers 429 rate_limited with Retry-After", async () => {
    const { app, setupToken } = boot();
    const ip = freshIp();
    const attempt = () =>
      post(app, "/api/setup", { token: "wrong", email: EMAIL, password: PASSWORD }, { ip });

    for (let i = 0; i < 5; i++) expect((await attempt()).status).toBe(403);
    const limited = await attempt();

    expect(limited.status).toBe(429);
    expect(await errorCode(limited)).toBe("rate_limited");
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    // Even the right token waits, while another IP still gets through.
    const right = { token: setupToken?.value, email: EMAIL, password: PASSWORD };
    expect((await post(app, "/api/setup", right, { ip })).status).toBe(429);
    expect((await post(app, "/api/setup", right)).status).toBe(204);
  });

  test("two concurrent valid requests create exactly one User", async () => {
    const { app, setupToken } = boot();
    const body = (email: string) => ({ token: setupToken?.value, email, password: PASSWORD });

    const responses = await Promise.all([
      post(app, "/api/setup", body("first@example.com")),
      post(app, "/api/setup", body("second@example.com")),
    ]);

    expect(responses.map((res) => res.status).toSorted((a, b) => a - b)).toEqual([204, 409]);
    const winner = responses.find((res) => res.status === 204);
    if (winner === undefined) throw new Error("no winner");
    const me = MeResponse.parse(await (await get(app, "/api/me", cookiesFrom(winner))).json());
    const loser = me.email === "first@example.com" ? "second@example.com" : "first@example.com";
    const loserSignIn = await post(app, "/api/auth/sign-in/email", {
      email: loser,
      password: PASSWORD,
    });
    expect(loserSignIn.status).toBe(401);
  });
});
