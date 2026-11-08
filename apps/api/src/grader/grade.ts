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

/** The waits before each retry, in milliseconds: five retries, about 15 s in all. */
export const RETRY_WAITS_MS = [500, 1000, 2000, 4000, 8000] as const;

/** How far a retry's wait may stray from its step, either way: 20%. */
const JITTER = 0.2;

/** The longest `Retry-After` waited out: 8 s. A longer one ends grading. */
export const MAX_RETRY_AFTER_MS = 8000;

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
  usage: z.object({ cost: z.number().optional() }).optional(),
});

/**
 * Why grading failed. The permanent ones, never retried: OpenRouter refused
 * the API key (401), the account is out of credits (402), the Model can't be
 * run (404), or it refused the request (any other 4xx). `grading_failed`:
 * temporary errors, after the last retry, or one not worth retrying (our
 * timeout, a long `Retry-After`). `cancelled`: the caller gave up.
 */
export type GradingFailure =
  | "api_key_refused"
  | "no_credits"
  | "model_unavailable"
  | "grading_refused"
  | "grading_failed"
  | "cancelled";

/** Waits `ms`, or until `signal` aborts, whichever comes first. */
export type Wait = (ms: number, signal: AbortSignal | undefined) => Promise<void>;

/** The real wait, on a timer. */
export const realWait: Wait = (ms, signal) =>
  new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });

/** What went wrong with one attempt, as the log names it. */
type AttemptFailure = "error_status" | "network_error" | "timeout" | "invalid_response";

/**
 * What to do after a failed attempt: `retry` (after the backoff step, or
 * after `waitMs` when OpenRouter said), or `stop` with the failure to answer.
 */
type Next = { retry: true; waitMs?: number } | { retry: false; failed: GradingFailure };

/** A permanent error status's failure, or undefined for a temporary one (408, 429, 5xx). */
function permanentFailure(status: number): GradingFailure | undefined {
  if (status === 401) return "api_key_refused";
  if (status === 402) return "no_credits";
  if (status === 404) return "model_unavailable";
  if (status === 408 || status === 429 || status < 400 || status >= 500) return undefined;
  return "grading_refused";
}

/**
 * A `Retry-After` header in milliseconds from `now`: delay-seconds or an
 * HTTP date, or undefined when it is missing or unreadable.
 */
