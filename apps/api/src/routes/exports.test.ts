import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import {
  CARD_FILE_SCHEMA_PATH,
  CardFile,
  CardListResponse,
  CardResponse,
  CreateImportResponse,
  DeckResponse,
  ImageUploadResponse,
  ImportPreviewResponse,
  ImportReportResponse,
  effectiveMacros,
} from "@banki/shared";
import { openDatabase } from "../db/database";
import { zipEntries, zipEntryBytes } from "../imports/zip";
import { createDeckRepository } from "../repositories/decks";
import { type App, ORIGIN, bootApps, codeOf, get, send, setUp } from "../testing/app";

const { boot, dataDir } = bootApps();

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 7, 7]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 9, 9]);

const R = { name: "\\R", definition: "\\mathbb{R}" };
const N_SETTINGS = { name: "\\N", definition: "\\mathbb{N}" };
const N_DECK = { name: "\\N", definition: "\\mathbf{N}" };
const NORM = { name: "\\norm", definition: "\\left\\| #1 \\right\\|" };

async function signedIn() {
  const booted = boot();
  return { app: booted.app, cookie: await setUp(booted) };
}

async function createDeck(app: App, cookie: string, name: string) {
  const res = await send(app, "POST", "/api/decks", { name }, cookie);
  expect(res.status).toBe(201);
  return DeckResponse.parse(await res.json()).id;
}

async function createCard(app: App, cookie: string, deckId: string, card: object) {
  const res = await send(app, "POST", `/api/decks/${deckId}/cards`, card, cookie);
  expect(res.status).toBe(201);
  return CardResponse.parse(await res.json()).id;
}

async function uploadImage(app: App, cookie: string, bytes: Uint8Array) {
  const res = await app.request("/api/images", {
    method: "POST",
    headers: { "content-type": "application/octet-stream", origin: ORIGIN, cookie },
    body: bytes,
  });
  expect(res.status).toBe(201);
  return ImageUploadResponse.parse(await res.json()).reference;
}

const exportOf = (app: App, cookie: string, deckId: string) =>
  get(app, `/api/decks/${deckId}/export`, cookie);

/** The zip's files by name, and its Card file parsed. */
async function unpack(res: Response) {
  const zip = new Uint8Array(await res.arrayBuffer());
  const files = new Map(zipEntries(zip).map((entry) => [entry.name, zipEntryBytes(zip, entry)]));
  const json = [...files.keys()].find((name) => name.endsWith(".json"));
  const text = new TextDecoder().decode(files.get(json ?? "") ?? new Uint8Array());
  return { zip, files, json, file: CardFile.parse(JSON.parse(text)) };
}

/** A Deck with Macros of its own over Settings', Cards with Tags, notes and Images, and one deleted. */
async function filledDeck(app: App, cookie: string, deckMacros = [N_DECK, NORM]) {
  await send(app, "PATCH", "/api/settings", { macros: [R, N_SETTINGS] }, cookie);
  const deckId = await createDeck(app, cookie, "Analysis");
  await send(app, "PATCH", `/api/decks/${deckId}`, { macros: deckMacros }, cookie);
  const png = await uploadImage(app, cookie, PNG);
  const gif = await uploadImage(app, cookie, GIF);
  const cards = [
    {
      front: "First $\\R$",
      back: `![a plot](${png})`,
      tags: ["calc", "limits"],
      gradingNotes: null,
    },
    { front: "Second", back: "$\\norm{x}$", tags: [], gradingNotes: "Must mention *both* sides" },
    { front: `Third ![](${png})`, back: `![](${gif}) and ![](images/nope.png)`, tags: ["calc"] },
  ];
  for (const card of cards) await createCard(app, cookie, deckId, card);
  const gone = await createCard(app, cookie, deckId, { front: "Deleted", back: "b" });
  await send(app, "DELETE", `/api/cards/${gone}`, undefined, cookie);
  return { deckId, png, gif, cards };
}

