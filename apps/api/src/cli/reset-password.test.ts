import { describe, expect, test } from "bun:test";
import { bootApps, cookiesFrom, EMAIL, get, PASSWORD, setUp, signIn } from "../testing/app";
import { runCli } from "../testing/cli";

// These run the real CLI in a child process, against the data directory of
// an app booted in this process, the way the CLI runs beside a running API.

const { boot, dataDir } = bootApps();

const NEW_PASSWORD = "a brand new passphrase";

const resetPassword = (stdin: string, env: Record<string, string> = {}) =>
  runCli(["reset-password", "--password-stdin"], { dataDir: dataDir(), stdin, env });

describe("banki reset-password --password-stdin", () => {
  test("sets the new Password, signs out every device and prints the Email", async () => {
    const booted = boot();
    const setupCookie = await setUp(booted);
    const signInCookie = cookiesFrom(await signIn(booted.app));

    const result = await resetPassword(`${NEW_PASSWORD}\n`);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(EMAIL);
    expect((await get(booted.app, "/api/me", setupCookie)).status).toBe(401);
    expect((await get(booted.app, "/api/me", signInCookie)).status).toBe(401);
    expect((await signIn(booted.app, { password: PASSWORD })).status).toBe(401);
    expect((await signIn(booted.app, { password: NEW_PASSWORD })).status).toBe(200);
  });

  test("takes the line without its line ending, and only the first line", async () => {
    const booted = boot();
    await setUp(booted);

    expect((await resetPassword(`${NEW_PASSWORD}\r\nsecond line\n`)).exitCode).toBe(0);
    expect((await signIn(booted.app, { password: NEW_PASSWORD })).status).toBe(200);
  });

  test("accepts a last line with no newline", async () => {
    const booted = boot();
    await setUp(booted);

    expect((await resetPassword(NEW_PASSWORD)).exitCode).toBe(0);
    expect((await signIn(booted.app, { password: NEW_PASSWORD })).status).toBe(200);
  });

  test.each([
    ["too short", "1234567"],
    ["too long", "x".repeat(129)],
    ["empty", ""],
  ])("exits 1 and changes nothing when the Password is %s", async (_, candidate) => {
    const booted = boot();
    const cookie = await setUp(booted);

    const result = await resetPassword(`${candidate}\n`);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("8 to 128 characters");
    expect((await get(booted.app, "/api/me", cookie)).status).toBe(200);
    expect((await signIn(booted.app, { password: PASSWORD })).status).toBe(200);
  });

  test("exits 1 and points to Setup on ORIGIN when there is no User", async () => {
    boot();

    const result = await resetPassword(`${NEW_PASSWORD}\n`, {
      ORIGIN: "https://banki.example.com",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("https://banki.example.com/setup");
  });

  test("applies pending migrations to a data directory the API never opened", async () => {
    const result = await resetPassword(`${NEW_PASSWORD}\n`);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("isn't set up yet");
  });
});
