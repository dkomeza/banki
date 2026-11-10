import {
  ConfirmImportRequest,
  type CreateImportResponse,
  IMPORT_UPLOAD_MAX_BYTES,
  type ImportHistoryResponse,
  type ImportRefusedResponse,
  type UndoImportResponse,
  UploadImportQuery,
} from "@banki/shared";
import { Hono } from "hono";
import { apiError } from "../http/errors";
import type { SignedInEnv } from "../http/require-signed-in";
import { type Refused, uploadTooLarge } from "../imports/read";
import type { ImportRepository } from "../repositories/imports";
import { json, query } from "./json";

const NOT_FOUND = apiError("not_found", "Import not found");
const DECK_NOT_FOUND = apiError("not_found", "Deck not found");
const IMAGE_NOT_FOUND = apiError("not_found", "Image not found");
const CONFIRMED = apiError("import_confirmed", "This import is already done");
const DECK_GONE = apiError("deck_gone", "The deck was deleted, so nothing was imported");
const UNKNOWN_CARD = apiError("invalid_request", "A card isn't one of the file's");
const NOTHING_TO_UNDO = apiError("nothing_to_undo", "None of this import's cards are here to undo");

/**
 * Whether an upload's `Content-Type` is one a browser sends across origins
 * only after asking first, as for an Image: no HTML form or plain cross-site
 * fetch can send it, so no other site can make the User's browser import.
 */
const isUploadType = (type: string) =>
  type === "application/octet-stream" || type === "application/json" || type === "application/zip";

const refused = (read: Refused): ImportRefusedResponse => ({
  error: { code: "import_refused", message: "This file can't be imported" },
  problems: read.problems,
});

/**
 * The request's body, read as it arrives and no further than 500 MB: one
 * over that is refused without being kept, by its `Content-Length` before
 * anything is read when it has one, otherwise by counting what arrives.
 */
async function readUpload(request: Request): Promise<Uint8Array | Refused> {
  const max = IMPORT_UPLOAD_MAX_BYTES;
  const length = Number(request.headers.get("content-length") ?? Number.NaN);
  if (length > max) return uploadTooLarge(length);
  if (request.body === null) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of request.body) {
    total += chunk.byteLength;
    if (total <= max) chunks.push(chunk);
  }
  if (total > max) return uploadTooLarge(total);
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}

/**
 * Starting an Import into a Deck, under `/api/decks`: `POST /:deckId/imports`
 * takes the file as the request's body, as it is (`?kind=paste` for pasted
 * text, `?kind=file&name=<its name>` for a `.json` or a `.zip`), reads it and
 * answers 201 with the new unconfirmed Import's `id`. A refused file creates
 * nothing and answers 422 `import_refused` with its `problems`, one line
 * each. `GET /:deckId/imports` answers its Past imports, the confirmed ones,
 * newest first. A deleted Deck, an unknown one and another User's answer 404.
 */
export function deckImportRoutes({ imports }: { imports: ImportRepository }) {
  return new Hono<SignedInEnv>()
    .get("/:deckId/imports", (c) => {
      const history = imports.history(c.var.user.id, c.req.param("deckId"));
      if (history === "not_found") return c.json(DECK_NOT_FOUND, 404);
      const body: ImportHistoryResponse = history;
      return c.json(body, 200);
    })
    .post(
      "/:deckId/imports",
      query(UploadImportQuery, "Say whether the file is pasted or chosen"),
      async (c) => {
        const type = c.req.header("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
        if (!isUploadType(type)) {
          return c.json(apiError("invalid_request", "Send the file as the request's body"), 400);
        }
        const { kind, name } = c.req.valid("query");
        const fileName = name === undefined || name === "" ? "Card file" : name;
        const bytes = await readUpload(c.req.raw);
        if ("problems" in bytes) return c.json(refused(bytes), 422);
        const created = imports.create(c.var.user.id, c.req.param("deckId"), {
          bytes,
          kind,
          fileName,
        });
        if (created === "not_found") return c.json(DECK_NOT_FOUND, 404);
        if ("problems" in created) return c.json(refused(created), 422);
        const body: CreateImportResponse = created;
        return c.json(body, 201);
      },
    );
}

/**
 * The signed-in User's Imports, under `/api/imports`. `GET /:id` answers its
 * preview while unconfirmed, or its report once confirmed; `GET
 * /:id/images/<file>` serves a zip's image an unconfirmed Import staged, so
 * its preview shows it. `POST /:id/confirm` takes the ticked Cards and adds
 * them in one transaction, answering the report: one already confirmed
 * answers 409 `import_confirmed`, and one whose Deck is no longer live 409
 * `deck_gone`, each adding nothing. `POST /:id/undo` undoes a confirmed one
 * (ADR-0029), answering its one Deletion and how many Cards it took, or 409
 * `nothing_to_undo` with no live Card stamped with it; an unconfirmed one
 * answers 404. An unknown Import and another User's answer 404.
 */
export function importRoutes({ imports }: { imports: ImportRepository }) {
  return new Hono<SignedInEnv>()
    .get("/:id", (c) => {
      const found = imports.find(c.var.user.id, c.req.param("id"));
      if (found === undefined) return c.json(NOT_FOUND, 404);
      return c.json(found, 200);
    })
    .get("/:id/images/:file", async (c) => {
      const found = imports.stagedImage(c.var.user.id, c.req.param("id"), c.req.param("file"));
      const file = found === undefined ? undefined : Bun.file(found.path);
      if (found === undefined || file === undefined || !(await file.exists())) {
        return c.json(IMAGE_NOT_FOUND, 404);
      }
      return c.body(file.stream(), 200, {
        "content-type": found.contentType,
        "content-length": String(file.size),
        "cache-control": "private, max-age=86400",
      });
    })
    .post("/:id/confirm", json(ConfirmImportRequest, "Invalid cards", { named: true }), (c) => {
      const confirmed = imports.confirm(
        c.var.user.id,
        c.req.param("id"),
        c.req.valid("json").cards,
      );
      if (confirmed === "not_found") return c.json(NOT_FOUND, 404);
      if (confirmed === "confirmed") return c.json(CONFIRMED, 409);
      if (confirmed === "deck_gone") return c.json(DECK_GONE, 409);
      if (confirmed === "unknown_card") return c.json(UNKNOWN_CARD, 400);
      return c.json(confirmed, 200);
    })
    .post("/:id/undo", (c) => {
      const undone = imports.undo(c.var.user.id, c.req.param("id"));
      if (undone === "not_found") return c.json(NOT_FOUND, 404);
      if (undone === "nothing_to_undo") return c.json(NOTHING_TO_UNDO, 409);
      const body: UndoImportResponse = undone;
      return c.json(body, 200);
    });
}
