import { Database as SQLite } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { ApiError, SettingsResponse } from "@banki/shared";
import { createApiKeyCipher } from "../crypto/api-key-cipher";
import { loadEncryptionKey } from "../crypto/encryption-key";
import { openDatabase } from "../db/database";
import type { OpenRouterFetch } from "../openrouter/check-api-key";
import { createSettingsRepository } from "../repositories/settings";
import { createUserRepository } from "../repositories/user";
import { type App, bootApps, get, ORIGIN, setUp, unreachableOpenRouter } from "../testing/app";

const { boot, dataDir } = bootApps();

const API_KEY = "sk-or-v1-5c0ffee5c0ffee5c0ffee5c0ffee3f9a";
const KEY_A = Buffer.alloc(32, 0xa).toString("base64url");
const KEY_B = Buffer.alloc(32, 0xb).toString("base64url");

/** OpenRouter answering every key check with `status`, recording the keys it was asked about. */
function openRouter(status = 200) {
  const asked: string[] = [];
  const fetch: OpenRouterFetch = async (url, init) => {
    expect(url).toBe("https://openrouter.ai/api/v1/key");
    asked.push(new Headers(init.headers).get("authorization")?.replace(/^Bearer /, "") ?? "");
    return Response.json({ data: { label: "sk-or-v1-5c0…3f9a" } }, { status });
  };
  return { fetch, asked };
}

/** A fresh app that Setup is done on, and the signed-in cookie Setup set. */
async function signedIn({
  openRouterFetch = openRouter().fetch,
  encryptionKey,
}: { openRouterFetch?: OpenRouterFetch; encryptionKey?: string } = {}) {
  const booted = boot({ encryptionKey }, { openRouterFetch });
  const cookie = await setUp(booted);
  return { ...booted, cookie };
}

