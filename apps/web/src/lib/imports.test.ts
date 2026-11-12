import { QueryClient } from "@tanstack/react-query";
import { describe, expect, test, vi } from "vitest";
import { createApiClient } from "./api";
import { CANT_REACH } from "./decks";
import {
  type HistoryEntry,
  type ImportReport,
  canUndo,
  cardCount,
  confirmImport,
  historyStateLabel,
  importHistoryQueryOptions,
  importQueryOptions,
  undoFigures,
  undoImport,
  undoQuestion,
  undoRemoved,
  uploadImport,
  whenLabel,
} from "./imports";

/** A client answering every request with `res()`, recording each request. */
const answering = (res: () => Response) => {
  const sent: { url: string; init: RequestInit | undefined }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: input instanceof Request ? input.url : input.toString(), init });
    return res();
  });
  return { client: createApiClient(fetch), sent };
};

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const REPORT = {
  id: "i",
  deckId: "d",
  fileName: "f.json",
  source: "json",
  total: 1,
  invalid: [],
  createdAt: "2026-10-26T12:00:00.000Z",
  status: "confirmed",
  confirmedAt: "2026-10-26T12:01:00.000Z",
  imported: 1,
  leftOut: 0,
  duplicates: [],
  macros: [],
  images: [],
  imageCount: 0,
  live: 1,
  undoneAt: null,
  undoDeletionId: null,
  studied: 0,
  edited: 0,
  moved: 0,
} as const;

const report = (overrides: Partial<ImportReport> = {}): ImportReport => ({
  ...REPORT,
  invalid: [],
  duplicates: [],
  macros: [],
  images: [],
  ...overrides,
});

describe("uploadImport", () => {
  test("sends pasted text or a file as the body, saying which, and answers the Import's ID", async () => {
    const { client, sent } = answering(() => json({ id: "i" }, 201));
    expect(await uploadImport("d", { kind: "paste", text: "{}" }, client)).toEqual({
      ok: true,
      id: "i",
    });
    const file = new File(["PK"], "deck.zip");
    await uploadImport("d", { kind: "file", file }, client);
    expect(sent[0]?.url).toMatch(/\/api\/decks\/d\/imports\?kind=paste$/);
    expect(sent[0]?.init?.body).toBe("{}");
    expect(sent[1]?.url).toMatch(/kind=file&name=deck\.zip$/);
    expect(sent[1]?.init?.body).toBe(file);
  });

  test("answers a refused file's problems, and a message when it can't reach Banki", async () => {
    const refused = answering(() =>
      json(
        {
          error: { code: "import_refused", message: "x" },
          problems: [{ text: "file: Not valid JSON" }],
        },
        422,
      ),
    );
    expect(await uploadImport("d", { kind: "paste", text: "```" }, refused.client)).toEqual({
      ok: false,
      problems: [{ text: "file: Not valid JSON" }],
    });
    const offline = createApiClient(async () => {
      throw new TypeError("offline");
    });
    expect(await uploadImport("d", { kind: "paste", text: "{}" }, offline)).toEqual({
      ok: false,
      message: CANT_REACH,
    });
  });
});

describe("confirmImport", () => {
  test("sends the ticked Cards and puts the report in the cache", async () => {
    const queryClient = new QueryClient();
    const { client, sent } = answering(() => json(REPORT, 200));
    const card = { number: 1, front: "a", back: "b", tags: [], gradingNotes: null };
    expect(await confirmImport(queryClient, "i", "d", [card], client)).toEqual({ ok: true });
    const body = sent[0]?.init?.body;
    expect(typeof body === "string" ? JSON.parse(body) : body).toEqual({ cards: [card] });
    expect(queryClient.getQueryData(importQueryOptions("i").queryKey)).toMatchObject({
      status: "confirmed",
    });
  });

  test("answers the API's message when it is refused", async () => {
    const { client } = answering(() =>
      json({ error: { code: "deck_gone", message: "The deck was deleted" } }, 409),
    );
    expect(await confirmImport(new QueryClient(), "i", "d", [], client)).toEqual({
      ok: false,
      message: "The deck was deleted",
    });
  });
});

/** 10:00 on `day` October 2026, in this device's timezone. */
const local = (day: number, hour = 10) => new Date(2026, 9, day, hour).toISOString();