export function retryAfterMs(header: string | null, now = Date.now()): number | undefined {
  if (header === null || header.trim() === "") return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

/**
 * Grades `input` with the User's `model` on their `apiKey`: a `GradeResponse`
 * whose Highlights are ranges of the Back as stored and the Written answer as
 * given (one that points at no line is dropped), or why it failed.
 *
 * Temporary errors (a network error, 408, 429, 5xx, an answer that doesn't
 * fit the schema) are retried, up to {@link RETRY_WAITS_MS}'s five times,
 * waiting each step ±20% before the retry; a 429 or 503's `Retry-After` of
 * at most 8 s replaces its step, and a longer one ends grading. A timed-out
 * attempt ends grading, and a permanent error fails at once. Aborting
 * `signal` makes no further attempt and ends a pending wait. Each failed
 * attempt is logged with its number, OpenRouter's status and the Model,
 * never with the answer, the Card's text or the key.
 */
export async function grade(
  input: GradingInput,
  {
    apiKey,
    model,
    fetch,
    readImage,
    timeoutMs = TIMEOUT_MS,
    signal,
    wait = realWait,
    random = Math.random,
    onCost,
  }: {
    apiKey: string;
    model: ModelId;
    fetch: OpenRouterFetch;
    readImage: ReadImage;
    timeoutMs?: number;
    /** The caller giving up: no attempt after it, and a pending wait ends. */
    signal?: AbortSignal;
    /** How a retry waits: on a timer unless a test fakes it. */
    wait?: Wait;
    /** A number in [0, 1), for the jitter. */
    random?: () => number;
    /** Told what OpenRouter charged, in US dollars, for a completion that answered. */
    onCost?: (usd: number) => void;
  },
): Promise<GradeResponse | { failed: GradingFailure }> {
  const request = gradingRequest(input, model, readImage);
  const body = JSON.stringify(request.body);

  for (let attempt = 1; ; attempt += 1) {
    if (signal?.aborted) return { failed: "cancelled" };
    const tried = await attemptGrade({
      attempt,
      model,
      apiKey,
      body,
      fetch,
      timeoutMs,
      signal,
      onCost,
    });
    if ("answer" in tried) return gradeResponseOf(tried.answer, request.back, request.answer);
    const { next } = tried;
    if (!next.retry) return { failed: next.failed };
    const step = RETRY_WAITS_MS[attempt - 1];
    if (step === undefined) return { failed: "grading_failed" };
    await wait(next.waitMs ?? step * (1 + (random() * 2 - 1) * JITTER), signal);
  }
}

/**
 * One attempt at the chat completion: the Grader's answer, or what to do
 * next after a failure, logged here (`cancelled` when the caller gave up
 * meanwhile, which isn't).
 */
async function attemptGrade({
  attempt,
  model,
  apiKey,
  body,
  fetch,
  timeoutMs,
  signal,
  onCost,
}: {
  attempt: number;
  model: ModelId;
  apiKey: string;
  body: string;
  fetch: OpenRouterFetch;
  timeoutMs: number;
  signal: AbortSignal | undefined;
  onCost: ((usd: number) => void) | undefined;
}): Promise<{ answer: z.infer<typeof ModelGrade> } | { next: Next }> {
  const failed = (failure: AttemptFailure, status: number | null, next: Next) => {
    const message =
      status === null
        ? "Grading attempt {attempt} failed ({failure}) with {model}: no answer from OpenRouter"
        : "Grading attempt {attempt} failed ({failure}) with {model}: OpenRouter answered {status}";
    logger.warning(message, { attempt, failure, status, model });
    return { next };
  };

  const timeout = AbortSignal.timeout(timeoutMs);
  let res: Response;
  let json: unknown;
  try {
    res = await fetch(OPENROUTER_CHAT_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body,
      signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
    });
    if (!res.ok) {
      await res.body?.cancel();
      const permanent = permanentFailure(res.status);
      if (permanent !== undefined) {
        return failed("error_status", res.status, { retry: false, failed: permanent });
      }
      if (res.status === 429 || res.status === 503) {
        const after = retryAfterMs(res.headers.get("retry-after"));
        if (after !== undefined) {
          return failed(
            "error_status",
            res.status,
            after > MAX_RETRY_AFTER_MS
              ? { retry: false, failed: "grading_failed" }
              : { retry: true, waitMs: after },
          );
        }
      }
      return failed("error_status", res.status, { retry: true });
    }
    json = await res.json();
  } catch (error) {
    if (signal?.aborted) return { next: { retry: false, failed: "cancelled" } };
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return timedOut
      ? failed("timeout", null, { retry: false, failed: "grading_failed" })
      : failed("network_error", null, { retry: true });
  }

  const completion = ChatCompletion.safeParse(json);
  const cost = completion.success ? completion.data.usage?.cost : undefined;
  if (cost !== undefined) onCost?.(cost);
  let answer: z.infer<typeof ModelGrade> | undefined;
  if (completion.success) {
    try {
      const parsed = ModelGrade.safeParse(
        JSON.parse(completion.data.choices[0]?.message.content ?? ""),
      );
      if (parsed.success) answer = parsed.data;
    } catch {
      // Not JSON: as good as not fitting the schema.
    }
  }
  if (answer === undefined) return failed("invalid_response", res.status, { retry: true });
  return { answer };
}

/** The Grader's answer as a `GradeResponse`, its Highlights mapped to ranges of the stored texts. */
function gradeResponseOf(
  answered: z.infer<typeof ModelGrade>,
  back: ReturnType<typeof gradingRequest>["back"],
  answer: ReturnType<typeof gradingRequest>["answer"],
): GradeResponse {
  const missing: TextRange[] = [];
  for (const highlight of answered.missing) {
    const range = highlightRange(back, highlight);
    if (range !== undefined) missing.push(range);
  }
  const mistakes: GradeResponse["mistakes"] = [];
  for (const highlight of answered.mistakes) {
    const range = highlightRange(answer, highlight);
    if (range !== undefined) mistakes.push({ ...range, note: highlight.note });
  }
  return { rating: answered.rating, feedback: answered.feedback, missing, mistakes };
}