const send = (app: App, method: string, path: string, body: unknown, cookie?: string) =>
  app.request(path, {
    method,
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      ...(cookie === undefined ? {} : { cookie }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const putKey = (app: App, apiKey: unknown, cookie: string) =>
  send(app, "PUT", "/api/settings/api-key", { apiKey }, cookie);

const settingsOf = async (res: Response) => SettingsResponse.parse(await res.json());
const errorOf = async (res: Response) => ApiError.parse(await res.json()).error;

/** The stored row of Settings, straight from the database. */
function storedRow() {
  const sqlite = new SQLite(join(dataDir(), "banki.db"), { readonly: true });
  try {
    return sqlite
      .query<{ api_key_encrypted: string | null; api_key_last_four: string | null }, []>(
        "SELECT api_key_encrypted, api_key_last_four FROM user_settings",
      )
      .get();
  } finally {
    sqlite.close();
  }
}

/** The Grader's read of the User's settings, through a repository on the app's data directory. */
function graderSettings(encryptionKey?: string) {
  const database = openDatabase(dataDir());
  try {
    const user = createUserRepository(database.db).find();
    if (user === undefined) throw new Error("No User");
    const cipher = createApiKeyCipher(loadEncryptionKey({ dataDir: dataDir(), encryptionKey }));
    return createSettingsRepository(database.db, cipher).graderSettings(user.id);
  } finally {
    database.close();
  }
}

describe("PUT /api/settings/api-key", () => {
  test("stores a key OpenRouter accepts, encrypted, with its last four characters", async () => {
    const { fetch, asked } = openRouter(200);
    const { app, cookie } = await signedIn({ openRouterFetch: fetch });

    const res = await putKey(app, API_KEY, cookie);

    expect(res.status).toBe(200);
    expect((await settingsOf(res)).apiKey).toEqual({ state: "set", lastFour: "3f9a" });
    expect(asked).toEqual([API_KEY]);
    const row = storedRow();
    expect(row?.api_key_last_four).toBe("3f9a");
    expect(row?.api_key_encrypted).toMatch(/^v1\.[\w-]+$/);
    expect(row?.api_key_encrypted).not.toContain(API_KEY);
    expect(
      Buffer.from(row?.api_key_encrypted?.slice(3) ?? "", "base64url").toString("latin1"),
    ).not.toContain(API_KEY);
  });

  test("encrypts with a fresh nonce on every save, even of the same key", async () => {
    const { app, cookie } = await signedIn();

    await putKey(app, API_KEY, cookie);
    const first = storedRow()?.api_key_encrypted;
    await putKey(app, API_KEY, cookie);

    expect(storedRow()?.api_key_encrypted).not.toBe(first);
  });

  test("trims the key before checking and storing it", async () => {
    const { fetch, asked } = openRouter(200);
    const { app, cookie } = await signedIn({ openRouterFetch: fetch });

    const res = await putKey(app, `  ${API_KEY}\n`, cookie);

    expect((await settingsOf(res)).apiKey).toEqual({ state: "set", lastFour: "3f9a" });
    expect(asked).toEqual([API_KEY]);
    expect(graderSettings().apiKey).toBe(API_KEY);
  });

  test("replaces a stored key", async () => {
    const { app, cookie } = await signedIn();
    await putKey(app, API_KEY, cookie);

    const res = await putKey(app, "sk-or-v1-another-key-0042", cookie);

    expect((await settingsOf(res)).apiKey).toEqual({ state: "set", lastFour: "0042" });
    expect(graderSettings().apiKey).toBe("sk-or-v1-another-key-0042");
  });

  test("doesn't store a key OpenRouter refuses (401), saying so", async () => {
    const { app, cookie } = await signedIn({ openRouterFetch: openRouter(401).fetch });

    const res = await putKey(app, API_KEY, cookie);

    expect(res.status).toBe(422);
    expect(await errorOf(res)).toEqual({
      code: "api_key_refused",
      message: "OpenRouter didn't accept this key.",
    });
    expect(storedRow()).toBeNull();
    expect((await settingsOf(await get(app, "/api/settings", cookie))).apiKey).toEqual({
      state: "unset",
    });
  });

  test("keeps the key already stored when OpenRouter refuses a new one", async () => {
    let status = 200;
    const fetch: OpenRouterFetch = async () => new Response("{}", { status });
    const { app, cookie } = await signedIn({ openRouterFetch: fetch });
    await putKey(app, API_KEY, cookie);
    status = 401;

    expect((await putKey(app, "sk-or-v1-wrong-0000", cookie)).status).toBe(422);
    expect(graderSettings().apiKey).toBe(API_KEY);
  });

  test.each([
    ["any other status", openRouter(500).fetch],
    ["a 403", openRouter(403).fetch],
    ["no answer at all", unreachableOpenRouter],
  ])(
    "doesn't store a key when OpenRouter answers with %s, asking to try again",
    async (_, fetch) => {
      const { app, cookie } = await signedIn({ openRouterFetch: fetch });

      const res = await putKey(app, API_KEY, cookie);

      expect(res.status).toBe(502);
      expect(await errorOf(res)).toEqual({
        code: "openrouter_unreachable",
        message: "Couldn't reach OpenRouter. Try again.",
      });
      expect(storedRow()).toBeNull();
    },
  );

  test.each([
    ["an empty key", ""],
    ["a key of only spaces", "   "],
    ["a key over 200 characters", "k".repeat(201)],
    ["a key that isn't a string", 42],
  ])("refuses %s with 400 before OpenRouter is called", async (_, apiKey) => {
    const { fetch, asked } = openRouter(200);
    const { app, cookie } = await signedIn({ openRouterFetch: fetch });

    const res = await putKey(app, apiKey, cookie);

    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe("invalid_request");
    expect(asked).toEqual([]);
    expect(storedRow()).toBeNull();
  });

  test("takes a key of exactly 200 characters", async () => {
    const { app, cookie } = await signedIn();

    expect((await putKey(app, "k".repeat(200), cookie)).status).toBe(200);
  });

  test("answers 401 when signed out, without calling OpenRouter", async () => {
    const { fetch, asked } = openRouter(200);
    const { app } = await signedIn({ openRouterFetch: fetch });

    expect((await send(app, "PUT", "/api/settings/api-key", { apiKey: API_KEY })).status).toBe(401);
    expect(asked).toEqual([]);
  });
});

describe("DELETE /api/settings/api-key", () => {
  test("deletes the stored key, which then reads as unset", async () => {
    const { app, cookie } = await signedIn();
    await putKey(app, API_KEY, cookie);

    const res = await send(app, "DELETE", "/api/settings/api-key", undefined, cookie);

    expect(res.status).toBe(200);
    expect((await settingsOf(res)).apiKey).toEqual({ state: "unset" });
    expect(storedRow()).toEqual({ api_key_encrypted: null, api_key_last_four: null });
    expect(graderSettings().apiKey).toBeUndefined();
  });

  test("leaves the other Settings alone", async () => {
    const { app, cookie } = await signedIn();
    await send(app, "PATCH", "/api/settings", { model: "openai/gpt-6-luna" }, cookie);
    await putKey(app, API_KEY, cookie);

    const res = await send(app, "DELETE", "/api/settings/api-key", undefined, cookie);

    expect((await settingsOf(res)).model).toBe("openai/gpt-6-luna");
  });

  test("is fine with no key stored", async () => {
    const { app, cookie } = await signedIn();

    const res = await send(app, "DELETE", "/api/settings/api-key", undefined, cookie);

    expect(res.status).toBe(200);
    expect((await settingsOf(res)).apiKey).toEqual({ state: "unset" });
  });

  test("answers 401 when signed out", async () => {
    const { app } = await signedIn();

    expect((await send(app, "DELETE", "/api/settings/api-key", undefined)).status).toBe(401);
  });
});

describe("an API key stored under another encryption key", () => {
  test("reads as unreadable, and as unset for the Grader", async () => {
    const first = await signedIn({ encryptionKey: KEY_A });
    await putKey(first.app, API_KEY, first.cookie);
    first.close();

    const { app } = boot({ encryptionKey: KEY_B });
    const res = await get(app, "/api/settings", first.cookie);

    expect((await settingsOf(res)).apiKey).toEqual({ state: "unreadable" });
    expect(graderSettings(KEY_B).apiKey).toBeUndefined();
    expect(graderSettings(KEY_A).apiKey).toBe(API_KEY);
  });

  test("can be entered again", async () => {
    const first = await signedIn({ encryptionKey: KEY_A });
    await putKey(first.app, API_KEY, first.cookie);
    first.close();

    const { app } = boot({ encryptionKey: KEY_B }, { openRouterFetch: openRouter(200).fetch });
    const res = await putKey(app, API_KEY, first.cookie);

    expect((await settingsOf(res)).apiKey).toEqual({ state: "set", lastFour: "3f9a" });
    expect(graderSettings(KEY_B).apiKey).toBe(API_KEY);
  });
});

describe("the Model", () => {
  test("changes with PATCH and reads back", async () => {
    const { app, cookie } = await signedIn();

    const res = await send(
      app,
      "PATCH",
      "/api/settings",
      { model: "google/gemini-3.8-flash" },
      cookie,
    );

    expect(res.status).toBe(200);
    expect((await settingsOf(res)).model).toBe("google/gemini-3.8-flash");
    expect((await settingsOf(await get(app, "/api/settings", cookie))).model).toBe(
      "google/gemini-3.8-flash",
    );
    expect(graderSettings().model).toBe("google/gemini-3.8-flash");
  });

  test("can be changed with no API key set", async () => {
    const { app, cookie } = await signedIn();

    const res = await send(app, "PATCH", "/api/settings", { model: "openai/gpt-6-luna" }, cookie);

    expect(await settingsOf(res)).toMatchObject({
      model: "openai/gpt-6-luna",
      apiKey: { state: "unset" },
    });
  });

  test("refuses a Model not on the list with 400 invalid_request, changing nothing", async () => {
    const { app, cookie } = await signedIn();

    const res = await send(app, "PATCH", "/api/settings", { model: "openai/gpt-4o" }, cookie);

    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe("invalid_request");
    expect((await settingsOf(await get(app, "/api/settings", cookie))).model).toBe(
      "anthropic/claude-haiku-5.5",
    );
  });

  test("reads back as the default when the stored one is no longer on the list", async () => {
    const { app, cookie } = await signedIn();
    await send(app, "PATCH", "/api/settings", { model: "openai/gpt-6-luna" }, cookie);
    const sqlite = new SQLite(join(dataDir(), "banki.db"));
    sqlite.run("UPDATE user_settings SET model = 'retired/model-from-an-old-release'");
    sqlite.close();

    expect((await settingsOf(await get(app, "/api/settings", cookie))).model).toBe(
      "anthropic/claude-haiku-5.5",
    );
    expect(graderSettings().model).toBe("anthropic/claude-haiku-5.5");
  });

  test("is the default for the Grader when nothing is stored", async () => {
    await signedIn();

    expect(graderSettings()).toEqual({ apiKey: undefined, model: "anthropic/claude-haiku-5.5" });
  });
});

describe("no settings route", () => {
  test("ever answers with the API key, plain or encrypted", async () => {
    const { app, cookie } = await signedIn();
    const bodies: string[] = [];
    const record = async (res: Response) => {
      expect(res.status).toBe(200);
      bodies.push(await res.text());
    };

    await record(await putKey(app, API_KEY, cookie));
    const encrypted = storedRow()?.api_key_encrypted ?? "";
    await record(await get(app, "/api/settings", cookie));
    await record(await send(app, "PATCH", "/api/settings", { dayStartHour: 6 }, cookie));
    await record(await send(app, "PATCH", "/api/settings", { model: "openai/gpt-6-luna" }, cookie));
    await record(
      await send(app, "PUT", "/api/settings/timezone/initial", { timezone: "Asia/Tokyo" }, cookie),
    );
    await record(await putKey(app, API_KEY, cookie));
    const encryptedAgain = storedRow()?.api_key_encrypted ?? "";
    await record(await send(app, "DELETE", "/api/settings/api-key", undefined, cookie));

    expect(encrypted).not.toBe("");
    for (const body of bodies) {
      expect(body).not.toContain(API_KEY);
      expect(body).not.toContain(API_KEY.slice(0, -4));
      expect(body).not.toContain(encrypted);
      expect(body).not.toContain(encryptedAgain);
      expect(body).not.toContain("v1.");
    }
    // What Settings may show: whether it is set, and its last four characters.
    expect(JSON.parse(bodies[1] ?? "")).toMatchObject({
      apiKey: { state: "set", lastFour: "3f9a" },
    });
  });
});
