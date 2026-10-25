import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { DeckListResponse, DeckResponse, SettingsResponse } from "@banki/shared";
import { SEED_IDS } from "../seed/seed-ids";
import { EMAIL, ORIGIN, PASSWORD, bootApps, cookiesFrom, get, signIn } from "../testing/app";
import { runCli } from "../testing/cli";

// These run the real CLI in a child process against a temporary data
// directory, migrated from scratch by the CLI itself.

/** What a User who hasn't touched the Grading card has. */
const GRADING_DEFAULTS = {
  model: "anthropic/claude-haiku-5.5",
  apiKey: { state: "unset" },
} as const;

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
      ...GRADING_DEFAULTS,
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
      ...GRADING_DEFAULTS,
    });
  });
});

describe("banki seed's Decks", () => {
  test("loads the five Decks, with their fixed IDs, created at different times", async () => {
    await setup();
    await seed();

    const { app } = boot();
    const res = await get(app, "/api/decks", cookiesFrom(await signIn(app)));
    const decks = DeckListResponse.parse(await res.json());

    expect(decks.map((deck) => deck.id).toSorted()).toEqual(
      Object.values(SEED_IDS.decks).toSorted(),
    );
    expect(decks.find((deck) => deck.id === SEED_IDS.deck)?.name).toBe("Spanish vocabulary");
    expect(new Set(decks.map((deck) => deck.createdAt)).size).toBe(5);
    expect(decks.map((deck) => deck.name)).toEqual(
      expect.arrayContaining(["Calculus 2", "Calculus 10"]),
    );
    expect(decks.some((deck) => deck.description === null)).toBe(true);
    expect(decks.some((deck) => deck.description?.includes("\n"))).toBe(true);
    expect(Math.max(...decks.map((deck) => deck.name.length))).toBeGreaterThan(90);
  });

  test("refuses to seed a User who has a Deck, even a deleted one", async () => {
    await setup();
    const { app, close } = boot();
    const cookie = cookiesFrom(await signIn(app));
    const headers = { "content-type": "application/json", origin: ORIGIN, cookie };
    const created = await app.request("/api/decks", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Mine" }),
    });
    const { id } = DeckResponse.parse(await created.json());
    await app.request(`/api/decks/${id}`, { method: "DELETE", headers });
    close();

    const result = await seed();

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("The User already has content, so nothing was seeded.");
  });
});
