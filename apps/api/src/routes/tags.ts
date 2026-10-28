import { Hono } from "hono";
import type { SignedInEnv } from "../http/require-signed-in";
import type { CardRepository } from "../repositories/cards";

/**
 * The signed-in User's Tags, under `/api/tags`: `GET /` answers the Tags some
 * live Card in a live Deck carries, A–Z, which the Tags field suggests from.
 */
export function tagRoutes({ cards }: { cards: CardRepository }) {
  return new Hono<SignedInEnv>().get("/", (c) => c.json(cards.tags(c.var.user.id), 200));
}
