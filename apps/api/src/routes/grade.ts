import { readFileSync } from "node:fs";
import { effectiveMacros, GradeRequest, type ModelId, modelById } from "@banki/shared";
import { Hono } from "hono";
import { type GradingFailure, grade, type Wait } from "../grader/grade";
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

/** What each failure answers, all 502: OpenRouter is the one that failed. */
const FAILURES = {
  api_key_refused: () =>
    apiError("api_key_refused", "OpenRouter didn't accept your API key. Check it in Settings."),
  no_credits: () =>
    apiError("no_credits", "Your OpenRouter account is out of credits. Add some, then try again."),
  model_unavailable: (model: ModelId) =>
    apiError(
      "model_unavailable",
      `OpenRouter can't run ${modelById(model).name} right now. Pick another Model in Settings.`,
    ),
  grading_refused: () =>
    apiError("grading_refused", "OpenRouter refused to grade this answer. Rate it yourself."),
  grading_failed: () =>
    apiError("grading_failed", "Couldn't grade this answer. Try again, or rate it yourself."),
  // No one is listening for this one: the client gave up.
  cancelled: () => apiError("grading_failed", "Grading was cancelled."),
} satisfies Record<GradingFailure, (model: ModelId) => unknown>;

/**
 * Grading, under `/api/cards`: `POST /:cardId/grade` asks the User's Model,
 * on their API key, to grade the Written answer `answer` against the Card,
 * and answers the `GradeResponse`. It stores nothing, neither the answer nor
 * the Feedback. A deleted Card, one in a deleted Deck and another User's
 * answer 404 `not_found`; a blank answer or one over 20,000 characters 400
 * `invalid_request`, before OpenRouter is asked; no API key, or one that
 * can't be read, 409 `no_api_key`. When OpenRouter fails, `grade()`
 * retries the temporary errors, and the route answers 502 with the failure's
 * code: `api_key_refused`, `no_credits`, `model_unavailable`,
 * `grading_refused` or `grading_failed`. The client aborting the request
 * stops the retries. `wait` is how a retry waits, faked by the tests.
 */
export function gradeRoutes({
  cards,
  decks,
  settings,
  images,
  openRouterFetch,
  wait,
}: {
  cards: CardRepository;
  decks: DeckRepository;
  settings: SettingsRepository;
  images: ImageRepository;
  openRouterFetch: OpenRouterFetch;
  wait?: Wait;
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
        { apiKey, model, fetch: openRouterFetch, readImage, signal: c.req.raw.signal, wait },
      );
      if ("failed" in graded) return c.json(FAILURES[graded.failed](model), 502);
      return c.json(graded, 200);
    },
  );
}
