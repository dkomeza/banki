import { describe, expect, test } from "bun:test";
import {
  CardListResponse,
  CreateImportResponse,
  DeckFullError,
  DeletionListResponse,
  ImportHistoryResponse,
  ImportPreviewResponse,
  ImportRefusedResponse,
  ImportReportResponse,
  PlaceDeletedError,
  RestoreResponse,
  UndoImportResponse,
} from "@banki/shared";
import { type App, ORIGIN, bootApps, codeOf, fillDeck, get, send, setUp } from "../testing/app";
import { makeZip } from "../testing/zip";

const { boot, dataDir } = bootApps();

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

const card = (front: string, back = "b") => ({ front, back, tags: [], gradingNotes: null });
const fileText = (cards: unknown[]) =>
  JSON.stringify({ $schema: null, format: "banki", version: 1, macros: [], cards });

async function withDeck() {
  const booted = boot();
  const cookie = await setUp(booted);
  const res = await send(booted.app, "POST", "/api/decks", { name: "Spanish" }, cookie);
  const { id } = CreateImportResponse.parse(await res.json());
  return { app: booted.app, cookie, deckId: id };
}

const upload = (
  app: App,
  deckId: string,
  body: RequestInit["body"],
  cookie: string,
  { query = "kind=paste", type = "application/octet-stream" } = {},
) =>
  app.request(`/api/decks/${deckId}/imports?${query}`, {
    method: "POST",
    headers: { "content-type": type, origin: ORIGIN, cookie },
    body,
  });

describe("POST /api/decks/:deckId/imports", () => {
  test("reads pasted JSON, a .json and a .zip into an Import whose preview survives a refresh", async () => {
    const { app, cookie, deckId } = await withDeck();
    const zip = makeZip([
      { name: "cards.json", data: fileText([card("a", "![](images/a.png)")]) },
      { name: "images/a.png", data: PNG },
    ]);
    for (const [body, query, source, fileName] of [
      [fileText([card("a")]), "kind=paste", "paste", "pasted JSON"],
      [fileText([card("a")]), "kind=file&name=cards.json", "json", "cards.json"],
      [zip, "kind=file&name=deck.zip", "zip", "deck.zip"],
    ] as const) {
      const res = await upload(app, deckId, body, cookie, { query });
      expect(res.status).toBe(201);
      const { id } = CreateImportResponse.parse(await res.json());
      const found = await get(app, `/api/imports/${id}`, cookie);
      expect(found.status).toBe(200);
      const preview = ImportPreviewResponse.parse(await found.json());
      expect(preview).toMatchObject({ source, fileName, deckId, total: 1 });
      if (source === "zip") {
        const image = await get(app, `/api/imports/${id}/images/a.png`, cookie);
        expect(image.status).toBe(200);
        expect(image.headers.get("content-type")).toBe("image/png");
      }
    }
  });

  test("a refused file answers 422 with its problems and creates nothing", async () => {
    const { app, cookie, deckId } = await withDeck();
    const res = await upload(app, deckId, "```json\n{}\n```", cookie);
    expect(res.status).toBe(422);
    const body = ImportRefusedResponse.parse(await res.json());
    expect(body.problems[0]?.text).toStartWith("file: Not valid JSON");
  });

  test("an upload over 500 MB by its length is refused before it is read", async () => {
    const { app, cookie, deckId } = await withDeck();
    const res = await app.request(`/api/decks/${deckId}/imports?kind=file`, {
      method: "POST",
      headers: {
        "content-type": "application/zip",
        "content-length": String(500 * 1024 * 1024 + 1),
        origin: ORIGIN,
        cookie,
      },
      body: "{}",
    });
    expect(res.status).toBe(422);
    expect(ImportRefusedResponse.parse(await res.json()).problems[0]?.text).toContain("500.0 MB");
  });

  test("a type a form could send is refused, and so is an unknown Deck", async () => {
    const { app, cookie, deckId } = await withDeck();
    expect((await upload(app, deckId, "{}", cookie, { type: "text/plain" })).status).toBe(400);
    const res = await upload(app, "nope", fileText([]), cookie);
    expect(res.status).toBe(404);
  });

  test("restoring it into a Deck with no room answers 409 deck_full, naming it", async () => {
    const { app, cookie, deckId } = await withDeck();
    const id = await confirmed(app, deckId, cookie, ["a"]);
    const res = await send(app, "POST", `/api/imports/${id}/undo`, undefined, cookie);
    const { deletionId } = UndoImportResponse.parse(await res.json());
    fillDeck(dataDir(), deckId, 1000);

    const restored = await send(
      app,
      "POST",
      `/api/deletions/${deletionId}/restore`,
      undefined,
      cookie,
    );
    expect(restored.status).toBe(409);
    expect(DeckFullError.parse(await restored.json())).toMatchObject({
      deck: { id: deckId, name: "Spanish" },
      room: 0,
    });
  });

  test("signed out, it is refused", async () => {
    const { app, deckId } = await withDeck();
    expect((await upload(app, deckId, fileText([]), "")).status).toBe(401);
  });
});

