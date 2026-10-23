import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { SettingsResponse } from "@banki/shared";
import { EMAIL, ORIGIN, PASSWORD, bootApps, cookiesFrom, get, signIn } from "../testing/app";
import { runCli } from "../testing/cli";

// These run the real CLI in a child process against a temporary data
// directory, migrated from scratch by the CLI itself.

const { boot, dataDir } = bootApps();

const seed = () => runCli(["seed"], { dataDir: dataDir() });
const setup = () =>
  runCli(["setup", "--email", EMAIL, "--password-stdin"], {
    dataDir: dataDir(),
    stdin: `${PASSWORD}\n`,
  });

describe("banki seed", () => {
  test("exits 1 before Setup, pointing to banki setup", async () => {
    const result = await seed();

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Banki isn't set up yet, so there's nothing to seed.");
    expect(result.stderr).toContain("banki setup");
  });

  test("loads the Seed data into a freshly migrated database after banki setup", async () => {
    expect((await setup()).exitCode).toBe(0);

    const result = await seed();

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Seed data loaded.");
  });

  test("applies pending migrations to a data directory the API never opened", async () => {
    expect(existsSync(dataDir())).toBe(false);

    await seed();

    expect(boot().appliedMigrations).toEqual([]);
  });

  test("stores the Timezone Europe/Warsaw for the User, keeping the default Day start", async () => {
    await setup();
    await seed();

    const { app } = boot();
    const res = await get(app, "/api/settings", cookiesFrom(await signIn(app)));

    expect(SettingsResponse.parse(await res.json())).toEqual({
      timezone: "Europe/Warsaw",
      dayStartHour: 4,
    });
  });

  test("leaves a Timezone already stored alone, such as the first fill's", async () => {
    await setup();
    const { app, close } = boot();
    const cookie = cookiesFrom(await signIn(app));
    await app.request("/api/settings/timezone/initial", {
      method: "PUT",
      headers: { "content-type": "application/json", origin: ORIGIN, cookie },
      body: JSON.stringify({ timezone: "Asia/Tokyo" }),
    });
    close();

    const result = await seed();

    expect(result.exitCode).toBe(0);
    const { app: after } = boot();
    const res = await get(after, "/api/settings", cookiesFrom(await signIn(after)));
    expect(SettingsResponse.parse(await res.json())).toEqual({
      timezone: "Asia/Tokyo",
      dayStartHour: 4,
    });
  });
});
