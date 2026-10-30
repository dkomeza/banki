import { Hono } from "hono";
import { apiError } from "../http/errors";
import type { SignedInEnv } from "../http/require-signed-in";
import type { StudyRepository } from "../repositories/study";

const NOT_FOUND = apiError("not_found", "Review not found");
const NOT_NEWEST = apiError("review_not_newest", "Only a Card's newest Review can be undone");

/**
 * The User's Reviews, under `/api/reviews`. `DELETE /:id` undoes one
 * (ADR-0025): it deletes the Review, puts its Card's memory state back to the
 * one from before it, and answers 200 with the Card, its schedule and its
 * Interval previews. A Review that isn't its Card's newest answers 409
 * `review_not_newest`; a missing one, another User's, and one whose Card is
 * deleted all answer 404 `not_found`.
 */
export function reviewRoutes({ study }: { study: StudyRepository }) {
  return new Hono<SignedInEnv>().delete("/:id", (c) => {
    const undone = study.undo(c.var.user.id, c.req.param("id"));
    if (undone === "not_found") return c.json(NOT_FOUND, 404);
    if (undone === "not_newest") return c.json(NOT_NEWEST, 409);
    return c.json(undone, 200);
  });
}
