import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { SettingsResponse } from "@banki/shared";
import { EMAIL, PASSWORD, bootApps, cookiesFrom, get, signIn } from "../testing/app";
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

  test("refuses once the User has Settings stored, which it would overwrite", async () => {
    await setup();
    await seed();

    const again = await seed();

    expect(again.exitCode).toBe(1);
    expect(again.stderr).toContain("The User already has content, so nothing was seeded.");
  });
});
