import { CreateCardRequest, UpdateCardRequest } from "@banki/shared";
import { Hono } from "hono";
import { apiError } from "../http/errors";
import type { SignedInEnv } from "../http/require-signed-in";
import type { CardRepository } from "../repositories/cards";
import { json } from "./json";

const NOT_FOUND = apiError("not_found", "Card not found");
const DECK_NOT_FOUND = apiError("not_found", "Deck not found");

/**
 * A Deck's Cards, under `/api/decks`: `GET /:deckId/cards` lists its live
 * Cards, newest first, and `POST /:deckId/cards` creates one. A deleted Deck,
 * an unknown one and another User's all answer 404 `not_found`.
 */
export function deckCardRoutes({ cards }: { cards: CardRepository }) {
  return new Hono<SignedInEnv>()
    .get("/:deckId/cards", (c) => {
      const listed = cards.list(c.var.user.id, c.req.param("deckId"));
      if (listed === "not_found") return c.json(DECK_NOT_FOUND, 404);
      return c.json(listed, 200);
    })
    .post("/:deckId/cards", json(CreateCardRequest, "Invalid card"), (c) => {
      const created = cards.create(c.var.user.id, c.req.param("deckId"), c.req.valid("json"));
      if (created === "not_found") return c.json(DECK_NOT_FOUND, 404);
      return c.json(created, 201);
    });
}

/**
 * The signed-in User's Cards, under `/api/cards`: `GET`, `PATCH` and `DELETE
 * /:id` read, change and softly delete one, a delete answering its
 * `deletionId`, which `POST /api/deletions/:id/restore` undoes. A deleted Card,
 * an unknown one, another User's and one whose Deck is deleted all answer 404
 * `not_found`. A blank Front or Back, or one over 20,000 characters, answers 400
 * `invalid_request`.
 */
export function cardRoutes({ cards }: { cards: CardRepository }) {
  return new Hono<SignedInEnv>()
    .get("/:id", (c) => {
      const found = cards.find(c.var.user.id, c.req.param("id"));
      if (found === undefined) return c.json(NOT_FOUND, 404);
      return c.json(found, 200);
    })
    .patch("/:id", json(UpdateCardRequest, "Invalid card"), (c) => {
      const updated = cards.update(c.var.user.id, c.req.param("id"), c.req.valid("json"));
      if (updated === "not_found") return c.json(NOT_FOUND, 404);
      return c.json(updated, 200);
    })
    .delete("/:id", (c) => {
      const deletionId = cards.softDelete(c.var.user.id, c.req.param("id"));
      if (deletionId === undefined) return c.json(NOT_FOUND, 404);
      return c.json({ deletionId }, 200);
    });
}
