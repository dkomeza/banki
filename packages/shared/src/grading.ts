import { z } from "zod";
import { CARD_SIDE_MAX_LENGTH } from "./cards";
import { Rating } from "./scheduling";

// Grading (CONTEXT.md): the Grader turns a Written answer into a suggested
// Rating, with Feedback and Highlights. The API grades; the web app shows it.

/** The longest a Written answer may be: a Card side's limit. */
export const WRITTEN_ANSWER_MAX_LENGTH = CARD_SIDE_MAX_LENGTH;

/**
 * The body of `POST /api/cards/:cardId/grade`: the Written answer, kept
 * exactly as typed (never trimmed), holding something other than whitespace,
 * up to 20,000 characters.
 */
export const GradeRequest = z.strictObject({
  answer: z
    .string()
    .refine((answer) => answer.trim() !== "", "Write an answer first")
    .refine(
      (answer) => answer.length <= WRITTEN_ANSWER_MAX_LENGTH,
      `Keep it to ${WRITTEN_ANSWER_MAX_LENGTH.toLocaleString("en-GB")} characters`,
    ),
});
export type GradeRequest = z.infer<typeof GradeRequest>;

/** A range of a text, `from` (inclusive) to `to` (exclusive), in UTF-16 code units as JavaScript counts them. */
export const TextRange = z
  .object({ from: z.number().int().min(0), to: z.number().int().min(0) })
  .refine(({ from, to }) => to > from, "Expected a range that isn't empty");
export type TextRange = z.infer<typeof TextRange>;

/**
 * The body of a grade: the Grader's suggested Rating, its Feedback (Markdown
 * with LaTeX), and its Highlights: `missing` are ranges of the Back as stored
 * that the Written answer leaves out, and `mistakes` ranges of the Written
 * answer as it was sent that are wrong, each with a note on what is wrong.
 */
export const GradeResponse = z.object({
  rating: Rating,
  feedback: z.string(),
  missing: z.array(TextRange),
  mistakes: z.array(
    z
      .object({ from: z.number().int().min(0), to: z.number().int().min(0), note: z.string() })
      .refine(({ from, to }) => to > from, "Expected a range that isn't empty"),
  ),
});
export type GradeResponse = z.infer<typeof GradeResponse>;

// The Follow-up chat (CONTEXT.md): the User asks the Grader about a graded
// Card, before rating it. The server keeps nothing, so each request carries
// the whole chat so far, with the Written answer and its grade.

/** The longest a Grader's reply may be, sent back in a later request: far more than any reply. */
export const CHAT_REPLY_MAX_LENGTH = 100_000;

/**
 * One message of a Follow-up chat: the User's, holding something other than
 * whitespace, up to 20,000 characters, or the Grader's reply as it came, not
 * empty.
 */
export const ChatMessage = z.discriminatedUnion("role", [
  z.strictObject({
    role: z.literal("user"),
    text: z
      .string()
      .refine((text) => text.trim() !== "", "Write a message first")
      .refine(
        (text) => text.length <= WRITTEN_ANSWER_MAX_LENGTH,
        `Keep it to ${WRITTEN_ANSWER_MAX_LENGTH.toLocaleString("en-GB")} characters`,
      ),
  }),
  z.strictObject({
    role: z.literal("grader"),
    text: z.string().min(1).max(CHAT_REPLY_MAX_LENGTH),
  }),
]);
export type ChatMessage = z.infer<typeof ChatMessage>;

/**
 * The body of `POST /api/cards/:cardId/chat`: the Written answer as it was
 * graded, its grade, and the chat so far, oldest first, ending with the
 * User's message the Grader is to answer.
 */
export const ChatRequest = z.strictObject({
  answer: GradeRequest.shape.answer,
  grade: GradeResponse,
  messages: z
    .array(ChatMessage)
    .refine((messages) => messages.at(-1)?.role === "user", "End the chat with your message"),
});
export type ChatRequest = z.infer<typeof ChatRequest>;

/**
 * One line of the chat route's answer (newline-delimited JSON): the next
 * piece of the reply, or its end. A stream that stops without the end was
 * cut off.
 */
export const ChatChunk = z.union([
  z.strictObject({ text: z.string() }),
  z.strictObject({ end: z.literal(true) }),
]);
export type ChatChunk = z.infer<typeof ChatChunk>;
