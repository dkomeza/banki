import { afterEach, beforeEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../app";
import type { Config } from "../config";
import type { OpenRouterFetch } from "../openrouter/check-api-key";

export const ORIGIN = "http://localhost:5173";
export const EMAIL = "user@example.com";
export const PASSWORD = "correct horse battery staple";

/**
 * Boots apps against data directories inside a per-test temp dir, closing
 * them and removing the dir after each test.
 */
export function bootApps() {
  let tempDir: string;
  const opened: Array<{ close: () => void }> = [];

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "banki-api-"));
  });

  afterEach(() => {
    for (const booted of opened.splice(0)) booted.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  return {
    dataDir: () => join(tempDir, "data"),
    /**
     * Boots an app. OpenRouter is stubbed: unless `openRouterFetch` says
     * otherwise, it can't be reached, so no test calls the real service.
     */
    boot: (
      overrides: Partial<Config> = {},
      { openRouterFetch = unreachableOpenRouter }: { openRouterFetch?: OpenRouterFetch } = {},
    ) => {
      const booted = createApp(
        {
          dataDir: join(tempDir, "data"),
          port: 3000,
          logFormat: "json",
          logLevel: "info",
          origin: ORIGIN,
          authSecret: undefined,
          encryptionKey: undefined,
          commit: "dev",
          ...overrides,
        },
        { openRouterFetch },
      );
      opened.push(booted);
      return booted;
    },
  };
}

/** OpenRouter as a test sees it by default: never reachable. */
export const unreachableOpenRouter: OpenRouterFetch = async () => {
  throw new TypeError("Tests never reach the real OpenRouter");
};

export type App = ReturnType<typeof createApp>["app"];

// better-auth keeps its rate-limit counters in one module-level map for the
// whole test run, so every test gets an IP of its own.
let nextIp = 0;
export const freshIp = () => {
  nextIp += 1;
  return `198.51.${Math.floor(nextIp / 250)}.${(nextIp % 250) + 1}`;
};

/** The `name=value` part of each cookie a response sets, joined for a Cookie header. */
export const cookiesFrom = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");

export const post = (
  app: App,
  path: string,
  body: unknown,
  { ip = freshIp(), headers = {} }: { ip?: string; headers?: Record<string, string> } = {},
) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip, ...headers },
    body: JSON.stringify(body),
  });

export const get = (app: App, path: string, cookie?: string) =>
  app.request(path, { headers: cookie === undefined ? {} : { cookie } });

/** Does Setup with the default Email and Password and returns the signed-in cookie. */
export async function setUp(
  { app, setupToken }: { app: App; setupToken: { value: string } | undefined },
  { email = EMAIL, password = PASSWORD } = {},
) {
  if (setupToken === undefined) throw new Error("This app has no Setup token");
  const res = await post(app, "/api/setup", { token: setupToken.value, email, password });
  if (res.status !== 204) throw new Error(`Setup answered ${res.status}: ${await res.text()}`);
  return cookiesFrom(res);
}

export const signIn = (
  app: App,
  { email = EMAIL, password = PASSWORD, ip = freshIp(), headers = {} } = {},
) => post(app, "/api/auth/sign-in/email", { email, password }, { ip, headers });