describe("POST /api/imports/:id/confirm", () => {
  test("adds the ticked Cards, answers the report, and refuses a second confirm", async () => {
    const { app, cookie, deckId } = await withDeck();
    const created = await upload(app, deckId, fileText([card("a"), card("b")]), cookie);
    const { id } = CreateImportResponse.parse(await created.json());

    const res = await send(
      app,
      "POST",
      `/api/imports/${id}/confirm`,
      { cards: [{ number: 2, ...card("b edited") }] },
      cookie,
    );
    expect(res.status).toBe(200);
    expect(ImportReportResponse.parse(await res.json())).toMatchObject({ imported: 1, leftOut: 1 });

    const again = await send(app, "POST", `/api/imports/${id}/confirm`, { cards: [] }, cookie);
    expect(again.status).toBe(409);
    expect(await codeOf(again)).toBe("import_confirmed");

    const listed = await get(app, `/api/decks/${deckId}/cards`, cookie);
    expect(CardListResponse.parse(await listed.json()).map((c) => c.front)).toEqual(["b edited"]);
    const report = await get(app, `/api/imports/${id}`, cookie);
    expect(ImportReportResponse.parse(await report.json()).imported).toBe(1);
  });

  test("a Card breaking the Card rules refuses the request; a deleted Deck answers 409", async () => {
    const { app, cookie, deckId } = await withDeck();
    const created = await upload(app, deckId, fileText([card("a")]), cookie);
    const { id } = CreateImportResponse.parse(await created.json());
    const blank = await send(
      app,
      "POST",
      `/api/imports/${id}/confirm`,
      { cards: [{ number: 1, ...card(" ") }] },
      cookie,
    );
    expect(blank.status).toBe(400);
    const twice = await send(
      app,
      "POST",
      `/api/imports/${id}/confirm`,
      {
        cards: [
          { number: 1, ...card("a") },
          { number: 1, ...card("a") },
        ],
      },
      cookie,
    );
    expect(twice.status).toBe(400);

    await send(app, "DELETE", `/api/decks/${deckId}`, undefined, cookie);
    const gone = await send(
      app,
      "POST",
      `/api/imports/${id}/confirm`,
      { cards: [{ number: 1, ...card("a") }] },
      cookie,
    );
    expect(gone.status).toBe(409);
    expect(await codeOf(gone)).toBe("deck_gone");
  });

  test("an unknown Import is not found", async () => {
    const { app, cookie } = await withDeck();
    expect((await get(app, "/api/imports/nope", cookie)).status).toBe(404);
    const res = await send(app, "POST", "/api/imports/nope/confirm", { cards: [] }, cookie);
    expect(res.status).toBe(404);
  });
});

/** An Import of `fronts` into `deckId`, confirmed with every Card ticked; answers its ID. */
async function confirmed(app: App, deckId: string, cookie: string, fronts: string[]) {
  const created = await upload(app, deckId, fileText(fronts.map((f) => card(f))), cookie, {
    query: "kind=file&name=words.json",
  });
  const { id } = CreateImportResponse.parse(await created.json());
  const cards = fronts.map((front, i) => ({ number: i + 1, ...card(front) }));
  await send(app, "POST", `/api/imports/${id}/confirm`, { cards }, cookie);
  return id;
}

describe("the Card limit (ADR-0034)", () => {
  test("the preview carries the room, and a confirm over it answers 409 deck_full, adding nothing", async () => {
    const { app, cookie, deckId } = await withDeck();
    const created = await upload(app, deckId, fileText([card("a"), card("b")]), cookie);
    const { id } = CreateImportResponse.parse(await created.json());
    fillDeck(dataDir(), deckId, 999);

    const found = await get(app, `/api/imports/${id}`, cookie);
    expect(ImportPreviewResponse.parse(await found.json()).room).toBe(1);

    const res = await send(
      app,
      "POST",
      `/api/imports/${id}/confirm`,
      {
        cards: [
          { number: 1, ...card("a") },
          { number: 2, ...card("b") },
        ],
      },
      cookie,
    );
    expect(res.status).toBe(409);
    expect(DeckFullError.parse(await res.json())).toMatchObject({
      error: { code: "deck_full" },
      deck: { id: deckId, name: "Spanish" },
      room: 1,
    });
    const listed = await get(app, `/api/decks/${deckId}/cards`, cookie);
    expect(CardListResponse.parse(await listed.json())).toHaveLength(999);
  });
});

