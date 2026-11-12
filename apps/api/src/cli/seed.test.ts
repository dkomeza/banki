import { Database as SQLite } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  CardListResponse,
  ImportReportResponse,
  CardResponse,
  DeckListResponse,
  DEFAULT_MODEL_ID,
  DeckResponse,
  DeletionListResponse,
  ImportHistoryResponse,
  FolderListResponse,
  FolderResponse,
  RestoreResponse,
  SettingsResponse,
  StudyNextResponse,
  TagListResponse,
  TUNING_REVIEW_INTERVAL,
  TuningStatus,
} from "@banki/shared";
import { SEED_IDS } from "../seed/seed-ids";
import { EMAIL, ORIGIN, PASSWORD, bootApps, cookiesFrom, get, signIn } from "../testing/app";
import { runCli } from "../testing/cli";

// These run the real CLI in a child process against a temporary data
// directory, migrated from scratch by the CLI itself.

/** What a User who hasn't touched the Grading or Editor cards has. */
const UNTOUCHED_DEFAULTS = {
  model: "anthropic/claude-haiku-5.5",
  apiKey: { state: "unset" },
  autoClose: "brackets",
  desiredRetention: 90,
  newCardBatch: 20,
  learningLimit: 10,
  sessionTimeoutMinutes: 30,
  macros: [] as { name: string; definition: string }[],
  answerMode: "self-rate",
} as const;

/** Settings' Macros as the Seed data writes them. */
const SEEDED_MACROS = [
  { name: "\\norm", definition: "\\left\\| #1 \\right\\|" },
  { name: "\\abs", definition: "\\left| #1 \\right|" },
  { name: "\\eps", definition: "\\varepsilon" },
];

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
      ...UNTOUCHED_DEFAULTS,
      macros: SEEDED_MACROS,
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
      ...UNTOUCHED_DEFAULTS,
      macros: SEEDED_MACROS,
    });
  });
});

