import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { EMAIL, PASSWORD, bootApps } from "../testing/app";
import { runCli } from "../testing/cli";

// These run the real CLI in a child process against a temporary data
// directory, migrated from scratch by the CLI itself.

const { boot, dataDir } = bootApps();

const seed = () => runCli(["seed"], { dataDir: dataDir() });

describe("banki seed", () => {
  test("exits 1 before Setup, pointing to banki setup", async () => {
    const result = await seed();

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Banki isn't set up yet, so there's nothing to seed.");
    expect(result.stderr).toContain("banki setup");
  });

  test("loads the Seed data into a freshly migrated database after banki setup", async () => {
    const setup = await runCli(["setup", "--email", EMAIL, "--password-stdin"], {
      dataDir: dataDir(),
      stdin: `${PASSWORD}\n`,
    });
    expect(setup.exitCode).toBe(0);

    const result = await seed();

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Seed data loaded.");
  });

  test("applies pending migrations to a data directory the API never opened", async () => {
    expect(existsSync(dataDir())).toBe(false);

    await seed();

    expect(boot().appliedMigrations).toEqual([]);
  });
});
