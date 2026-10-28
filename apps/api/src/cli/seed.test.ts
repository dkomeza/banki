import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  CardListResponse,
  CardResponse,
  DeckListResponse,
  DeckResponse,
  DeletionListResponse,
  FolderListResponse,
  FolderResponse,
  RestoreResponse,
  SettingsResponse,
  TagListResponse,
} from "@banki/shared";
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

const seed = (env: Record<string, string> = {}) => runCli(["seed"], { dataDir: dataDir(), env });
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

describe("banki seed's Folders", () => {
  test("loads the four Folders, with the Decks in them, created at different times", async () => {
    await setup();
    await seed();

    const { app } = boot();
    const cookie = cookiesFrom(await signIn(app));
    const folders = FolderListResponse.parse(await (await get(app, "/api/folders", cookie)).json());
    const decks = DeckListResponse.parse(await (await get(app, "/api/decks", cookie)).json());
    const { folders: F, decks: D } = SEED_IDS;

    expect(Object.fromEntries(folders.map((f) => [f.name, f.parentId]))).toEqual({
      Languages: null,
      Maths: null,
      Analysis: F.maths,
      Archive: null,
    });
    expect(folders.find((f) => f.id === SEED_IDS.folder)?.name).toBe("Analysis");
    expect(new Set(folders.map((f) => f.createdAt)).size).toBe(4);
    expect(Object.fromEntries(decks.map((d) => [d.id, d.folderId]))).toEqual({
      [D.spanish]: F.languages,
      [D.kanji]: F.languages,
      [D.calculus2]: F.analysis,
      [D.calculus10]: F.analysis,
      [D.chemistry]: null,
    });
  });

  test("refuses to seed a User who has a Folder, even a deleted one", async () => {
    await setup();
    const { app, close } = boot();
    const cookie = cookiesFrom(await signIn(app));
    const headers = { "content-type": "application/json", origin: ORIGIN, cookie };
    const created = await app.request("/api/folders", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Mine" }),
    });
    const { id } = FolderResponse.parse(await created.json());
    await app.request(`/api/folders/${id}`, { method: "DELETE", headers });
    close();

    const result = await seed();

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("The User already has content, so nothing was seeded.");
  });
});

