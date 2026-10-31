import {
  CreateCardRequest,
  type DeleteCardsResponse,
  DeleteCardsRequest,
  MoveCardsRequest,
  type MoveCardsResponse,
  ReviewRequest,
  UpdateCardRequest,
} from "@banki/shared";
import { Hono } from "hono";
import { apiError } from "../http/errors";
import type { SignedInEnv } from "../http/require-signed-in";
import type { CardRepository } from "../repositories/cards";
import type { ReviewRepository } from "../repositories/reviews";
import { json } from "./json";

const NOT_FOUND = apiError("not_found", "Card not found");
const DECK_NOT_FOUND = apiError("not_found", "Deck not found");
const CARDS_NOT_FOUND = apiError("not_found", "A card or the deck is gone");

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
    .post("/:deckId/cards", json(CreateCardRequest, "Invalid card", { named: true }), (c) => {
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
 * `invalid_request`, as does a Tag that isn't one word of 1 to 50 characters,
 * or more than 20 Tags. Tags given to `PATCH` replace the Card's.
 *
 * `POST /move` Moves Cards to another Deck, and `POST /delete` deletes Cards
 * at once, each as a Deletion of its own, answering every `deletionId`. Each
 * takes 1 to 10,000 Card IDs and acts on all of them or none: one Card that
 * isn't live, or a Move's Deck that isn't, answers 404 `not_found`.
 *
 * `POST /:id/reviews` rates a Card: it records a Review of its Rating and
 * time spent, reschedules the Card, and answers 201 with the Review and the
 * Card's new schedule. A Rating that isn't one, or a duration that isn't a
 * whole number of milliseconds from 0, answers 400 `invalid_request`.
 */
export function cardRoutes({
  cards,
  reviews,
}: {
  cards: CardRepository;
  reviews: ReviewRepository;
}) {
  return new Hono<SignedInEnv>()
    .post("/move", json(MoveCardsRequest, "Invalid move"), (c) => {
      const { cardIds, deckId } = c.req.valid("json");
      const moved = cards.move(c.var.user.id, cardIds, deckId);
      if (moved === "not_found") return c.json(CARDS_NOT_FOUND, 404);
      const body: MoveCardsResponse = { cards: moved };
      return c.json(body, 200);
    })
    .post("/delete", json(DeleteCardsRequest, "Invalid delete"), (c) => {
      const deletions = cards.softDeleteAll(c.var.user.id, c.req.valid("json").cardIds);
      if (deletions === "not_found") return c.json(NOT_FOUND, 404);
      const body: DeleteCardsResponse = { deletions };
      return c.json(body, 200);
    })
    .post("/:id/reviews", json(ReviewRequest, "Invalid review"), (c) => {
      const rated = reviews.rate(c.var.user.id, c.req.param("id"), c.req.valid("json"));
      if (rated === "not_found") return c.json(NOT_FOUND, 404);
      return c.json(rated, 201);
    })
    .get("/:id", (c) => {
      const found = cards.find(c.var.user.id, c.req.param("id"));
      if (found === undefined) return c.json(NOT_FOUND, 404);
      return c.json(found, 200);
    })
    .patch("/:id", json(UpdateCardRequest, "Invalid card", { named: true }), (c) => {
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
