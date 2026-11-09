import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type ChatMessage, expandMacros, type GradeResponse, type ModelId } from "@banki/shared";
import { getLogger } from "@logtape/logtape";
import { z } from "zod";
import type { OpenRouterFetch } from "../openrouter/check-api-key";
import {
  type AttemptFailure,
  type GradingFailure,
  type Next,
  nextAfter,
  OPENROUTER_CHAT_URL,
  type RetryOptions,
  withRetries,
} from "./grade";
import { cardContent, type ContentPart, type GradingInput, type ReadImage } from "./request";

// The Follow-up chat (CONTEXT.md): the Grader answers the User's questions
// about a graded Card. The server keeps nothing: each request carries the
// Written answer, its grade and the chat so far, and reads the Card itself.

const logger = getLogger(["banki", "grader"]);

/** The chat's instructions: what it answers, in which language, and what it never does. */
export const CHAT_PROMPT = readFileSync(join(import.meta.dir, "chat-prompt.md"), "utf8");

/** How long to wait for the first word, and then for each next piece: 60 seconds. */
const TIMEOUT_MS = 60_000;

/** What the Grader answers in the chat: the Card graded, its grade, and the chat so far. */
export type ChatInput = GradingInput & {
  grade: GradeResponse;
  messages: readonly ChatMessage[];
};

/** The streamed chat completion OpenRouter is asked for. */
export type ChatCompletionRequest = {
  model: ModelId;
  messages: [
    { role: "system"; content: string },
    { role: "user"; content: ContentPart[] },
    ...{ role: "user" | "assistant"; content: string }[],
  ];
  stream: true;
};

/** `text`'s slice from `from` to `to`, on one line, or undefined when it holds nothing. */
function quoteOf(text: string, { from, to }: { from: number; to: number }) {
  const quote = text.slice(from, to).replaceAll(/\s+/g, " ").trim();
  return quote === "" ? undefined : `"${quote}"`;
}

/**
 * The `<grade>` section: the suggested Rating, and the Highlights quoted
 * from the Written answer as given and the Back as stored, Macros expanded.
 */
function gradeSection({ answer, back, macros, grade }: ChatInput): string {
  const lines = [`Suggested Rating: ${grade.rating}`];
  const mistakes = grade.mistakes.flatMap((mistake) => {
    const quote = quoteOf(answer, mistake);
    return quote === undefined ? [] : [`- ${expandMacros(quote, macros)}: ${mistake.note}`];
  });
  if (mistakes.length > 0) lines.push("Mistakes in the Written answer:", ...mistakes);
  const missing = grade.missing.flatMap((range) => {
    const quote = quoteOf(back, range);
    return quote === undefined ? [] : [`- ${expandMacros(quote, macros)}`];
  });
  if (missing.length > 0) lines.push("Missing from the Written answer, in the Back:", ...missing);
  return `<grade>\n${lines.join("\n")}\n</grade>`;
}

/**
 * The streamed chat completion that answers `input`'s chat with `model`: the
 * Card as the grading request sends it (`cardContent`) with the grade, then
 * the Feedback as the Grader's first reply, then the chat so far.
 */
export function chatRequest(
  input: ChatInput,
  model: ModelId,
  readImage: ReadImage,
): ChatCompletionRequest {
  const { content } = cardContent(input, readImage, [gradeSection(input)]);
  return {
    model,
    messages: [
      { role: "system", content: CHAT_PROMPT },
      { role: "user", content },
      { role: "assistant", content: input.grade.feedback },
      ...input.messages.map((message) => ({
        role: message.role === "user" ? ("user" as const) : ("assistant" as const),
        content: message.text,
      })),
    ],
    stream: true,
  };
}

/** The part of a streamed chunk the chat reads: the first choice's new text, and why it ended. */
const StreamChunk = z.object({
  choices: z
    .array(
      z.object({
        delta: z.object({ content: z.string().nullish() }).nullish(),
        finish_reason: z.string().nullish(),
      }),
    )
    .optional(),
  error: z.unknown().optional(),
});

/** The stream broke: it ended, or OpenRouter said so, before the Model finished. */
class BrokenStream extends Error {}

/**
 * The `data:` of each server-sent event in `body`, as OpenRouter streams
 * them, one line each, until `signal` aborts, which cancels the body.
 */
async function* eventData(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<string> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  const cancel = () => void reader.cancel(signal.reason).catch(() => undefined);
  signal.addEventListener("abort", cancel, { once: true });
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += value;
      for (let end = buffer.indexOf("\n"); end !== -1; end = buffer.indexOf("\n")) {
        const line = buffer.slice(0, end).replace(/\r$/, "");
        buffer = buffer.slice(end + 1);
        // Lines starting with ":" are comments, such as OpenRouter's keep-alives.
        if (line.startsWith("data:")) yield line.slice(5).trimStart();
      }
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => undefined);
  }
}

/**
 * The reply's text as it streams in `body`, piece by piece, empty ones left
 * out. It ends once the Model finished, and throws `BrokenStream` when the
 * stream ends before that, or carries an error; `signal` stops it.
 */
