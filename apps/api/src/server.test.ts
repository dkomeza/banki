import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HealthResponse } from "@banki/shared";
import { z } from "zod";

// These run the real server entry in a child process, since exit codes,
// signals and the configured log output only exist at that level.

const entry = join(import.meta.dir, "server.ts");
let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "banki-server-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

const startServer = (env: Record<string, string>) =>
  Bun.spawn(["bun", entry], {
    env: { PATH: process.env.PATH, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });

const freePort = () => {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() });
  const { port } = probe;
  void probe.stop(true);
  if (port === undefined) throw new Error("no port");
  return port;
};

const waitForHealth = async (port: number): Promise<Response> => {
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      return await fetch(`http://localhost:${port}/api/health`);
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await Bun.sleep(25);
    }
  }
};

const JsonRecord = z.object({
  level: z.string(),
  message: z.string(),
  properties: z.record(z.string(), z.unknown()),
});
const jsonLines = (text: string) =>
  text
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JsonRecord.parse(JSON.parse(line)));

describe("the server process", () => {
  test("serves health, logs its lifecycle and exits 0 on SIGTERM", async () => {
    const dataDir = join(tempDir, "data");
    const port = freePort();
    const server = startServer({ DATA_DIR: dataDir, PORT: String(port) });

    const res = await waitForHealth(port);
    expect(HealthResponse.parse(await res.json())).toEqual({ status: "ok", database: "ok" });

    server.kill("SIGTERM");
    expect(await server.exited).toBe(0);

    const records = jsonLines(await new Response(server.stdout).text());
    const migrations = ["0000_baseline", "0001_auth"];
    expect(records.map(({ level, message, properties }) => [level, message, properties])).toEqual([
      ["INFO", `API starting "${dataDir}"`, { dataDir }],
      ["INFO", `Migrations applied ${JSON.stringify(migrations)}`, { migrations }],
      ["INFO", `Listening ${port}`, { port }],
      ["INFO", 'Shutting down "SIGTERM"', { signal: "SIGTERM" }],
    ]);
  });

  test("exits 0 on SIGINT too, and a second boot applies no migrations", async () => {
    const dataDir = join(tempDir, "data");
    const boot = async (signal: "SIGINT" | "SIGTERM") => {
      const port = freePort();
      const server = startServer({ DATA_DIR: dataDir, PORT: String(port) });
      await waitForHealth(port);
      server.kill(signal);
      return {
        exitCode: await server.exited,
        records: jsonLines(await new Response(server.stdout).text()),
      };
    };

    expect((await boot("SIGINT")).exitCode).toBe(0);

    const second = await boot("SIGTERM");
    expect(second.exitCode).toBe(0);
    expect(second.records.find((r) => r.message.startsWith("Migrations applied"))).toMatchObject({
      message: "Migrations applied []",
      properties: { migrations: [] },
    });
  });

  test("logs a fresh Setup token and a link to Setup on ORIGIN at every start", async () => {
    const dataDir = join(tempDir, "data");
    const setupLog = async () => {
      const port = freePort();
      const server = startServer({
        DATA_DIR: dataDir,
        PORT: String(port),
        ORIGIN: "https://banki.example.com/",
      });
      await waitForHealth(port);
      server.kill("SIGTERM");
      await server.exited;
      // Warnings go to stderr.
      const records = jsonLines(await new Response(server.stderr).text());
      const record = records.find((r) => r.level === "WARN");
      return z.object({ setupUrl: z.string(), setupToken: z.string() }).parse(record?.properties);
    };

    const first = await setupLog();
    const second = await setupLog();

    expect(first.setupToken).toMatch(/^[\w-]{43}$/);
    expect(first.setupUrl).toBe(`https://banki.example.com/setup?token=${first.setupToken}`);
    expect(second.setupToken).not.toBe(first.setupToken);
  });

  test("exits 1 with a prettified message on invalid config", async () => {
    const server = startServer({
      DATA_DIR: tempDir,
      PORT: "http",
      LOG_FORMAT: "xml",
      ORIGIN: "https://banki.example.com/banki",
    });

    expect(await server.exited).toBe(1);
    const stderr = await new Response(server.stderr).text();
    expect(stderr).toContain("Invalid configuration:");
    expect(stderr).toContain("→ at PORT");
    expect(stderr).toContain("→ at LOG_FORMAT");
    expect(stderr).toContain("→ at ORIGIN");
  });

  test("exits 1 and logs why when the auth secret is empty", async () => {
    const dataDir = join(tempDir, "data");
    mkdirSync(dataDir);
    writeFileSync(join(dataDir, "auth-secret"), "");
    const server = startServer({ DATA_DIR: dataDir, PORT: String(freePort()) });

    expect(await server.exited).toBe(1);
    const failure = jsonLines(await new Response(server.stderr).text()).find(
      (record) => record.level === "ERROR",
    );
    expect(failure?.message).toStartWith("API failed to start");
    expect(JSON.stringify(failure?.properties)).toContain("is empty");
  });

  test("exits 1 and logs why when the data directory can't be created", async () => {
    const notADirectory = join(tempDir, "file");
    writeFileSync(notADirectory, "");
    const server = startServer({ DATA_DIR: join(notADirectory, "data"), PORT: String(freePort()) });

    expect(await server.exited).toBe(1);
    const failure = jsonLines(await new Response(server.stderr).text()).find(
      (record) => record.level === "ERROR",
    );
    expect(failure?.message).toStartWith("API failed to start");
  });
});
