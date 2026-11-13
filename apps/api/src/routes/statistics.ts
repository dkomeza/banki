import { StatisticsQuery } from "@banki/shared";
import { Hono } from "hono";
import { apiError } from "../http/errors";
import type { SignedInEnv } from "../http/require-signed-in";
import type { StatisticsRepository } from "../repositories/statistics";
import { query } from "./json";

const DECK_NOT_FOUND = apiError("not_found", "Deck not found");
const INVALID_RANGE = "Pick a range of 7, 30 or 90 days, or all";

/**
 * The signed-in User's statistics over every Deck, under `/api/statistics`:
 * `GET /` answers them for `?range=7|30|90|all` (30 when left out), worked
 * out on each call by the Timezone and Day start in Settings. Any other range
 * answers 400 `invalid_request`.
 */
export function statisticsRoutes({ statistics }: { statistics: StatisticsRepository }) {
  return new Hono<SignedInEnv>().get("/", query(StatisticsQuery, INVALID_RANGE), (c) =>
    c.json(statistics.overall(c.var.user.id, c.req.valid("query").range), 200),
  );
}

/**
 * One Deck's statistics, under `/api/decks`: `GET /:deckId/statistics`, of
 * the Reviews whose Deck it is, with the range as `GET /api/statistics`
 * takes it. A deleted Deck, an unknown one and another User's all answer 404
 * `not_found`.
 */
export function deckStatisticsRoutes({ statistics }: { statistics: StatisticsRepository }) {
  return new Hono<SignedInEnv>().get(
    "/:deckId/statistics",
    query(StatisticsQuery, INVALID_RANGE),
    (c) => {
      const found = statistics.deck(
        c.var.user.id,
        c.req.param("deckId"),
        c.req.valid("query").range,
      );
      if (found === "not_found") return c.json(DECK_NOT_FOUND, 404);
      return c.json(found, 200);
    },
  );
}