describe("banki seed's Macros", () => {
  test("leaves Macros the User already wrote alone", async () => {
    await setup();
    const { app, close } = boot();
    const cookie = cookiesFrom(await signIn(app));
    const mine = [{ name: "\\R", definition: "\\mathbb{R}" }];
    await app.request("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json", origin: ORIGIN, cookie },
      body: JSON.stringify({ macros: mine }),
    });
    close();

    await seed();

    const { app: after } = boot();
    const res = await get(after, "/api/settings", cookiesFrom(await signIn(after)));
    expect(SettingsResponse.parse(await res.json()).macros).toEqual(mine);
  });

  test("makes Calculus 2 write-and-grade, and leaves the other Decks following Settings' self-rate", async () => {
    await setup();
    await seed();

    const { app } = boot();
    const cookie = cookiesFrom(await signIn(app));
    const decks = DeckListResponse.parse(await (await get(app, "/api/decks", cookie)).json());
    expect(Object.fromEntries(decks.map((deck) => [deck.id, deck.answerMode]))).toEqual({
      [SEED_IDS.decks.spanish]: null,
      [SEED_IDS.decks.calculus2]: "write",
      [SEED_IDS.decks.kanji]: null,
      [SEED_IDS.decks.chemistry]: null,
      [SEED_IDS.decks.calculus10]: null,
    });
    const settings = await get(app, "/api/settings", cookie);
    expect(SettingsResponse.parse(await settings.json()).answerMode).toBe("self-rate");
  });

  test("gives Calculus 2 its own \\d and an \\eps over Settings', and Cards that use them", async () => {
    await setup();
    await seed();

    const { app } = boot();
    const cookie = cookiesFrom(await signIn(app));
    const { decks: D, cards: C } = SEED_IDS;
    const deckOf = async (id: string) =>
      DeckResponse.parse(await (await get(app, `/api/decks/${id}`, cookie)).json());

    expect((await deckOf(D.calculus2)).macros).toEqual([
      { name: "\\d", definition: "\\mathrm{d}" },
      { name: "\\eps", definition: "\\epsilon" },
    ]);
    // Spanish vocabulary's own are its \pl and the two its Import added.
    expect((await deckOf(D.spanish)).macros).toEqual([
      { name: "\\pl", definition: "\\textsf{\\small pl.}" },
      { name: "\\m", definition: "\\textsf{\\small m.}" },
      { name: "\\f", definition: "\\textsf{\\small f.}" },
    ]);
    const sides = await Promise.all(
      C.calculus2.slice(-3).map(async (id) => {
        const card = CardResponse.parse(await (await get(app, `/api/cards/${id}`, cookie)).json());
        return `${card.front}\n${card.back}`;
      }),
    );
    for (const macro of ["\\norm{", "\\abs{", "\\eps", "\\d "]) {
      expect(sides.join("\n")).toContain(macro);
    }
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
      const imported = new Set<string>(Object.values(C.imported));
      const cards = (await listOf(deck)).filter((card) => !imported.has(card.id));
      // Newest first, so the fixed IDs (oldest first) come back reversed.
      expect(cards.map((card) => card.id)).toEqual(ids.toReversed());
      expect(new Set(cards.map((card) => card.createdAt)).size).toBe(ids.length);
    }
    // The Import's Cards, in its file's order, the first the oldest.
    const importedIds: readonly string[] = Object.values(C.imported);
    const fromImport = (await listOf(D.spanish)).filter((card) => importedIds.includes(card.id));
    expect(fromImport.map((card) => card.id)).toEqual(Object.values(C.imported).toReversed());
    expect(await listOf(D.calculus10)).toEqual([]);
    const decks = DeckListResponse.parse(await (await get(app, "/api/decks", cookie)).json());
    expect(decks.find((deck) => deck.id === D.spanish)?.cardCount).toBe(
      C.spanish.length + Object.keys(C.imported).length,
    );

    const card = CardResponse.parse(
      await (await get(app, `/api/cards/${SEED_IDS.card}`, cookie)).json(),
    );
    expect(card.deckId).toBe(D.calculus2);
    expect(card.front).toContain("\n");
    expect(card.back.split("\n").length).toBeGreaterThan(3);
    expect(card.back).toContain("$");
  });

  test("gives three Cards Grading notes, the edit-card page's among them, with a Formula", async () => {
    await setup();
    await seed();

    const { app } = boot();
    const cookie = cookiesFrom(await signIn(app));
    const noted = [];
    for (const deckId of Object.values(SEED_IDS.decks)) {
      const cards = CardListResponse.parse(
        await (await get(app, `/api/decks/${deckId}/cards`, cookie)).json(),
      );
      noted.push(...cards.filter((card) => card.gradingNotes !== null));
    }

    expect(noted).toHaveLength(3);
    expect(noted.find((card) => card.id === SEED_IDS.card)?.gradingNotes).toContain("$");
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

describe("banki seed's Import", () => {
  test("is one confirmed Import into Spanish vocabulary, its report with every kind of line", async () => {
    await setup();
    await seed();

    const { app } = boot();
    const cookie = cookiesFrom(await signIn(app));
    const report = ImportReportResponse.parse(
      await (await get(app, `/api/imports/${SEED_IDS.import}`, cookie)).json(),
    );
    expect(report).toMatchObject({
      deckId: SEED_IDS.decks.spanish,
      fileName: "mercado-y-cafe.json",
      total: 8,
      imported: 5,
      leftOut: 1,
      duplicates: [{ number: 3, front: "La cuenta" }],
      invalid: [{ number: 4 }],
      images: [{ card: 6, reference: "images/churros.jpg", problem: "missing" }],
    });
    expect(report.macros.map((entry) => [entry.name, entry.outcome])).toEqual([
      ["\\m", "added"],
      ["\\f", "added"],
      ["\\pl", "kept"],
    ]);
  });

  test("beside an older one, undone, which Past imports shows with it", async () => {
    await setup();
    await seed({ BANKI_SEED_NOW: "2026-10-26T12:00:00.000Z" });

    const { app } = boot();
    const cookie = cookiesFrom(await signIn(app));
    const history = ImportHistoryResponse.parse(
      await (await get(app, `/api/decks/${SEED_IDS.decks.spanish}/imports`, cookie)).json(),
    );
    expect(history.map((e) => [e.id, e.imported, e.live, e.undoneAt])).toEqual([
      [SEED_IDS.import, 5, 5, null],
      [SEED_IDS.undoneImport, 6, 0, "2026-10-24T13:00:00.000Z"],
    ]);
    const report = ImportReportResponse.parse(
      await (await get(app, `/api/imports/${SEED_IDS.undoneImport}`, cookie)).json(),
    );
    expect(report).toMatchObject({
      imported: 6,
      live: 0,
      undoDeletionId: SEED_IDS.deletions.verbos,
    });
  });
});

describe("banki seed's Reviews", () => {
  test("studies el desayuno, la cuenta and the edit-card page's Card, el desayuno shown first", async () => {
    await setup();
    await seed();

    const { app } = boot();
    const cookie = cookiesFrom(await signIn(app));
    const cardOf = async (id: string) =>
      CardResponse.parse(await (await get(app, `/api/cards/${id}`, cookie)).json());
    const { spanish } = SEED_IDS.cards;

    for (const id of [spanish[0], spanish[1], SEED_IDS.card]) {
      expect((await cardOf(id)).studied).toBe(true);
    }
    expect((await cardOf(spanish[2])).studied).toBe(false);

    const next = StudyNextResponse.parse(
      await (
        await get(
          app,
          `/api/decks/${SEED_IDS.decks.spanish}/study/next?reviewsShown=0&newShown=0&batches=1`,
          cookie,
        )
      ).json(),
    ).next;
    expect(next?.card.id).toBe(spanish[0]);
    expect(next?.kind).toBe("learning");
    expect(next?.schedule.lapses).toBe(1);
  });

  test("hold one graded Review that kept the suggestion and one that changed it, both with the default Model", async () => {
    await setup();
    await seed();

    const sqlite = new SQLite(join(dataDir(), "banki.db"), { readonly: true });
    const graded = sqlite
      .query<
        {
          card_id: string;
          rating: string;
          suggested_rating: string;
          model: string;
        },
        []
      >(
        "SELECT card_id, rating, suggested_rating, model FROM review WHERE kind = 'graded' ORDER BY seq",
      )
      .all();
    sqlite.close();

    expect(graded).toEqual([
      { card_id: SEED_IDS.card, rating: "good", suggested_rating: "good", model: DEFAULT_MODEL_ID },
      {
        card_id: SEED_IDS.cards.spanish[0],
        rating: "again",
        suggested_rating: "hard",
        model: DEFAULT_MODEL_ID,
      },
    ]);
  });

  test("take their places in the Write order oldest first", async () => {
    await setup();
    await seed();

    const sqlite = new SQLite(join(dataDir(), "banki.db"), { readonly: true });
    const moments = sqlite
      .query<{ reviewed_at: number }, []>("SELECT reviewed_at FROM review ORDER BY seq")
      .all()
      .map((r) => r.reviewed_at);
    sqlite.close();

    expect(moments.length).toBeGreaterThan(1);
    expect(moments).toEqual(moments.toSorted((a, b) => a - b));
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
      D.verbos,
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
    expect(byId(D.verbos)).toMatchObject({
      top: { kind: "import", id: SEED_IDS.undoneImport, name: "verbos-irregulares.json" },
      deck: { id: SEED_IDS.decks.spanish },
      counts: { cards: 6 },
    });
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

describe("banki seed's Tuning", () => {
  test("is one automatic Tuning that applied, after the Reviews, so Settings shows the tuned state", async () => {
    await setup();
    await seed({ BANKI_SEED_NOW: "2026-10-26T12:00:00.000Z" });

    const { app } = boot();
    const cookie = cookiesFrom(await signIn(app));
    const status = TuningStatus.parse(await (await get(app, "/api/tuning", cookie)).json());

    const sqlite = new SQLite(join(dataDir(), "banki.db"), { readonly: true });
    const reviews = sqlite.query<{ n: number }, []>("SELECT count(*) AS n FROM review").get()?.n;
    sqlite.close();
    expect(status).toEqual({
      parameters: "tuned",
      tuned: { at: "2026-10-26T11:00:00.000Z", reviews: reviews ?? -1 },
      lastAttempt: { at: "2026-10-26T11:00:00.000Z", trigger: "automatic", outcome: "applied" },
      reviewsUntilAutomatic: TUNING_REVIEW_INTERVAL,
      paused: false,
      running: false,
    });
  });

  test("refuses to seed a User who has a Tuning log row", async () => {
    await setup();
    const { app, close } = boot();
    const cookie = cookiesFrom(await signIn(app));
    await app.request("/api/tuning", { method: "POST", headers: { origin: ORIGIN, cookie } });
    close();

    const result = await seed();

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("The User already has content, so nothing was seeded.");
  });
});