describe("GET /api/decks/:deckId/export", () => {
  test("answers the Deck as a zip to save, named after it", async () => {
    const { app, cookie } = await signedIn();
    const deckId = await createDeck(app, cookie, "Słówka: a/b?");
    const res = await exportOf(app, cookie, deckId);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="S__wka- a-b-.zip"; filename*=UTF-8''S%C5%82%C3%B3wka-%20a-b-.zip`,
    );
    const { files, json } = await unpack(res);
    expect(json).toBe("Słówka- a-b-.json");
    expect([...files.keys()]).toEqual(["Słówka- a-b-.json"]);
  });

  test("holds the live Cards oldest first, the effective Macros and each referenced Image once", async () => {
    const { app, cookie } = await signedIn();
    const { deckId, png, gif, cards } = await filledDeck(app, cookie);
    const { files, json, file } = await unpack(await exportOf(app, cookie, deckId));

    expect(file.$schema).toBe(`${ORIGIN}${CARD_FILE_SCHEMA_PATH}`);
    expect(file.macros).toEqual([R, N_DECK, NORM]);
    expect(file.cards).toEqual(cards.map((card) => ({ gradingNotes: null, ...card })));
    expect([...files.keys()]).toEqual([json!, png, gif]);
    expect(files.get(png)).toEqual(PNG);
    expect(files.get(gif)).toEqual(GIF);
  });

  test("exports an empty Deck as a Card file with no Cards and its Macros", async () => {
    const { app, cookie } = await signedIn();
    await send(app, "PATCH", "/api/settings", { macros: [R] }, cookie);
    const deckId = await createDeck(app, cookie, "Empty");
    const { files, file } = await unpack(await exportOf(app, cookie, deckId));
    expect([...files.keys()]).toEqual(["Empty.json"]);
    expect(file).toEqual({
      $schema: `${ORIGIN}${CARD_FILE_SCHEMA_PATH}`,
      format: "banki",
      version: 1,
      macros: [R],
      cards: [],
    });
  });

  test("answers 404 not_found for a deleted Deck, an unknown one and another User's", async () => {
    const { app, cookie } = await signedIn();
    const deleted = await createDeck(app, cookie, "Gone");
    await send(app, "DELETE", `/api/decks/${deleted}`, undefined, cookie);
    const opened = openDatabase(dataDir());
    let theirs: string;
    try {
      opened.db.run(
        sql`INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('other', 'n', 'o@x.y', 1, 0, 0)`,
      );
      const deck = createDeckRepository(opened.db).create("other", {
        name: "Theirs",
        description: null,
        folderId: null,
      });
      if (typeof deck === "string") throw new Error(`Their deck: ${deck}`);
      theirs = deck.id;
    } finally {
      opened.close();
    }

    for (const id of [deleted, "missing", theirs]) {
      const res = await exportOf(app, cookie, id);
      expect(res.status).toBe(404);
      expect(await codeOf(res)).toBe("not_found");
    }
  });

  test("round trip: the zip imports into a new Deck as the same Cards, Images and Macros", async () => {
    const { app, cookie } = await signedIn();
    // A Deck's own Macro over Settings' of the same name doesn't come back: the
    // import keeps the new Deck's, Settings' (BAN-32's Macro plan).
    const { deckId, cards } = await filledDeck(app, cookie, [NORM]);
    const exported = await unpack(await exportOf(app, cookie, deckId));
    const into = await createDeck(app, cookie, "Analysis again");

    const created = await app.request(`/api/decks/${into}/imports?kind=file&name=Analysis.zip`, {
      method: "POST",
      headers: { "content-type": "application/zip", origin: ORIGIN, cookie },
      body: exported.zip,
    });
    expect(created.status).toBe(201);
    const { id } = CreateImportResponse.parse(await created.json());
    const preview = ImportPreviewResponse.parse(
      await (await get(app, `/api/imports/${id}`, cookie)).json(),
    );
    expect(preview.total).toBe(cards.length);
    expect(preview.invalid).toEqual([]);
    expect(preview.cards.map((card) => card.duplicateOf)).toEqual(cards.map(() => null));
    // The one dangling reference was dangling before the export too.
    expect(preview.images.map((image) => image.problem)).toEqual(["missing"]);
    expect(preview.macros.map((macro) => macro.outcome)).toEqual(["added"]);

    const confirmed = await send(
      app,
      "POST",
      `/api/imports/${id}/confirm`,
      {
        cards: preview.cards.map(({ number, front, back, tags, gradingNotes }) => ({
          number,
          front,
          back,
          tags,
          gradingNotes,
        })),
      },
      cookie,
    );
    expect(ImportReportResponse.parse(await confirmed.json())).toMatchObject({
      imported: cards.length,
      imageCount: 2,
    });

    const listed = CardListResponse.parse(
      await (await get(app, `/api/decks/${into}/cards`, cookie)).json(),
    ).toReversed();
    const again = await unpack(await exportOf(app, cookie, into));
    // New IDs for the Images, the same bytes, and otherwise the same Cards.
    const renamed = new Map<string, string>();
    for (const [index, card] of exported.file.cards.entries()) {
      const now = again.file.cards[index]!;
      for (const [before, after] of [
        [card.front, now.front],
        [card.back, now.back],
      ] as const) {
        const was = [...before.matchAll(/images\/[\w-]+\.\w+/g)].map((m) => m[0]);
        const is = [...after.matchAll(/images\/[\w-]+\.\w+/g)].map((m) => m[0]);
        for (const [at, reference] of was.entries()) renamed.set(reference, is[at]!);
      }
    }
    const rename = (text: string) =>
      text.replace(/images\/[\w-]+\.\w+/g, (reference) => renamed.get(reference) ?? reference);
    expect(again.file.cards).toEqual(
      exported.file.cards.map((card) => ({
        ...card,
        front: rename(card.front),
        back: rename(card.back),
      })),
    );
    expect(listed.map((card) => card.front)).toEqual(again.file.cards.map((card) => card.front));
    for (const [before, after] of renamed) {
      if (before === "images/nope.png") {
        expect(after).toBe(before);
        continue;
      }
      expect(after).not.toBe(before);
      expect(again.files.get(after)).toEqual(exported.files.get(before));
    }

    const deck = DeckResponse.parse(await (await get(app, `/api/decks/${into}`, cookie)).json());
    expect(effectiveMacros([R, N_SETTINGS], deck.macros)).toEqual(exported.file.macros);
  });
});