describe("GET /api/decks/:deckId/imports", () => {
  test("answers the Deck's confirmed Imports, newest first, and not an unconfirmed one", async () => {
    const { app, cookie, deckId } = await withDeck();
    const first = await confirmed(app, deckId, cookie, ["a", "b"]);
    const second = await confirmed(app, deckId, cookie, ["c"]);
    await upload(app, deckId, fileText([card("d")]), cookie);

    const res = await get(app, `/api/decks/${deckId}/imports`, cookie);
    expect(res.status).toBe(200);
    const history = ImportHistoryResponse.parse(await res.json());
    expect(history.map((e) => [e.id, e.fileName, e.source, e.imported, e.live])).toEqual([
      [second, "words.json", "json", 1, 1],
      [first, "words.json", "json", 2, 2],
    ]);
  });

  test("a deleted Deck and an unknown one are not found", async () => {
    const { app, cookie, deckId } = await withDeck();
    expect((await get(app, "/api/decks/nope/imports", cookie)).status).toBe(404);
    await send(app, "DELETE", `/api/decks/${deckId}`, undefined, cookie);
    const gone = await get(app, `/api/decks/${deckId}/imports`, cookie);
    expect(gone.status).toBe(404);
    expect(await codeOf(gone)).toBe("not_found");
  });
});

describe("POST /api/imports/:id/undo", () => {
  test("takes the Cards into one Deletion, which the report and Recently deleted show, and Restore undoes", async () => {
    const { app, cookie, deckId } = await withDeck();
    const id = await confirmed(app, deckId, cookie, ["a", "b"]);
    const before = ImportReportResponse.parse(
      await (await get(app, `/api/imports/${id}`, cookie)).json(),
    );
    expect(before).toMatchObject({
      live: 2,
      undoneAt: null,
      undoDeletionId: null,
      studied: 0,
      edited: 0,
      moved: 0,
    });

    const res = await send(app, "POST", `/api/imports/${id}/undo`, undefined, cookie);
    expect(res.status).toBe(200);
    const { deletionId, cards } = UndoImportResponse.parse(await res.json());
    expect(cards).toBe(2);

    const listed = await get(app, `/api/decks/${deckId}/cards`, cookie);
    expect(CardListResponse.parse(await listed.json())).toEqual([]);
    const report = ImportReportResponse.parse(
      await (await get(app, `/api/imports/${id}`, cookie)).json(),
    );
    expect(report).toMatchObject({ live: 0, undoDeletionId: deletionId });
    expect(report.undoneAt).not.toBeNull();
    const deleted = DeletionListResponse.parse(
      await (await get(app, "/api/deletions", cookie)).json(),
    );
    expect(deleted).toMatchObject([
      { id: deletionId, top: { kind: "import", id, name: "words.json" }, counts: { cards: 2 } },
    ]);

    const restored = await send(
      app,
      "POST",
      `/api/deletions/${deletionId}/restore`,
      undefined,
      cookie,
    );
    expect(restored.status).toBe(200);
    expect(RestoreResponse.parse(await restored.json())).toMatchObject({ kind: "import", id });
    const back = ImportReportResponse.parse(
      await (await get(app, `/api/imports/${id}`, cookie)).json(),
    );
    expect(back).toMatchObject({ live: 2, undoneAt: null, undoDeletionId: null });
  });

  test("with no live Card answers 409 nothing_to_undo", async () => {
    const { app, cookie, deckId } = await withDeck();
    const id = await confirmed(app, deckId, cookie, ["a"]);
    await send(app, "POST", `/api/imports/${id}/undo`, undefined, cookie);
    const again = await send(app, "POST", `/api/imports/${id}/undo`, undefined, cookie);
    expect(again.status).toBe(409);
    expect(await codeOf(again)).toBe("nothing_to_undo");
  });

  test("an unconfirmed Import and an unknown one are not found", async () => {
    const { app, cookie, deckId } = await withDeck();
    const created = await upload(app, deckId, fileText([card("a")]), cookie);
    const { id } = CreateImportResponse.parse(await created.json());
    for (const path of [`/api/imports/${id}/undo`, "/api/imports/nope/undo"]) {
      const res = await send(app, "POST", path, undefined, cookie);
      expect(res.status).toBe(404);
      expect(await codeOf(res)).toBe("not_found");
    }
  });

  test("restoring it while a Deck its Cards are in is deleted answers 409 place_deleted, naming it", async () => {
    const { app, cookie, deckId } = await withDeck();
    const id = await confirmed(app, deckId, cookie, ["a"]);
    const res = await send(app, "POST", `/api/imports/${id}/undo`, undefined, cookie);
    const { deletionId } = UndoImportResponse.parse(await res.json());
    await send(app, "DELETE", `/api/decks/${deckId}`, undefined, cookie);

    const restored = await send(
      app,
      "POST",
      `/api/deletions/${deletionId}/restore`,
      undefined,
      cookie,
    );
    expect(restored.status).toBe(409);
    expect(PlaceDeletedError.parse(await restored.json())).toMatchObject({
      error: { message: "Restore Spanish first" },
      deck: { id: deckId, name: "Spanish" },
    });
  });

  test("signed out, it is refused", async () => {
    const booted = boot();
    await setUp(booted);
    const res = await send(booted.app, "POST", "/api/imports/nope/undo", undefined);
    expect(res.status).toBe(401);
  });
});
