import { Hono } from "hono";
import { apiError } from "../http/errors";
import type { SignedInEnv } from "../http/require-signed-in";
import type { TuningRepository } from "../repositories/tuning";

const DEFAULTS_IN_USE = apiError("defaults_in_use", "Scheduling already uses the defaults");

/**
 * The signed-in User's Tuning, under `/api/tuning`. `GET /` answers how it
 * stands; `POST /` is Tune now, answering the Tuning's result and the new
 * status once it has run (during a running Tuning, that one's); `POST /reset`
 * is Reset to defaults, answering the new status, or 409 `defaults_in_use`
 * while the defaults already are.
 */
export function tuningRoutes({ tuning }: { tuning: TuningRepository }) {
  return new Hono<SignedInEnv>()
    .get("/", (c) => c.json(tuning.status(c.var.user.id), 200))
    .post("/", async (c) => c.json(await tuning.tuneNow(c.var.user.id), 200))
    .post("/reset", async (c) => {
      const reset = await tuning.reset(c.var.user.id);
      if (reset === "defaults_in_use") return c.json(DEFAULTS_IN_USE, 409);
      return c.json(reset, 200);
    });
}

const DECK_NOT_FOUND = apiError("not_found", "Deck not found");

/**
 * How Tuning stands for one of the signed-in User's Decks, under `/api/decks`:
 * `GET /:deckId/tuning` (ADR-0033). A deleted Deck, an unknown one and
 * another User's all answer 404 `not_found`.
 */
export function deckTuningRoutes({ tuning }: { tuning: TuningRepository }) {
  return new Hono<SignedInEnv>().get("/:deckId/tuning", (c) => {
    const status = tuning.deckStatus(c.var.user.id, c.req.param("deckId"));
    if (status === "not_found") return c.json(DECK_NOT_FOUND, 404);
    return c.json(status, 200);
  });
}
