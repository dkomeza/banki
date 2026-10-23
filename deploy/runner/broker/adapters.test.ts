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

const REVOKE = "https://api.linear.app/oauth/revoke";
const GRAPHQL = "https://api.linear.app/graphql";

/**
 * A fake Linear for revoking: `revoke` answers each revoke call in turn (the
 * last repeats), and `check` the GraphQL query that asks whether the token
 * still works.
 */
function fakeLinear(
  revoke: { status: number; body?: unknown }[],
  check?: { status: number; body: unknown },
) {
  let revokes = 0;
  return fakeFetch((call) => {
    if (call.url === REVOKE) {
      const answer = revoke[Math.min(revokes++, revoke.length - 1)];
      return { status: answer?.status ?? 500, body: answer?.body ?? "" };
    }
    if (call.url === GRAPHQL && check !== undefined) return check;
    return { status: 500, body: "unexpected" };
  });
}

const ALIVE = { status: 200, body: { data: { viewer: { id: "app-user" } } } };
const DEAD_401 = { status: 401, body: { errors: [{ message: "Authentication required" }] } };
const DEAD_GRAPHQL = {
  status: 400,
  body: {
    errors: [
      {
        message: "Authentication required, not authenticated",
        extensions: { code: "AUTHENTICATION_ERROR" },
      },
    ],
  },
};

const revokeWith = async (fetch: Fetch) =>
  linearApp({ clientId: "client-id", clientSecret: CLIENT_SECRET, fetch })
    .revoke(LINEAR_TOKEN)
    .then(
      () => "revoked",
      (error: unknown) => String(error),
    );

describe("revoking a Linear token", () => {
  test("sends the token as its own Bearer authorization, and is done on a 2xx", async () => {
    const { calls, fetch } = fakeLinear([{ status: 200 }]);

    expect(await revokeWith(fetch)).toBe("revoked");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(REVOKE);
    expect(calls[0]?.headers.authorization).toBe(`Bearer ${LINEAR_TOKEN}`);
  });

  test("is done on a 400 when the token no longer authenticates, by status or by GraphQL's error", async () => {
    for (const check of [DEAD_401, DEAD_GRAPHQL]) {
      const { calls, fetch } = fakeLinear(
        [{ status: 400, body: { error: "invalid_token" } }],
        check,
      );

      expect(await revokeWith(fetch)).toBe("revoked");
      expect(calls.map((c) => c.url)).toEqual([REVOKE, GRAPHQL]);
      expect(calls[1]?.headers.authorization).toBe(`Bearer ${LINEAR_TOKEN}`);
    }
  });

  test("tries the token in the form next, when a 400 leaves it working", async () => {
    const { calls, fetch } = fakeLinear(
      [{ status: 400, body: { error: "invalid_request" } }, { status: 200 }],
      ALIVE,
    );

    expect(await revokeWith(fetch)).toBe("revoked");
    expect(calls.map((c) => c.url)).toEqual([REVOKE, GRAPHQL, REVOKE]);
    expect(calls[2]?.headers.authorization).toBeUndefined();
    expect(Object.fromEntries(new URLSearchParams(calls[2]?.body))).toEqual({
      token: LINEAR_TOKEN,
      token_type_hint: "access_token",
    });
  });

  test("fails when both ways answer 400 and the token still works, so the sweep tries again", async () => {
    const { fetch } = fakeLinear([{ status: 400, body: { error: "invalid_request" } }], ALIVE);

    const outcome = await revokeWith(fetch);

    expect(outcome).toContain("Linear POST /oauth/revoke: HTTP 400 (invalid_request)");
    expect(outcome).toContain("still works");
    expect(outcome).not.toContain(LINEAR_TOKEN);
  });

  test("fails on a 400 when the check itself fails, which proves nothing", async () => {
    const { fetch } = fakeLinear([{ status: 400, body: { error: "invalid_client" } }], {
      status: 503,
      body: "down",
    });

    expect(await revokeWith(fetch)).toContain("HTTP 400 (invalid_client)");
  });

  test("fails on any other status, without the token", async () => {
    const { fetch } = fakeLinear([{ status: 503, body: "upstream down" }]);

    const outcome = await revokeWith(fetch);

    expect(outcome).toContain("HTTP 503");
    expect(outcome).not.toContain(LINEAR_TOKEN);
  });
});
