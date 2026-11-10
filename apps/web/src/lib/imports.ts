import {
  ApiError,
  type CardFileProblem,
  CreateImportResponse,
  type ImportCard,
  type ImportHistoryEntry,
  ImportHistoryResponse,
  ImportRefusedResponse,
  type ImportReportResponse,
  ImportResponse,
  type ImportSource,
  UndoImportResponse,
} from "@banki/shared";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { type ApiClient, api } from "./api";
import { refreshDeck } from "./cards";
import { refreshAfterDeletion } from "./deletions";
import { CANT_REACH } from "./decks";
import { ApiRequestError } from "./query";

// An Import (CONTEXT.md, ADR-0026): the file goes to the API as it is, which
// reads it into an unconfirmed Import; its page previews it, and confirming
// it turns the page into its report. A confirmed one can be undone (ADR-0029),
// its Cards going to Recently deleted as one Deletion.

export type Import = ImportResponse;
export type ImportReport = ImportReportResponse;
export type HistoryEntry = ImportHistoryEntry;

/** The kinds of file the source takes. */
export const IMPORT_ACCEPT = ".json,.zip,application/json,application/zip";

/** An Import, from `GET /api/imports/:id`: its preview or its report; null for no such Import. */
export const importQueryOptions = (id: string, client: ApiClient = api) =>
  queryOptions({
    queryKey: ["imports", id],
    queryFn: async (): Promise<Import | null> => {
      const res = await client.api.imports[":id"].$get({ param: { id } });
      const status: number = res.status;
      if (status === 404) return null;
      if (!res.ok) throw new ApiRequestError(status);
      return ImportResponse.parse(await res.json());
    },
    // Ticks and edits live on the preview; a refetch must never reset them. A
    // report's live Cards change with deletes elsewhere, so it is fetched again.
    staleTime: (query) => (query.state.data?.status === "confirmed" ? 0 : Number.POSITIVE_INFINITY),
  });

/** A Deck's Past imports, from `GET /api/decks/:deckId/imports`: newest first; null for no such Deck. */
export const importHistoryQueryOptions = (deckId: string, client: ApiClient = api) =>
  queryOptions({
    queryKey: ["import-history", deckId],
    queryFn: async (): Promise<HistoryEntry[] | null> => {
      const res = await client.api.decks[":deckId"].imports.$get({ param: { deckId } });
      const status: number = res.status;
      if (status === 404) return null;
      if (!res.ok) throw new ApiRequestError(status);
      return ImportHistoryResponse.parse(await res.json());
    },
  });

/**
 * Has every confirmed Import's report and every Deck's Past imports fetched
 * again, after something changed which of their Cards are live. A preview is
 * left alone: its ticks and edits live on the page.
 */
export async function refreshImports(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({
      predicate: (query) => {
        const data: unknown = query.state.data;
        return (
          query.queryKey[0] === "imports" &&
          typeof data === "object" &&
          data !== null &&
          "status" in data &&
          data.status === "confirmed"
        );
      },
    }),
    queryClient.invalidateQueries({ queryKey: ["import-history"] }),
  ]);
}

export type UploadOutcome =
  | { ok: true; id: string }
  | { ok: false; problems: CardFileProblem[] }
  | { ok: false; message: string };

/**
 * Sends a file, or pasted text, to `POST /api/decks/:deckId/imports` as it
 * is, and answers the new Import's ID, the problems that refused it, or a
 * message to show.
 */
export async function uploadImport(
  deckId: string,
  source: { kind: "paste"; text: string } | { kind: "file"; file: File },
  client: ApiClient = api,
): Promise<UploadOutcome> {
  let res: Response;
  try {
    res = await client.api.decks[":deckId"].imports.$post(
      {
        param: { deckId },
        query:
          source.kind === "paste" ? { kind: "paste" } : { kind: "file", name: source.file.name },
      },
      {
        init: {
          body: source.kind === "paste" ? source.text : source.file,
          headers: { "content-type": "application/octet-stream" },
        },
      },
    );
  } catch {
    return { ok: false, message: CANT_REACH };
  }
  const body: unknown = await res.json().catch(() => undefined);
  if (res.status === 201) {
    const created = CreateImportResponse.safeParse(body);
    if (created.success) return { ok: true, id: created.data.id };
  }
  if (res.status === 422) {
    const refused = ImportRefusedResponse.safeParse(body);
    if (refused.success) return { ok: false, problems: refused.data.problems };
  }
  if (res.status === 404) return { ok: false, message: "This deck is gone." };
  if (res.status === 413) {
    return {
      ok: false,
      problems: [{ text: "file: The upload is over 500 MB, the most an import can be" }],
    };
  }
  return { ok: false, message: "Banki couldn't read the file. Try again." };
}

export type ConfirmOutcome = { ok: true } | { ok: false; message: string };

/**
 * Confirms an Import with `POST /api/imports/:id/confirm`, sending the ticked
 * Cards, and on success puts its report in the cache and has the Deck's Cards
 * fetched again.
 */