describe("banki seed's Cards", () => {
  test("loads each Deck's Cards, with their fixed IDs, at different times, Calculus 10 empty", async () => {
    await setup();
    await seed();

    const { app } = boot();
    const cookie = cookiesFrom(await signIn(app));
    const listOf = async (deckId: string) =>
      CardListResponse.parse(await (await get(app, `/api/decks/${deckId}/cards`, cookie)).json());
    const { decks: D, cards: C } = SEED_IDS;

    for (const [deck, ids] of [
      [D.spanish, C.spanish],
      [D.calculus2, C.calculus2],
      [D.kanji, C.kanji],
      [D.chemistry, C.chemistry],
    ] as const) {
      const cards = await listOf(deck);
      // Newest first, so the fixed IDs (oldest first) come back reversed.
      expect(cards.map((card) => card.id)).toEqual(ids.toReversed());
      expect(new Set(cards.map((card) => card.createdAt)).size).toBe(ids.length);
    }
    expect(await listOf(D.calculus10)).toEqual([]);
    const decks = DeckListResponse.parse(await (await get(app, "/api/decks", cookie)).json());
    expect(decks.find((deck) => deck.id === D.spanish)?.cardCount).toBe(C.spanish.length);

    const card = CardResponse.parse(
      await (await get(app, `/api/cards/${SEED_IDS.card}`, cookie)).json(),
    );
    expect(card.deckId).toBe(D.calculus2);
    expect(card.front).toContain("\n");
    expect(card.back.split("\n").length).toBeGreaterThan(3);
    expect(card.back).toContain("$");
  });

  test("stores the one Image under uploads/, and the edit-card page's Card refers to it", async () => {
    await setup();
    await seed();

    const { app } = boot();
    const cookie = cookiesFrom(await signIn(app));
    const card = CardResponse.parse(
      await (await get(app, `/api/cards/${SEED_IDS.card}`, cookie)).json(),
    );
    const reference = `images/${SEED_IDS.image}.png`;

    expect(card.back.split("\n")).toContain(`![](${reference})`);
    expect(readdirSync(join(dataDir(), "uploads"))).toEqual([`${SEED_IDS.image}.png`]);
    const res = await get(app, `/api/${reference}`, cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(
      new Uint8Array(readFileSync(new URL("../seed/seed-image.png", import.meta.url))),
    );
  });

  test("refuses to seed a User who has an Image, even one no Card refers to", async () => {
    await setup();
    const { app, close } = boot();
    const cookie = cookiesFrom(await signIn(app));
    await app.request("/api/images", {
      method: "POST",
      headers: { "content-type": "application/octet-stream", origin: ORIGIN, cookie },
      body: readFileSync(new URL("../seed/seed-image.png", import.meta.url)),
    });
    close();

    const result = await seed();

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("The User already has content, so nothing was seeded.");
  });

  test("tags the Cards: one Tag in two Decks, one Card with many, a deleted Card's hidden", async () => {
    await setup();
    await seed();

    const { app } = boot();
    const cookie = cookiesFrom(await signIn(app));
    const listOf = async (deckId: string) =>
      CardListResponse.parse(await (await get(app, `/api/decks/${deckId}/cards`, cookie)).json());
    const { decks: D } = SEED_IDS;
    const spanish = await listOf(D.spanish);
    const calculus = await listOf(D.calculus2);

    expect(spanish.every((card) => card.tags.length > 0)).toBe(true);
    expect(spanish.some((card) => card.tags.includes("exam"))).toBe(true);
    expect(calculus.some((card) => card.tags.includes("exam"))).toBe(true);
    expect(Math.max(...spanish.map((card) => card.tags.length))).toBeGreaterThanOrEqual(8);
    const tags = TagListResponse.parse(await (await get(app, "/api/tags", cookie)).json());
    expect(tags).toEqual(
      expect.arrayContaining(["noun", "verb", "irregular", "integrals", "series"]),
    );
    expect(tags).not.toContain("time");
  });

  test("has Cards for each kind of Markdown and Formula the display renders", async () => {
    await setup();
    await seed();

    const { app } = boot();
    const cookie = cookiesFrom(await signIn(app));
    const sidesOf = async (deckId: string) =>
      CardListResponse.parse(await (await get(app, `/api/decks/${deckId}/cards`, cookie)).json())
        .map((card) => `${card.front}\n${card.back}`)
        .join("\n");
    const { decks: D } = SEED_IDS;

    const spanish = await sidesOf(D.spanish);
    for (const markdown of ["**ser**", "\n- `ser`", "| yo | soy | estoy |", "```\nSoy de"]) {
      expect(spanish).toContain(markdown);
    }
    expect(spanish).toContain("\\$12");
    expect(spanish).toContain("$5 and the cake $10");
    const calculus = await sidesOf(D.calculus2);
    for (const formula of ["\\begin{align}", "\\begin{cases}", "\\begin{pmatrix}", "\\fracc"]) {
      expect(calculus).toContain(formula);
    }
    const chemistry = await sidesOf(D.chemistry);
    expect(chemistry).toContain("\\ce{");
    expect(chemistry).toContain("\\pu{");
  });

  test("writes them relative to BANKI_SEED_NOW when it is set", async () => {
    await setup();
    await seed({ BANKI_SEED_NOW: "2026-10-26T12:00:00.000Z" });

    const { app } = boot();
    const cookie = cookiesFrom(await signIn(app));
    const res = await get(app, `/api/decks/${SEED_IDS.decks.spanish}/cards`, cookie);
    const [newest] = CardListResponse.parse(await res.json());

    expect(newest?.createdAt).toBe("2026-10-26T10:00:00.000Z");
  });

  test("refuses a BANKI_SEED_NOW that isn't a time", async () => {
    await setup();

    const result = await seed({ BANKI_SEED_NOW: "soon" });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("BANKI_SEED_NOW isn't a time: soon");
  });
});

describe("banki seed's Deletions", () => {
  test("loads one Deletion of each case Recently deleted shows, newest first", async () => {
    await setup();
    await seed({ BANKI_SEED_NOW: "2026-10-26T12:00:00.000Z" });

    const { app } = boot();
    const cookie = cookiesFrom(await signIn(app));
    const deletions = DeletionListResponse.parse(
      await (await get(app, "/api/deletions", cookie)).json(),
    );
    const D = SEED_IDS.deletions;

    expect(deletions.map((d) => d.id)).toEqual([
      D.physics,
      D.madrugada,
      D.statistics,
      D.spanish,
      D.oldSemester,
      D.linearAlgebra,
      D.german,
      D.termin,
      D.calculus1,
    ]);
    const byId = (id: string) => deletions.find((d) => d.id === id);
    expect(byId(D.physics)).toMatchObject({
      top: { kind: "folder", name: "Physics" },
      counts: { folders: 1, decks: 2, cards: 30 },
    });
    expect(byId(D.madrugada)?.deck?.id).toBe(SEED_IDS.decks.spanish);
    expect(byId(D.calculus1)).toMatchObject({
      path: ["Maths", "Analysis"],
      removesAt: "2026-10-27T10:00:00.000Z",
    });

    const restore = (id: string) =>
      app.request(`/api/deletions/${id}/restore`, {
        method: "POST",
        headers: { origin: ORIGIN, cookie },
      });
    expect(RestoreResponse.parse(await (await restore(D.linearAlgebra)).json())).toMatchObject({
      movedToRoot: true,
    });
    expect(RestoreResponse.parse(await (await restore(D.spanish)).json())).toMatchObject({
      name: "Spanish vocabulary (2)",
      renamed: true,
    });
    expect((await restore(D.termin)).status).toBe(409);
  });
});
