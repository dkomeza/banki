import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiError, HealthResponse } from "@banki/shared";
import { createApp } from "./app";
import type { Config } from "./config";
import { captureLogs } from "./testing/logs";

let tempDir: string;
const opened: Array<{ close: () => void }> = [];

const configFor = (dataDir: string): Config => ({
  dataDir,
  port: 3000,
  logFormat: "json",
  logLevel: "info",
  origin: "http://localhost:5173",
  authSecret: undefined,
  commit: "dev",
});

/** Boots the app the way the server does, against a data directory inside this test's temp dir. */
const boot = (dataDir = join(tempDir, "data"), overrides: Partial<Config> = {}) => {
  const booted = createApp({ ...configFor(dataDir), ...overrides });
  opened.push(booted);
  return booted;
};

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "banki-api-"));
});

afterEach(() => {
  for (const booted of opened.splice(0)) booted.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("the data directory", () => {
  test("is created with banki.db and an empty uploads/ when missing", () => {
    const dataDir = join(tempDir, "nested", "data");

    boot(dataDir);

    expect(statSync(join(dataDir, "banki.db")).isFile()).toBe(true);
    expect(statSync(join(dataDir, "uploads")).isDirectory()).toBe(true);
    expect(readdirSync(join(dataDir, "uploads"))).toEqual([]);
  });

  test("gets an auth-secret on the first boot, unless AUTH_SECRET is set", () => {
    const withFile = join(tempDir, "with-file");
    const withEnv = join(tempDir, "with-env");

    boot(withFile);
    boot(withEnv, { authSecret: "s".repeat(32) });

    expect(statSync(join(withFile, "auth-secret")).mode & 0o777).toBe(0o600);
    expect(existsSync(join(withEnv, "auth-secret"))).toBe(false);
  });

  test("an empty auth-secret fails the boot", () => {
    const dataDir = join(tempDir, "data");
    mkdirSync(dataDir);
    writeFileSync(join(dataDir, "auth-secret"), "");

    expect(() => boot(dataDir)).toThrow(/auth-secret.*empty/);
  });

  test("is reused as is when it already exists", () => {
    const dataDir = join(tempDir, "data");
    boot(dataDir).close();

    boot(dataDir);

    expect(existsSync(join(dataDir, "banki.db"))).toBe(true);
  });
});

describe("migrations", () => {
  test("the first boot applies the baseline and a second boot applies nothing", () => {
    const dataDir = join(tempDir, "data");

    const first = boot(dataDir);
    expect(first.appliedMigrations).toEqual(["0000_baseline", "0001_auth"]);
    first.close();

    expect(boot(dataDir).appliedMigrations).toEqual([]);
  });
});

describe("GET /api/health", () => {
  test("answers 200 with a body matching HealthResponse", async () => {
    const { app } = boot();

    const res = await app.request("/api/health");

    expect(res.status).toBe(200);
    expect(HealthResponse.parse(await res.json())).toEqual({
      status: "ok",
      database: "ok",
      commit: "dev",
    });
  });

  test("reports the commit the API was built from", async () => {
    const commit = "0123456789abcdef0123456789abcdef01234567";
    const { app } = boot(undefined, { commit });

    const res = await app.request("/api/health");

    expect(HealthResponse.parse(await res.json()).commit).toBe(commit);
  });

  test("answers 503 database_unreachable once the database is closed", async () => {
    const { app, close } = boot();
    close();

    const res = await app.request("/api/health");

    expect(res.status).toBe(503);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe("database_unreachable");
  });
});

describe("HealthResponse", () => {
  const healthy = { status: "ok", database: "ok" } as const;

  test.each(["dev", "0123456789abcdef0123456789abcdef01234567"])("accepts commit %p", (commit) => {
    expect(HealthResponse.parse({ ...healthy, commit })).toEqual({ ...healthy, commit });
  });

  test("rejects a body without a commit", () => {
    expect(HealthResponse.safeParse(healthy).success).toBe(false);
  });

  test("rejects an empty commit", () => {
    expect(HealthResponse.safeParse({ ...healthy, commit: "" }).success).toBe(false);
  });
});

describe("unmatched paths", () => {
  test.each(["/health", "/"])("%s answers a JSON 404 not_found", async (path) => {
    const { app } = boot();

    const res = await app.request(path);

    expect(res.status).toBe(404);
    expect(ApiError.parse(await res.json())).toEqual({
      error: { code: "not_found", message: "Not found" },
    });
  });

  test("a known path with the wrong method is unknown, so 401 when signed out", async () => {
    const { app } = boot();

    const res = await app.request("/api/health", { method: "DELETE" });

    expect(res.status).toBe(401);
    expect(ApiError.parse(await res.json()).error.code).toBe("unauthorized");
  });
});

describe("request logs", () => {
  const records = captureLogs();
  const requestLogs = () =>
    records
      .filter((record) => record.category.join(".") === "banki.http")
      .map(({ level, properties }) => ({ level, ...properties }));

  test("a successful health check is logged at debug", async () => {
    const { app } = boot();

    await (await app.request("/api/health")).json();

    expect(requestLogs()).toEqual([
      expect.objectContaining({
        level: "debug",
        method: "GET",
        path: "/api/health",
        status: 200,
        responseTime: expect.any(Number),
      }),
    ]);
  });

  test("an unhealthy health check is logged at info", async () => {
    const { app, close } = boot();
    close();

    await (await app.request("/api/health")).json();

    expect(requestLogs()).toEqual([
      expect.objectContaining({ level: "info", path: "/api/health", status: 503 }),
    ]);
  });

  test("any other request is logged at info with method, path, status and duration", async () => {
    const { app } = boot();

    await (await app.request("/api/nope", { method: "POST" })).json();

    expect(requestLogs()).toEqual([
      expect.objectContaining({
        level: "info",
        method: "POST",
        path: "/api/nope",
        status: 401,
        responseTime: expect.any(Number),
      }),
    ]);
  });
});
