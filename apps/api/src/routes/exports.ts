import { Hono } from "hono";
import type { Config } from "../config";
import { attachment, exportDeck } from "../exports/deck";
import { apiError } from "../http/errors";
import type { SignedInEnv } from "../http/require-signed-in";
import type { CardRepository } from "../repositories/cards";
import type { DeckRepository } from "../repositories/decks";
import type { ImageRepository } from "../repositories/images";
import type { SettingsRepository } from "../repositories/settings";

const DECK_NOT_FOUND = apiError("not_found", "Deck not found");

/**
 * Exporting a Deck, under `/api/decks`: `GET /:deckId/export` answers the
 * Deck as a `.zip` to save, `<Deck name>.zip`, holding its Card file and the
 * Images its Cards show. A deleted Deck, an unknown one and another User's
 * answer 404 `not_found`.
 */
export function deckExportRoutes(deps: {
  decks: DeckRepository;
  cards: CardRepository;
  settings: SettingsRepository;
  images: ImageRepository;
  config: Pick<Config, "origin">;
}) {
  return new Hono<SignedInEnv>().get("/:deckId/export", (c) => {
    const exported = exportDeck(deps, c.var.user.id, c.req.param("deckId"), {
      origin: deps.config.origin,
    });
    if (exported === "not_found") return c.json(DECK_NOT_FOUND, 404);
    return c.body(exported.zip, 200, {
      "Content-Type": "application/zip",
      "Content-Disposition": attachment(exported.fileName),
      "Content-Length": String(exported.zip.length),
      "Cache-Control": "no-store",
    });
  });
}
