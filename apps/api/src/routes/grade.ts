import { readFileSync } from "node:fs";
import {
  type ChatChunk,
  ChatRequest,
  effectiveMacros,
  GradeRequest,
  type ModelId,
  modelById,
} from "@banki/shared";
import { Hono } from "hono";
import { reply } from "../grader/chat";
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
const NO_API_KEY_TO_ASK = apiError(
  "no_api_key",
  "Add your OpenRouter API key in Settings to ask the Grader.",
);

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

/** What each failure of a Follow-up chat's reply answers: `FAILURES`, reworded for a reply. */
const CHAT_FAILURES = {
  ...FAILURES,
  grading_refused: () => apiError("grading_refused", "OpenRouter refused to answer this."),
  grading_failed: () => apiError("grading_failed", "Couldn't answer. Try again."),
  cancelled: () => apiError("grading_failed", "The answer was cancelled."),
} satisfies Record<GradingFailure, (model: ModelId) => unknown>;

const encoder = new TextEncoder();

/** One line of the chat route's answer. */
const chunkLine = (chunk: ChatChunk) => encoder.encode(`${JSON.stringify(chunk)}\n`);

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
 * stops the retries.
 *
 * `POST /:cardId/chat` asks the same Model to answer the Follow-up chat
 * `messages` about the Card, its Written answer `answer` and its `grade`,
 * and streams the reply as newline-delimited `ChatChunk`s: its pieces, then
 * `{ end: true }` once the Model finished; a stream that breaks after the
 * first word stops without it. The Card (its sides, Grading notes and
 * Images) and the Deck's Macros are read here, never taken from the client.
 * It stores nothing. It answers the same 404, 409 and 502s as grading, its
 * messages reworded for a reply, before the first word; 400
 * `invalid_request` for a blank message, one over 20,000 characters, or a
 * chat that doesn't end with the User's message. The client aborting the
 * request stops the retries and the stream.
 *
 * `wait` is how a retry waits, faked by the tests.
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
  /** The User's Card and its Deck, live, or undefined when either is deleted, or isn't theirs. */
  const live = (userId: string, cardId: string) => {
    const card = cards.find(userId, cardId);
    const deck = card === undefined ? undefined : decks.find(userId, card.deckId);
    return card === undefined || deck === undefined ? undefined : { card, deck };
  };
  /** How the Grader reads the User's Images. */
  const imageReader =
    (userId: string): ReadImage =>
    (file) => {
      const found = images.find(userId, file);
      if (found === undefined) return undefined;
      try {
        return { contentType: found.contentType, bytes: readFileSync(found.path) };
      } catch {
        return undefined;
      }
    };

  return new Hono<SignedInEnv>()
    .post("/:cardId/grade", json(GradeRequest, "Invalid answer", { named: true }), async (c) => {
      const userId = c.var.user.id;
      const found = live(userId, c.req.param("cardId"));
      if (found === undefined) return c.json(NOT_FOUND, 404);
      const { card, deck } = found;
      const { apiKey, model } = settings.graderSettings(userId);
      if (apiKey === undefined) return c.json(NO_API_KEY, 409);

      const graded = await grade(
        {
          front: card.front,
          back: card.back,
          gradingNotes: card.gradingNotes,
          answer: c.req.valid("json").answer,
          macros: effectiveMacros(settings.get(userId).macros, deck.macros),
        },
        {
          apiKey,
          model,
          fetch: openRouterFetch,
          readImage: imageReader(userId),
          signal: c.req.raw.signal,
          wait,
        },
      );
      if ("failed" in graded) return c.json(FAILURES[graded.failed](model), 502);
      return c.json(graded, 200);
    })
    .post("/:cardId/chat", json(ChatRequest, "Invalid chat", { named: true }), async (c) => {
      const userId = c.var.user.id;
      const found = live(userId, c.req.param("cardId"));
      if (found === undefined) return c.json(NOT_FOUND, 404);
      const { card, deck } = found;
      const { apiKey, model } = settings.graderSettings(userId);
      if (apiKey === undefined) return c.json(NO_API_KEY_TO_ASK, 409);

      const { answer, grade: graded, messages } = c.req.valid("json");
      const replied = await reply(
        {
          front: card.front,
          back: card.back,
          gradingNotes: card.gradingNotes,
          answer,
          macros: effectiveMacros(settings.get(userId).macros, deck.macros),
          grade: graded,
          messages,
        },
        {
          apiKey,
          model,
          fetch: openRouterFetch,
          readImage: imageReader(userId),
          signal: c.req.raw.signal,
          wait,
        },
      );
      if ("failed" in replied) return c.json(CHAT_FAILURES[replied.failed](model), 502);

      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(chunkLine({ text: replied.first }));
        },
        async pull(controller) {
          try {
            const piece = await replied.rest.next();
            if (piece.done) {
              controller.enqueue(chunkLine({ end: true }));
              controller.close();
            } else {
              controller.enqueue(chunkLine({ text: piece.value }));
            }
          } catch {
            // Cut off: the stream stops without its end.
            controller.close();
          }
        },
        cancel() {
          replied.abort();
        },
      });
      return c.body(body, 200, {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-store",
      });
    });
}