describe("Past imports", () => {
  const entry = (overrides: Partial<HistoryEntry> = {}): HistoryEntry => ({
    id: "i",
    fileName: "f.json",
    source: "json",
    confirmedAt: local(20),
    imported: 40,
    live: 40,
    undoneAt: null,
    ...overrides,
  });
  const now = new Date(local(26, 12));

  test("says nothing more while every Card is here, and how many are once some aren't", () => {
    expect(historyStateLabel(entry(), now)).toBeUndefined();
    expect(historyStateLabel(entry({ live: 37 }), now)).toBe("37 of 40 cards still here");
    expect(historyStateLabel(entry({ imported: 1, live: 0 }), now)).toBe("0 of 1 card still here");
  });

  test("says when it was undone, before how many are here", () => {
    expect(historyStateLabel(entry({ live: 0, undoneAt: local(26) }), now)).toBe(
      "Undone today, 10:00",
    );
    expect(historyStateLabel(entry({ live: 0, undoneAt: local(25) }), now)).toBe(
      "Undone yesterday, 10:00",
    );
    expect(whenLabel(local(20), now)).toBe("Tuesday 20 October, 10:00");
  });

  test("are fetched for the Deck, and null for a Deck that's gone", async () => {
    const listed = answering(() => json([entry()], 200));
    const queryClient = new QueryClient();
    expect(await queryClient.fetchQuery(importHistoryQueryOptions("d", listed.client))).toEqual([
      entry(),
    ]);
    expect(listed.sent[0]?.url).toMatch(/\/api\/decks\/d\/imports$/);
    const gone = answering(() => json({ error: { code: "not_found", message: "x" } }, 404));
    expect(await new QueryClient().fetchQuery(importHistoryQueryOptions("d", gone.client))).toBe(
      null,
    );
  });
});

describe("Undo", () => {
  test("is offered while a Card it added is live and it isn't undone", () => {
    expect(canUndo(report())).toBe(true);
    expect(canUndo(report({ live: 0 }))).toBe(false);
    expect(canUndo(report({ imported: 0, live: 0 }))).toBe(false);
    expect(canUndo(report({ live: 0, undoneAt: local(26), undoDeletionId: "u" }))).toBe(false);
  });

  test("asks naming how many Cards go, and what was studied, edited or moved when any was", () => {
    expect(undoQuestion(report({ live: 24 }))).toBe(
      "Its 24 cards go to Recently deleted for 30 days.",
    );
    expect(undoQuestion(report({ live: 1 }))).toBe(
      "Its 1 card goes to Recently deleted for 30 days.",
    );
    expect(undoFigures(report({ live: 24 }))).toEqual([]);
    expect(undoFigures(report({ live: 24, studied: 5, moved: 1 }))).toEqual([
      { n: 5, label: "studied", note: "their reviews stay" },
      { n: 1, label: "moved", note: "to another deck, and go too" },
    ]);
    expect(undoFigures(report({ live: 24, edited: 2 }))).toEqual([
      { n: 2, label: "edited", note: "since the import" },
    ]);
    expect(cardCount(1_000)).toBe("1,000 cards");
  });

  test("says the Cards are gone for good once its Deletion is out of Recently deleted", () => {
    const undone = report({ live: 0, undoneAt: local(20), undoDeletionId: "u" });
    expect(undoRemoved(undone, [{ id: "u" }])).toBe(false);
    expect(undoRemoved(undone, [{ id: "other" }])).toBe(true);
    // Not until Recently deleted is fetched, and never for one not undone.
    expect(undoRemoved(undone, undefined)).toBe(false);
    expect(undoRemoved(report(), [])).toBe(false);
  });

  test("answers the Deletion and has the report and Recently deleted fetched again", async () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { client, sent } = answering(() => json({ deletionId: "del", cards: 24 }, 200));
    expect(await undoImport(queryClient, "i", client)).toEqual({
      ok: true,
      deletionId: "del",
      cards: 24,
    });
    expect(sent[0]?.url).toMatch(/\/api\/imports\/i\/undo$/);
    expect(sent[0]?.init?.method).toBe("POST");
    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toEqual(expect.arrayContaining([["deletions"], ["cards"], ["import-history"]]));
  });

  test("says so when there is nothing to undo, or Banki can't be reached", async () => {
    const nothing = answering(() =>
      json({ error: { code: "nothing_to_undo", message: "x" } }, 409),
    );
    expect(await undoImport(new QueryClient(), "i", nothing.client)).toEqual({
      ok: false,
      message: "None of its cards are here to undo.",
    });
    const offline = createApiClient(async () => {
      throw new TypeError("offline");
    });
    expect(await undoImport(new QueryClient(), "i", offline)).toEqual({
      ok: false,
      message: CANT_REACH,
    });
  });
});
