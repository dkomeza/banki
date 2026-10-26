import { CreateDeckRequest, UpdateDeckRequest } from "@banki/shared";
import { Hono } from "hono";
import { apiError } from "../http/errors";
import type { SignedInEnv } from "../http/require-signed-in";
import type { DeckRepository } from "../repositories/decks";
import { INVALID_MOVE, json, nameClash } from "./json";

const NOT_FOUND = apiError("not_found", "Deck not found");
const FOLDER_NOT_FOUND = apiError("not_found", "Folder not found");
const NAME_TAKEN = apiError("deck_name_taken", "There's already a deck with this name here");

/**
 * The signed-in User's Decks. `GET /` lists those that aren't deleted, `POST /`
 * creates one, and `GET`, `PATCH` and `DELETE /:id` read, change or move, and
 * softly delete one. A deleted Deck, an unknown one and another User's all
 * answer 404 `not_found`, and so does such a Folder to put it in. A name
 * another Deck beside it has, ignoring case, answers 409 `deck_name_taken` on
 * a create or a change, and 409 `name_clash` on a move without `onClash`.
 */
export function deckRoutes({ decks }: { decks: DeckRepository }) {
  return new Hono<SignedInEnv>()
    .get("/", (c) => c.json(decks.list(c.var.user.id), 200))
    .post("/", json(CreateDeckRequest, "Invalid deck"), (c) => {
      const created = decks.create(c.var.user.id, c.req.valid("json"));
      if (created === "not_found") return c.json(FOLDER_NOT_FOUND, 404);
      if (created === "taken") return c.json(NAME_TAKEN, 409);
      return c.json(created, 201);
    })
    .get("/:id", (c) => {
      const found = decks.find(c.var.user.id, c.req.param("id"));
      if (found === undefined) return c.json(NOT_FOUND, 404);
      return c.json(found, 200);
    })
    .patch("/:id", json(UpdateDeckRequest, "Invalid deck"), (c) => {
      const updated = decks.update(c.var.user.id, c.req.param("id"), c.req.valid("json"));
      if (updated === "not_found") return c.json(NOT_FOUND, 404);
      if (updated === "taken") return c.json(NAME_TAKEN, 409);
      if (updated === "invalid_move") return c.json(INVALID_MOVE, 400);
      if (updated === "replace_not_allowed") return c.json(INVALID_MOVE, 409);
      if ("clash" in updated) return c.json(nameClash(updated.clash), 409);
      return c.json(updated, 200);
    })
    .delete("/:id", (c) => {
      if (!decks.softDelete(c.var.user.id, c.req.param("id"))) return c.json(NOT_FOUND, 404);
      return c.body(null, 204);
    });
}
