import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { MeResponse, SetupStatus } from "@banki/shared";
import {
  bootApps,
  cookiesFrom,
  EMAIL,
  get,
  ORIGIN,
  PASSWORD,
  post,
  setUp as setUpViaPage,
  signIn,
} from "../testing/app";
import { runCli } from "../testing/cli";

// These run the real CLI in a child process against a temporary data
// directory, then check the result through an app booted against it.

const { boot, dataDir } = bootApps();

const setup = (args: string[], stdin?: string, env?: Record<string, string>) =>
  runCli(["setup", ...args], { dataDir: dataDir(), stdin, env });

const scripted = (email: string, stdin: string) =>
  setup(["--email", email, "--password-stdin"], stdin);

const setUpStatus = async () =>
  SetupStatus.parse(await (await get(boot().app, "/api/setup")).json()).setUp;

describe("banki setup --email --password-stdin", () => {
  test("creates the User, prints the Email and ORIGIN, and the Email and Password sign in", async () => {
    const result = await scripted(EMAIL, `${PASSWORD}\n`);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`Banki is set up for ${EMAIL}. Sign in at ${ORIGIN}`);
    const res = await signIn(boot().app);
    expect(res.status).toBe(200);
  });

  test("creates no auth-secret in the data directory", async () => {
    expect((await scripted(EMAIL, `${PASSWORD}\n`)).exitCode).toBe(0);

    expect(existsSync(join(dataDir(), "banki.db"))).toBe(true);
    expect(existsSync(join(dataDir(), "auth-secret"))).toBe(false);
  });

  test("stores the Email trimmed and lowercased", async () => {
    const result = await scripted("  Someone@Example.COM ", `${PASSWORD}\n`);

    expect(result.stdout).toContain("Banki is set up for someone@example.com.");
    const { app } = boot();
    const res = await signIn(app, { email: "someone@example.com" });
    expect(res.status).toBe(200);
    const me = await get(app, "/api/me", cookiesFrom(res));
    expect(MeResponse.parse(await me.json())).toEqual({ email: "someone@example.com" });
  });

  test("takes the first line of stdin without its \\r\\n", async () => {
    expect((await scripted(EMAIL, `${PASSWORD}\r\nsecond line\n`)).exitCode).toBe(0);

    expect((await signIn(boot().app)).status).toBe(200);
  });

  test("accepts a last line with no newline", async () => {
    expect((await scripted(EMAIL, PASSWORD)).exitCode).toBe(0);

    expect((await signIn(boot().app)).status).toBe(200);
  });

  test("prints the Sign in link on ORIGIN", async () => {
    const result = await setup(["--email", EMAIL, "--password-stdin"], `${PASSWORD}\n`, {
      ORIGIN: "https://banki.example.com",
    });

    expect(result.stdout).toContain("Sign in at https://banki.example.com");
  });

  test("--password-stdin without --email exits 1 and writes nothing", async () => {
    const result = await setup(["--password-stdin"], `${PASSWORD}\n`);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--password-stdin needs --email.");
    expect(existsSync(dataDir())).toBe(false);
  });

  test.each([
    ["an invalid Email", "not-an-email", PASSWORD, "Expected an email address"],
    ["a 7-character Password", EMAIL, "1234567", "Expected at least 8 characters"],
    ["a 129-character Password", EMAIL, "x".repeat(129), "Expected at most 128 characters"],
    ["an empty Password", EMAIL, "", "Expected at least 8 characters"],
  ])(
    "exits 1 with the schema's message for %s, and writes nothing",
    async (_, email, password, message) => {
      const result = await scripted(email, `${password}\n`);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(message);
      expect(existsSync(dataDir())).toBe(false);
    },
  );

  test("exits 1 with the schema's message for an invalid Password when an app has already opened the data directory", async () => {
    boot();

    const result = await scripted(EMAIL, "short\n");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Expected at least 8 characters");
    expect(await setUpStatus()).toBe(false);
  });

  test("a second run exits 1 and leaves the Email and Password unchanged", async () => {
    expect((await scripted(EMAIL, `${PASSWORD}\n`)).exitCode).toBe(0);

    const again = await scripted("other@example.com", "another long passphrase\n");

    expect(again.exitCode).toBe(1);
    expect(again.stderr).toContain("Banki is already set up, nothing changed.");
    const { app } = boot();
    expect((await signIn(app)).status).toBe(200);
    expect(
      (await signIn(app, { email: "other@example.com", password: "another long passphrase" }))
        .status,
    ).toBe(401);
    expect((await signIn(app, { password: "another long passphrase" })).status).toBe(401);
  });

  test("refuses when Setup was done on the Setup page", async () => {
    const booted = boot();
    await setUpViaPage(booted);

    const result = await scripted("other@example.com", `${PASSWORD}\n`);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Banki is already set up, nothing changed.");
  });

  test("afterwards the API boots set up: no Setup token, and GET /api/setup says setUp: true", async () => {
    expect((await scripted(EMAIL, `${PASSWORD}\n`)).exitCode).toBe(0);

    const booted = boot();

    expect(booted.setupToken).toBeUndefined();
    expect(await setUpStatus()).toBe(true);
  });

  test("an API already waiting for Setup answers 409 already_set_up afterwards", async () => {
    const booted = boot();
    const token = booted.setupToken?.value;

    expect((await scripted(EMAIL, `${PASSWORD}\n`)).exitCode).toBe(0);

    const res = await post(booted.app, "/api/setup", { token, email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(409);
  });

  test("applies pending migrations to a data directory the API never opened", async () => {
    expect(existsSync(dataDir())).toBe(false);

    expect((await scripted(EMAIL, `${PASSWORD}\n`)).exitCode).toBe(0);

    // The app finds every migration already applied, and the User in place.
    const booted = boot();
    expect(booted.appliedMigrations).toEqual([]);
    expect(booted.setupToken).toBeUndefined();
  });
});
