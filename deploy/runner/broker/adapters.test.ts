import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { gitHubApp } from "./github";
import { importAppKey } from "./jwt";
import type { Fetch } from "../lib/parse";
import { linearApp } from "./linear";

// The GitHub and Linear adapters against a fake `fetch`: what they send, what
// they read back, and that their errors carry no secret. There's no real App
// here, so the request shapes are what these pin.

type Call = { url: string; method: string; headers: Record<string, string>; body: string };

function fakeFetch(respond: (call: Call) => { status?: number; body: unknown }) {
  const calls: Call[] = [];
  const fetch: Fetch = async (url, init) => {
    const call: Call = {
      url,
      method: init.method ?? "GET",
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body: typeof init.body === "string" ? init.body : "",
    };
    calls.push(call);
    const { status = 200, body } = respond(call);
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  };
  return { calls, fetch };
}

// Fake values, built at runtime so secret scanners don't flag them.
const CLIENT_SECRET = ["fake", "linear", "client", "secret"].join("-");
const LINEAR_TOKEN = ["lin", "oauth", "faketoken"].join("_");
const GITHUB_TOKEN = ["ghs", "faketoken"].join("_");

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const key = await importAppKey(privateKey);

function routes(call: Call) {
  if (call.url.endsWith("/repos/dkomeza/banki/installation")) return { body: { id: 77 } };
  if (call.url.endsWith("/app/installations/77/access_tokens")) {
    return { status: 201, body: { token: GITHUB_TOKEN, expires_at: "2026-10-23T13:00:00Z" } };
  }
  if (call.url.endsWith("/app")) return { body: { slug: "banki-runner" } };
  if (call.url.endsWith("/users/banki-runner%5Bbot%5D")) return { body: { id: 9001 } };
  return { status: 404, body: { message: "Not Found" } };
}

describe("the GitHub App adapter", () => {
  test("finds the installation on the repo itself, and mints a token for that repo alone", async () => {
    const { calls, fetch } = fakeFetch(routes);
    const app = gitHubApp({ appId: "123", key, fetch });

    const minted = await app.mintToken();

    expect(minted).toEqual({ token: GITHUB_TOKEN, expiresAt: new Date("2026-10-23T13:00:00Z") });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET https://api.github.com/repos/dkomeza/banki/installation",
      "POST https://api.github.com/app/installations/77/access_tokens",
    ]);
    // The App's own permissions: none are asked for, so it gets all of its own.
    expect(JSON.parse(calls[1]?.body ?? "")).toEqual({ repositories: ["banki"] });
    for (const call of calls) expect(call.headers.authorization).toMatch(/^Bearer ey/);
  });

  test("looks the installation up once", async () => {
    const { calls, fetch } = fakeFetch(routes);
    const app = gitHubApp({ appId: "123", key, fetch });

    await app.mintToken();
    await app.mintToken();

    expect(calls.filter((c) => c.url.endsWith("/installation"))).toHaveLength(1);
  });

  test("authors commits as the App's bot, with its noreply email", async () => {
    const { fetch } = fakeFetch(routes);
    const app = gitHubApp({ appId: "123", key, fetch });

    expect(await app.identity(GITHUB_TOKEN)).toEqual({
      name: "banki-runner[bot]",
      email: "9001+banki-runner[bot]@users.noreply.github.com",
    });
  });

  test("fails with the status and GitHub's message, and never the JWT", async () => {
    const { calls, fetch } = fakeFetch(() => ({
      status: 401,
      body: { message: "Bad credentials" },
    }));
    const app = gitHubApp({ appId: "123", key, fetch });

    const error = await app.mintToken().catch((caught: unknown) => String(caught));

    expect(error).toContain(
      "GitHub GET /repos/dkomeza/banki/installation: HTTP 401 (Bad credentials)",
    );
    const jwt = calls[0]?.headers.authorization?.replace("Bearer ", "") ?? "";
    expect(jwt.length).toBeGreaterThan(100);
    expect(error).not.toContain(jwt.split(".")[2] ?? jwt);
  });
});

describe("the Linear app adapter", () => {
  test("mints with the client-credentials grant, read and write, the client's ID and secret as Basic auth", async () => {
    const { calls, fetch } = fakeFetch(() => ({
      body: { access_token: LINEAR_TOKEN, token_type: "Bearer", expires_in: 2591999 },
    }));
    const linear = linearApp({ clientId: "client-id", clientSecret: CLIENT_SECRET, fetch });

    expect(await linear.mint()).toBe(LINEAR_TOKEN);

    expect(calls[0]?.url).toBe("https://api.linear.app/oauth/token");
    expect(calls[0]?.headers.authorization).toBe(
      `Basic ${Buffer.from(`client-id:${CLIENT_SECRET}`).toString("base64")}`,
    );
    expect(Object.fromEntries(new URLSearchParams(calls[0]?.body))).toEqual({
      grant_type: "client_credentials",
      scope: "read,write",
    });
  });

  test("revokes with the token in the form, and nothing else to authenticate", async () => {
    const { calls, fetch } = fakeFetch(() => ({ body: "" }));
    const linear = linearApp({ clientId: "client-id", clientSecret: CLIENT_SECRET, fetch });

    await linear.revoke(LINEAR_TOKEN);

    expect(calls[0]?.url).toBe("https://api.linear.app/oauth/revoke");
    expect(calls[0]?.headers.authorization).toBeUndefined();
    expect(Object.fromEntries(new URLSearchParams(calls[0]?.body))).toEqual({
      token: LINEAR_TOKEN,
      token_type_hint: "access_token",
    });
  });

  test("counts a token Linear says it can't revoke (400, gone already) as revoked", async () => {
    const { fetch } = fakeFetch(() => ({ status: 400, body: { error: "invalid_token" } }));
    const linear = linearApp({ clientId: "client-id", clientSecret: CLIENT_SECRET, fetch });

    await linear.revoke(LINEAR_TOKEN);
  });

  test("fails a revoke Linear refuses otherwise, without the token", async () => {
    const { fetch } = fakeFetch(() => ({ status: 503, body: "upstream down" }));
    const linear = linearApp({ clientId: "client-id", clientSecret: CLIENT_SECRET, fetch });

    const error = await linear.revoke(LINEAR_TOKEN).catch((caught: unknown) => String(caught));

    expect(error).toContain("HTTP 503");
    expect(error).not.toContain(LINEAR_TOKEN);
  });

  test("fails a mint with Linear's error code, and never the secret", async () => {
    const { fetch } = fakeFetch(() => ({
      status: 401,
      body: { error: "invalid_client", error_description: `bad ${CLIENT_SECRET}` },
    }));
    const linear = linearApp({ clientId: "client-id", clientSecret: CLIENT_SECRET, fetch });

    const error = await linear.mint().catch((caught: unknown) => String(caught));

    expect(error).toContain("Linear POST /oauth/token: HTTP 401 (invalid_client)");
    expect(error).not.toContain(CLIENT_SECRET);
  });
});
