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
