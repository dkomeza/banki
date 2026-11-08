import {
  ApiError,
  type CardFileProblem,
  CreateImportResponse,
  type ImportCard,
  ImportRefusedResponse,
  ImportResponse,
} from "@banki/shared";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { type ApiClient, api } from "./api";
import { refreshDeck } from "./cards";
import { CANT_REACH } from "./decks";
import { ApiRequestError } from "./query";

// An Import (CONTEXT.md, ADR-0026): the file goes to the API as it is, which
// reads it into an unconfirmed Import; its page previews it, and confirming
// it turns the page into its report.

export type Import = ImportResponse;

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
    // Ticks and edits live on the page; a refetch must never reset them.
    staleTime: Number.POSITIVE_INFINITY,
  });

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
