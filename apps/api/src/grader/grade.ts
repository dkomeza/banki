import { type GradeResponse, type ModelId, Rating, type TextRange } from "@banki/shared";
import { getLogger } from "@logtape/logtape";
import { z } from "zod";
import type { OpenRouterFetch } from "../openrouter/check-api-key";
import { highlightRange } from "./highlights";
import { type GradingInput, gradingRequest, type ReadImage } from "./request";

const logger = getLogger(["banki", "grader"]);

/** OpenRouter's chat completions endpoint. */
export const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

/** How long to wait for the Grader before giving up: 60 seconds. */
const TIMEOUT_MS = 60_000;

/** The Grader's answer, as the strict schema it is given asks for it (`GRADE_JSON_SCHEMA`). */
const ModelGrade = z.object({
  rating: Rating,
  feedback: z.string(),
  missing: z.array(z.object({ line: z.number(), quote: z.string() })),
  mistakes: z.array(z.object({ line: z.number(), quote: z.string(), note: z.string() })),
});

/** The part of a chat completion the Grader reads: the first choice's message. */
const ChatCompletion = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
});

/** Why grading failed: OpenRouter answered an error status, couldn't be reached, took too long, or answered something that doesn't fit the schema. */
export type GradingFailure = "error_status" | "network_error" | "timeout" | "invalid_response";

/**
 * Grades `input` with the User's `model` on their `apiKey`, in one chat
 * completion: a `GradeResponse` whose Highlights are ranges of the Back as
 * stored and the Written answer as given (one that points at no line is
 * dropped), or why it failed. A failure is logged with OpenRouter's status and
 * the Model, never with the answer, the Card's text or the key.
 */
export async function grade(
  input: GradingInput,
  {
    apiKey,
    model,
    fetch,
    readImage,
    timeoutMs = TIMEOUT_MS,
  }: {
    apiKey: string;
    model: ModelId;
    fetch: OpenRouterFetch;
    readImage: ReadImage;
    timeoutMs?: number;
  },
): Promise<GradeResponse | { failed: GradingFailure }> {
  const request = gradingRequest(input, model, readImage);
  const failed = (failure: GradingFailure, status: number | null = null) => {
    logger.warning("Grading failed ({failure}): OpenRouter answered {status} for {model}", {
      failure,
      status,
      model,
    });
    return { failed: failure };
  };

  let res: Response;
  let body: unknown;
  try {
    res = await fetch(OPENROUTER_CHAT_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      await res.body?.cancel();
      return failed("error_status", res.status);
    }
    body = await res.json();
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return failed(timedOut ? "timeout" : "network_error");
  }

  const completion = ChatCompletion.safeParse(body);
  let answered: z.infer<typeof ModelGrade> | undefined;
  if (completion.success) {
    try {
      const parsed = ModelGrade.safeParse(
        JSON.parse(completion.data.choices[0]?.message.content ?? ""),
      );
      if (parsed.success) answered = parsed.data;
    } catch {
      // Not JSON: as good as not fitting the schema.
    }
  }
  if (answered === undefined) return failed("invalid_response", res.status);

  const missing: TextRange[] = [];
  for (const highlight of answered.missing) {
    const range = highlightRange(request.back, highlight);
    if (range !== undefined) missing.push(range);
  }
  const mistakes: GradeResponse["mistakes"] = [];
  for (const highlight of answered.mistakes) {
    const range = highlightRange(request.answer, highlight);
    if (range !== undefined) mistakes.push({ ...range, note: highlight.note });
  }
  return { rating: answered.rating, feedback: answered.feedback, missing, mistakes };
}
