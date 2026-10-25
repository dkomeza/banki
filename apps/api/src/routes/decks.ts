import { CreateDeckRequest, UpdateDeckRequest } from "@banki/shared";
import { Hono } from "hono";
import { validator } from "hono/validator";
import type { z } from "zod";
import { apiError } from "../http/errors";
import type { SignedInEnv } from "../http/require-signed-in";
import type { DeckRepository } from "../repositories/decks";

/** A JSON body validator that answers 400 `invalid_request` when `schema` refuses it. */
const json = <T extends z.ZodType>(schema: T) =>
  validator("json", (value, c) => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) return c.json(apiError("invalid_request", "Invalid deck"), 400);
    return parsed.data;
  });

const NOT_FOUND = apiError("not_found", "Deck not found");
const NAME_TAKEN = apiError("deck_name_taken", "You already have a deck with this name");

/**
 * The signed-in User's Decks. `GET /` lists those that aren't deleted, `POST /`
 * creates one, and `GET`, `PATCH` and `DELETE /:id` read, change and softly
 * delete one. A deleted Deck, an unknown one and another User's all answer 404
 * `not_found`; a name another Deck has, ignoring case, answers 409
 * `deck_name_taken`.
 */
export function deckRoutes({ decks }: { decks: DeckRepository }) {
  return new Hono<SignedInEnv>()
    .get("/", (c) => c.json(decks.list(c.var.user.id), 200))
    .post("/", json(CreateDeckRequest), (c) => {
      const created = decks.create(c.var.user.id, c.req.valid("json"));
      if (created === "taken") return c.json(NAME_TAKEN, 409);
      return c.json(created, 201);
    })
    .get("/:id", (c) => {
      const found = decks.find(c.var.user.id, c.req.param("id"));
      if (found === undefined) return c.json(NOT_FOUND, 404);
      return c.json(found, 200);
    })
    .patch("/:id", json(UpdateDeckRequest), (c) => {
      const updated = decks.update(c.var.user.id, c.req.param("id"), c.req.valid("json"));
      if (updated === "not_found") return c.json(NOT_FOUND, 404);
      if (updated === "taken") return c.json(NAME_TAKEN, 409);
      return c.json(updated, 200);
    })
    .delete("/:id", (c) => {
      if (!decks.softDelete(c.var.user.id, c.req.param("id"))) return c.json(NOT_FOUND, 404);
      return c.body(null, 204);
    });
}
