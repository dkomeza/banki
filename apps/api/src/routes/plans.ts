import { PlanCheckQuery, PutPlanRequest } from "@banki/shared";
import { Hono } from "hono";
import { apiError } from "../http/errors";
import type { SignedInEnv } from "../http/require-signed-in";
import type { PlanRepository } from "../repositories/plans";
import { json, query } from "./json";

const DECK_NOT_FOUND = apiError("not_found", "Deck not found");
const INVALID_PLAN = "Invalid plan";
const INVALID_DEADLINE = apiError(
  "invalid_request",
  "Pick a deadline after today and within 2 years",
);

/**
 * A Deck's Plan, under `/api/decks`: `PUT /:deckId/plan` creates or replaces
 * it and answers it; `DELETE /:deckId/plan` removes it, answering 204 also
 * when there was none; `GET /:deckId/plan/check` answers the feasibility
 * check of the Plan its `deadline` and `dailyMinutes` give, and saves
 * nothing. A Deadline that isn't a Study day after today and within 2 years,
 * by the Timezone and Day start in Settings on each call, or minutes outside
 * 5–600, answer 400 `invalid_request`. A deleted Deck, an unknown one and
 * another User's all answer 404 `not_found`.
 */
export function planRoutes({ plans }: { plans: PlanRepository }) {
  return new Hono<SignedInEnv>()
    .put("/:deckId/plan", json(PutPlanRequest, INVALID_PLAN), (c) => {
      const saved = plans.put(c.var.user.id, c.req.param("deckId"), c.req.valid("json"));
      if (saved === "not_found") return c.json(DECK_NOT_FOUND, 404);
      if (saved === "invalid_deadline") return c.json(INVALID_DEADLINE, 400);
      return c.json(saved, 200);
    })
    .delete("/:deckId/plan", (c) => {
      const removed = plans.remove(c.var.user.id, c.req.param("deckId"));
      if (removed === "not_found") return c.json(DECK_NOT_FOUND, 404);
      return c.body(null, 204);
    })
    .get("/:deckId/plan/check", query(PlanCheckQuery, INVALID_PLAN), (c) => {
      const checked = plans.check(c.var.user.id, c.req.param("deckId"), c.req.valid("query"));
      if (checked === "not_found") return c.json(DECK_NOT_FOUND, 404);
      if (checked === "invalid_deadline") return c.json(INVALID_DEADLINE, 400);
      return c.json(checked, 200);
    });
}