async function* replyText(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<string> {
  let finished = false;
  for await (const data of eventData(body, signal)) {
    if (data === "[DONE]") {
      finished = true;
      break;
    }
    let parsed: z.infer<typeof StreamChunk>;
    try {
      parsed = StreamChunk.parse(JSON.parse(data));
    } catch {
      throw new BrokenStream("A chunk that can't be read");
    }
    const choice = parsed.choices?.[0];
    if (parsed.error !== undefined || choice?.finish_reason === "error") {
      throw new BrokenStream("An error in the stream");
    }
    const text = choice?.delta?.content;
    if (typeof text === "string" && text !== "") yield text;
    if (typeof choice?.finish_reason === "string") finished = true;
  }
  if (!finished) throw new BrokenStream("The stream ended early");
}

/**
 * A reply on its way, its first words in: `rest` yields the pieces after
 * them, ends once the Model finished, and throws when the stream breaks;
 * `abort` stops it.
 */
export type Reply = { first: string; rest: AsyncGenerator<string>; abort: () => void };

/**
 * Asks the User's `model`, on their `apiKey`, to answer `input`'s chat, and
 * answers once its first words are in: the reply on its way, or why it failed.
 *
 * Until the first word, failures are retried as `grade()` retries them (the
 * same backoff, `Retry-After` and permanent errors); a stream that breaks or
 * ends before it, or isn't 60 s in coming, counts as a failed attempt, a
 * timeout ending it as `grade()`'s does. After the first word nothing is
 * retried: a piece more than 60 s in coming, or a broken stream, ends `rest`
 * by throwing. Aborting `signal` stops the retries and the stream. Each
 * failed attempt is logged with its number, OpenRouter's status and the
 * Model, never with a message, the answer, the Card's text or the key.
 */
export async function reply(
  input: ChatInput,
  {
    apiKey,
    model,
    fetch,
    readImage,
    timeoutMs = TIMEOUT_MS,
    signal,
    wait,
    random,
  }: {
    apiKey: string;
    model: ModelId;
    fetch: OpenRouterFetch;
    readImage: ReadImage;
    timeoutMs?: number;
  } & RetryOptions,
): Promise<Reply | { failed: GradingFailure }> {
  const body = JSON.stringify(chatRequest(input, model, readImage));
  const replied = await withRetries(
    (attempt) => attemptReply({ attempt, model, apiKey, body, fetch, timeoutMs, signal }),
    { signal, wait, random },
  );
  return "failed" in replied ? replied : replied.value;
}

/** A timeout's abort reason, as `AbortSignal.timeout` gives it. */
const timedOut = () => new DOMException("The operation timed out.", "TimeoutError");

/**
 * One attempt at the streamed reply: the reply once its first words are in,
 * or what to do next after a failure, logged here (`cancelled` when the
 * caller gave up meanwhile, which isn't).
 */
async function attemptReply({
  attempt,
  model,
  apiKey,
  body,
  fetch,
  timeoutMs,
  signal,
}: {
  attempt: number;
  model: ModelId;
  apiKey: string;
  body: string;
  fetch: OpenRouterFetch;
  timeoutMs: number;
  signal: AbortSignal | undefined;
}): Promise<{ value: Reply } | { next: Next }> {
  const failed = (failure: AttemptFailure, status: number | null, next: Next) => {
    const message =
      status === null
        ? "Chat attempt {attempt} failed ({failure}) with {model}: no answer from OpenRouter"
        : "Chat attempt {attempt} failed ({failure}) with {model}: OpenRouter answered {status}";
    logger.warning(message, { attempt, failure, status, model });
    return { next };
  };

  // Aborts the attempt: on a timeout (until the first word, then between
  // pieces), once the reply is abandoned, or with the caller.
  const stop = new AbortController();
  let abandoned = false;
  let timer = setTimeout(() => stop.abort(timedOut()), timeoutMs);
  const fail = (error: unknown, status: number | null): { next: Next } => {
    clearTimeout(timer);
    stop.abort();
    if (signal?.aborted) return { next: { retry: false, failed: "cancelled" } };
    if (error instanceof Error && error.name === "TimeoutError") {
      return failed("timeout", status, { retry: false, failed: "grading_failed" });
    }
    if (error instanceof BrokenStream) return failed("invalid_response", status, { retry: true });
    return failed("network_error", status, { retry: true });
  };

  let res: Response;
  try {
    res = await fetch(OPENROUTER_CHAT_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body,
      signal: signal === undefined ? stop.signal : AbortSignal.any([signal, stop.signal]),
    });
  } catch (error) {
    return fail(error, null);
  }
  if (!res.ok || res.body === null) {
    clearTimeout(timer);
    await res.body?.cancel();
    return failed("error_status", res.status, res.ok ? { retry: true } : nextAfter(res));
  }

  const pieces = replyText(res.body, stop.signal);
  let first: IteratorResult<string>;
  try {
    first = await pieces.next();
  } catch (error) {
    // A timeout cancels the body's read; a broken stream throws its own error.
    return fail(stop.signal.aborted ? stop.signal.reason : error, res.status);
  }
  if (first.done) return fail(new BrokenStream("No words"), res.status);

  const rest = async function* (): AsyncGenerator<string> {
    try {
      for (;;) {
        clearTimeout(timer);
        timer = setTimeout(() => stop.abort(timedOut()), timeoutMs);
        const piece = await pieces.next();
        if (piece.done) return;
        yield piece.value;
      }
    } catch (error) {
      if (!signal?.aborted && !abandoned) {
        logger.warning("Chat reply cut off with {model}", { model });
      }
      throw error;
    } finally {
      clearTimeout(timer);
      stop.abort();
    }
  };
  return {
    value: {
      first: first.value,
      rest: rest(),
      abort: () => {
        abandoned = true;
        clearTimeout(timer);
        stop.abort();
      },
    },
  };
}
