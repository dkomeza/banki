import { readFileSync } from "node:fs";
import { effectiveMacros, GradeRequest } from "@banki/shared";
import { Hono } from "hono";
import { grade } from "../grader/grade";
import type { ReadImage } from "../grader/request";
import { apiError } from "../http/errors";
import type { SignedInEnv } from "../http/require-signed-in";
import type { OpenRouterFetch } from "../openrouter/check-api-key";
import type { CardRepository } from "../repositories/cards";
import type { DeckRepository } from "../repositories/decks";
import type { ImageRepository } from "../repositories/images";
import type { SettingsRepository } from "../repositories/settings";
import { json } from "./json";

const NOT_FOUND = apiError("not_found", "Card not found");
const NO_API_KEY = apiError("no_api_key", "Add your OpenRouter API key in Settings to grade.");
const GRADING_FAILED = apiError("grading_failed", "The Grader couldn't grade this answer.");

/**
 * Grading, under `/api/cards`: `POST /:cardId/grade` asks the User's Model,
 * on their API key, to grade the Written answer `answer` against the Card,
 * and answers the `GradeResponse`. It stores nothing, neither the answer nor
 * the Feedback. A deleted Card, one in a deleted Deck and another User's
 * answer 404 `not_found`; a blank answer or one over 20,000 characters 400
 * `invalid_request`, before OpenRouter is asked; no API key, or one that
 * can't be read, 409 `no_api_key`; and anything that goes wrong with
 * OpenRouter 502 `grading_failed`.
 */
export function gradeRoutes({
  cards,
  decks,
  settings,
  images,
  openRouterFetch,
}: {
  cards: CardRepository;
  decks: DeckRepository;
  settings: SettingsRepository;
  images: ImageRepository;
  openRouterFetch: OpenRouterFetch;
}) {
  return new Hono<SignedInEnv>().post(
    "/:cardId/grade",
    json(GradeRequest, "Invalid answer", { named: true }),
    async (c) => {
      const userId = c.var.user.id;
      const card = cards.find(userId, c.req.param("cardId"));
      const deck = card === undefined ? undefined : decks.find(userId, card.deckId);
      if (card === undefined || deck === undefined) return c.json(NOT_FOUND, 404);
      const { apiKey, model } = settings.graderSettings(userId);
      if (apiKey === undefined) return c.json(NO_API_KEY, 409);

      const readImage: ReadImage = (file) => {
        const found = images.find(userId, file);
        if (found === undefined) return undefined;
        try {
          return { contentType: found.contentType, bytes: readFileSync(found.path) };
        } catch {
          return undefined;
        }
      };
      const graded = await grade(
        {
          front: card.front,
          back: card.back,
          gradingNotes: card.gradingNotes,
          answer: c.req.valid("json").answer,
          macros: effectiveMacros(settings.get(userId).macros, deck.macros),
        },
        { apiKey, model, fetch: openRouterFetch, readImage },
      );
      if ("failed" in graded) return c.json(GRADING_FAILED, 502);
      return c.json(graded, 200);
    },
  );
}
