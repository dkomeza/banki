import { StudyNextQuery } from "@banki/shared";
import { Hono } from "hono";
import { apiError } from "../http/errors";
import type { SignedInEnv } from "../http/require-signed-in";
import type { StudyRepository } from "../repositories/study";
import { query } from "./json";

const DECK_NOT_FOUND = apiError("not_found", "Deck not found");

/**
 * Studying a Deck, under `/api/decks`: `GET /:deckId/study/next` answers the
 * Card its Queue shows next, with its schedule and `kind`, or `next: null` when
 * the Queue is empty. The query's `reviewsShown` and `newShown` (0 when left
 * out) count the review and new Cards the Session has shown, and `after` is
 * the Card it showed last; `batches` (1 when left out) is how many New-card
 * batches it has been given. A count that isn't a whole number from 0, or
 * `batches` that isn't one from 1, answers 400 `invalid_request`. The
 * New-card batch and the Learning limit are read from the Settings on every
 * call, and an empty Queue's `newHeld` says how many New cards the batch
 * held back. A deleted Deck, an unknown one and another User's all
 * answer 404 `not_found`.
 */
export function studyRoutes({ study }: { study: StudyRepository }) {
  return new Hono<SignedInEnv>().get(
    "/:deckId/study/next",
    query(StudyNextQuery, "Invalid study progress"),
    (c) => {
      const next = study.next(c.var.user.id, c.req.param("deckId"), c.req.valid("query"));
      if (next === "not_found") return c.json(DECK_NOT_FOUND, 404);
      return c.json(next, 200);
    },
  );
}