export async function confirmImport(
  queryClient: QueryClient,
  id: string,
  deckId: string,
  cards: readonly ImportCard[],
  client: ApiClient = api,
): Promise<ConfirmOutcome> {
  let res: Response;
  try {
    res = await client.api.imports[":id"].confirm.$post({
      param: { id },
      json: { cards: cards.map((card) => ({ ...card, tags: [...card.tags] })) },
    });
  } catch {
    return { ok: false, message: CANT_REACH };
  }
  const body: unknown = await res.json().catch(() => undefined);
  if (res.ok) {
    const report = ImportResponse.safeParse(body);
    if (report.success) {
      queryClient.setQueryData(importQueryOptions(id).queryKey, report.data);
      await refreshDeck(queryClient, deckId);
      return { ok: true };
    }
  }
  const error = ApiError.safeParse(body);
  if (res.status === 409 && error.success) {
    // Confirmed already (another tab): the report is what to show.
    if (error.data.error.code === "import_confirmed") {
      await queryClient.invalidateQueries({ queryKey: importQueryOptions(id).queryKey });
    }
    return { ok: false, message: error.data.error.message };
  }
  if (res.status === 400 && error.success) return { ok: false, message: error.data.error.message };
  return { ok: false, message: "Banki couldn't import the cards. Try again." };
}

export type UndoOutcome =
  | { ok: true; deletionId: string; cards: number }
  | { ok: false; message: string };

/**
 * Undoes a confirmed Import with `POST /api/imports/:id/undo`, taking its live
 * Cards to Recently deleted as one Deletion, and has what that changes
 * fetched again: its report, the Past imports, the Decks and their Cards, and
 * Recently deleted.
 */
export async function undoImport(
  queryClient: QueryClient,
  id: string,
  client: ApiClient = api,
): Promise<UndoOutcome> {
  let res: Response;
  try {
    res = await client.api.imports[":id"].undo.$post({ param: { id } });
  } catch {
    return { ok: false, message: CANT_REACH };
  }
  const body: unknown = await res.json().catch(() => undefined);
  const undone = UndoImportResponse.safeParse(body);
  if (res.ok && undone.success) {
    await refreshAfterDeletion(queryClient);
    return { ok: true, ...undone.data };
  }
  const error = ApiError.safeParse(body);
  if (res.status === 409 || res.status === 404) {
    // Undone already (another tab), or gone: the report is what to show.
    await refreshImports(queryClient);
    if (error.success && error.data.error.code === "nothing_to_undo") {
      return { ok: false, message: "None of its cards are here to undo." };
    }
    return { ok: false, message: "This import is gone." };
  }
  return { ok: false, message: "Banki couldn't undo the import. Try again." };
}

// How Past imports and Undo word an Import.

/** "1 card", "24 cards". */
export const cardCount = (n: number) =>
  `${n.toLocaleString("en-GB")} ${n === 1 ? "card" : "cards"}`;

/** How a history entry names where its file came from. */
export const sourceLabel = (source: ImportSource) =>
  source === "zip" ? "Zip" : source === "json" ? "JSON file" : "Pasted";

const DAY_MS = 24 * 60 * 60 * 1000;
const dayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "today, 14:02", "yesterday, 09:10" or "Tuesday 20 October, 14:02", by this device's calendar. */
export function whenLabel(iso: string, now = new Date()): string {
  const at = new Date(iso);
  const time = at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const days = Math.round((dayOf(now) - dayOf(at)) / DAY_MS);
  if (days === 0) return `today, ${time}`;
  if (days === 1) return `yesterday, ${time}`;
  const date = at.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  return `${date}, ${time}`;
}

/** A history entry's state: "Undone …", "37 of 40 cards still here", or nothing when all are. */
export function historyStateLabel(entry: HistoryEntry, now = new Date()): string | undefined {
  if (entry.undoneAt !== null) return `Undone ${whenLabel(entry.undoneAt, now)}`;
  if (entry.live < entry.imported)
    return `${entry.live} of ${cardCount(entry.imported)} still here`;
  return undefined;
}

/**
 * Whether an undone Import's Cards are gone for good: its Undo's Deletion is no
 * longer in Recently deleted (`deletions`, once fetched), by Delete
 * permanently or the 30-day Removal, which both leave it undone.
 */
export const undoRemoved = (
  report: ImportReport,
  deletions: readonly { id: string }[] | undefined,
) =>
  report.undoDeletionId !== null &&
  deletions !== undefined &&
  !deletions.some((deletion) => deletion.id === report.undoDeletionId);

/** Whether a report offers Undo: not undone, with a Card it added live. */
export const canUndo = (report: ImportReport) => report.undoneAt === null && report.live > 0;

/** Undo's question, under "Undo this import?": "Its 24 cards go to Recently deleted for 30 days." */
export const undoQuestion = (report: ImportReport) =>
  `Its ${cardCount(report.live)} ${report.live === 1 ? "goes" : "go"} to Recently deleted for 30 days.`;

/** The counts that make Undo weightier, each only when it isn't 0. */
export function undoFigures(report: ImportReport): { n: number; label: string; note: string }[] {
  return [
    { n: report.studied, label: "studied", note: "their reviews stay" },
    { n: report.edited, label: "edited", note: "since the import" },
    { n: report.moved, label: "moved", note: "to another deck, and go too" },
  ].filter((figure) => figure.n > 0);
}
