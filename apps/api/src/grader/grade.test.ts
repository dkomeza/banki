import { describe, expect, test } from "bun:test";
import type { OpenRouterFetch } from "../openrouter/check-api-key";
import { captureLogs } from "../testing/logs";
import { type GradingFailure, grade, MAX_RETRY_AFTER_MS, retryAfterMs, type Wait } from "./grade";

const logs = captureLogs();

const INPUT = { front: "1 + 1", back: "2", gradingNotes: null, answer: "2", macros: [] };
const MODEL = "anthropic/claude-haiku-5.5";

const GOOD = JSON.stringify({ rating: "good", feedback: "ok", missing: [], mistakes: [] });
const completion = (content = GOOD) => Response.json({ choices: [{ message: { content } }] });

/**
 * A fake clock for the retries' waits: it records each wait and ends it at
 * once, so no test waits for real.
 */
function fakeWaits() {
  const waits: number[] = [];
  const wait: Wait = async (ms) => {
    waits.push(ms);
  };
  return { waits, wait };
}

/** OpenRouter answering `answers` in turn, the last one again once they run out; counts its calls. */
function answering(...answers: (() => Response | Promise<Response>)[]) {
  let calls = 0;
  const fetch: OpenRouterFetch = async () => {
    const answer = answers[Math.min(calls, answers.length - 1)];
    calls += 1;
    if (answer === undefined) throw new Error("no answer");
    return answer();
  };
  return { fetch, calls: () => calls };
}

const status = (code: number, headers?: Record<string, string>) => () =>
  new Response(JSON.stringify({ error: { code } }), { status: code, headers });

const networkError = () => {
  throw new TypeError("fetch failed");
};

/** Grades INPUT with a fake clock and no jitter (`random` at its midpoint). */
const gradeWith = (fetch: OpenRouterFetch, wait: Wait, signal?: AbortSignal) =>
  grade(INPUT, {
    apiKey: "sk-or-v1-test",
    model: MODEL,
    fetch,
    readImage: () => undefined,
    wait,
    random: () => 0.5,
    signal,
  });

/** OpenRouter that never answers, until the request's signal gives up on it. */
const hanging: OpenRouterFetch = (_url, init) =>
  new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  });

/** OpenRouter that starts answering, then never finishes the body, until the signal gives up on it. */
const stalling: OpenRouterFetch = async (_url, init) =>
  new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{"));
        init.signal?.addEventListener("abort", () => controller.error(init.signal?.reason));
      },
    }),
  );

describe("grade", () => {
  test("gives up when OpenRouter doesn't answer in time", async () => {
    const graded = await grade(INPUT, {
      apiKey: "sk-or-v1-test",
      model: "anthropic/claude-haiku-5.5",
      fetch: hanging,
      readImage: () => undefined,
      timeoutMs: 20,
    });

    expect(graded).toEqual({ failed: "grading_failed" });
    expect(logs.at(-1)?.properties).toMatchObject({
      attempt: 1,
      failure: "timeout",
      status: null,
      model: "anthropic/claude-haiku-5.5",
    });
  });

  test("gives up on a body that doesn't arrive in time", async () => {
    const graded = await grade(INPUT, {
      apiKey: "sk-or-v1-test",
      model: "anthropic/claude-haiku-5.5",
      fetch: stalling,
      readImage: () => undefined,
      timeoutMs: 20,
    });

    expect(graded).toEqual({ failed: "grading_failed" });
  });

  test("tells what OpenRouter charged", async () => {
    const content = JSON.stringify({ rating: "good", feedback: "ok", missing: [], mistakes: [] });
    const costs: number[] = [];
    const graded = await grade(INPUT, {
      apiKey: "sk-or-v1-test",
      model: "anthropic/claude-haiku-5.5",
      fetch: async () =>
        Response.json({ choices: [{ message: { content } }], usage: { cost: 0.0042 } }),
      readImage: () => undefined,
      onCost: (usd) => costs.push(usd),
    });

    expect(graded).toMatchObject({ rating: "good" });
    expect(costs).toEqual([0.0042]);
  });

  describe("retries", () => {
    const temporary: [string, () => Response | Promise<Response>][] = [
      ["a network error", networkError],
      ["408", status(408)],
      ["429", status(429)],
      ["500", status(500)],
      ["502", status(502)],
      ["503", status(503)],
      ["504", status(504)],
      [
        "a response that doesn't fit the schema",
        () => completion(JSON.stringify({ rating: "perfect" })),
      ],
      ["a response that isn't JSON", () => completion("not json")],
    ];

    for (const [what, answer] of temporary) {
      test(`retries ${what}, and answers the grade once an attempt succeeds`, async () => {
        const { waits, wait } = fakeWaits();
        const openRouter = answering(answer, answer, () => completion());

        const graded = await gradeWith(openRouter.fetch, wait);

        expect(graded).toMatchObject({ rating: "good", feedback: "ok" });
        expect(openRouter.calls()).toBe(3);
        expect(waits).toEqual([500, 1000]);
      });
    }

    test("makes six attempts in all, waiting 0.5, 1, 2, 4 and 8 s between them, then fails as grading_failed", async () => {
      const { waits, wait } = fakeWaits();
      const openRouter = answering(status(500));

      expect(await gradeWith(openRouter.fetch, wait)).toEqual({ failed: "grading_failed" });
      expect(openRouter.calls()).toBe(6);
      expect(waits).toEqual([500, 1000, 2000, 4000, 8000]);
    });

    test("succeeds on the last attempt", async () => {
      const { wait } = fakeWaits();
      const fail = status(502);
      const openRouter = answering(fail, fail, fail, fail, fail, () => completion());

      expect(await gradeWith(openRouter.fetch, wait)).toMatchObject({ rating: "good" });
      expect(openRouter.calls()).toBe(6);
    });

    test("jitters each wait by up to 20% either way", async () => {
      for (const [random, first] of [
        [0, 400],
        [0.999_999, 600],
      ] as const) {
        const { waits, wait } = fakeWaits();
        await grade(INPUT, {
          apiKey: "sk-or-v1-test",
          model: MODEL,
          fetch: answering(status(500), () => completion()).fetch,
          readImage: () => undefined,
          wait,
          random: () => random,
        });
        expect(waits[0]).toBeCloseTo(first, 0);
      }
    });

    test("waits a Retry-After of at most 8 s on a 429 or 503 instead of its step", async () => {
      const { waits, wait } = fakeWaits();
      const openRouter = answering(
        status(429, { "retry-after": "3" }),
        status(503, { "retry-after": "8" }),
        status(429),
        () => completion(),
      );

      expect(await gradeWith(openRouter.fetch, wait)).toMatchObject({ rating: "good" });
      expect(waits).toEqual([3000, 8000, 2000]);
    });

    test("ends grading at once on a Retry-After over 8 s, as grading_failed", async () => {
      for (const code of [429, 503]) {
        const { waits, wait } = fakeWaits();
        const openRouter = answering(status(code, { "retry-after": "9" }), () => completion());

        expect(await gradeWith(openRouter.fetch, wait)).toEqual({ failed: "grading_failed" });
        expect(openRouter.calls()).toBe(1);
        expect(waits).toEqual([]);
      }
    });

    test("ignores Retry-After on another status", async () => {
      const { waits, wait } = fakeWaits();
      const openRouter = answering(status(500, { "retry-after": "60" }), () => completion());

      expect(await gradeWith(openRouter.fetch, wait)).toMatchObject({ rating: "good" });
      expect(waits).toEqual([500]);
    });

    test("ends grading at once on the timeout, with no retry", async () => {
      const { waits, wait } = fakeWaits();
      let calls = 0;
      const graded = await grade(INPUT, {
        apiKey: "sk-or-v1-test",
        model: MODEL,
        fetch: (url, init) => {
          calls += 1;
          return hanging(url, init);
        },
        readImage: () => undefined,
        timeoutMs: 20,
        wait,
      });

      expect(graded).toEqual({ failed: "grading_failed" });
      expect(calls).toBe(1);
      expect(waits).toEqual([]);
    });

    const permanent: [number, GradingFailure][] = [
      [401, "api_key_refused"],
      [402, "no_credits"],
      [404, "model_unavailable"],
      [400, "grading_refused"],
      [403, "grading_refused"],
      [413, "grading_refused"],
      [422, "grading_refused"],
    ];

    for (const [code, failure] of permanent) {
      test(`fails at once on ${code}, as ${failure}, with no retry`, async () => {
        const { waits, wait } = fakeWaits();
        const openRouter = answering(status(code), () => completion());

        expect(await gradeWith(openRouter.fetch, wait)).toEqual({ failed: failure });
        expect(openRouter.calls()).toBe(1);
        expect(waits).toEqual([]);
      });
    }

    test("logs each failed attempt with its number, status and the Model, and nothing of the Card, the answer or the key", async () => {
      const { wait } = fakeWaits();
      const openRouter = answering(status(500), networkError, status(429), () => completion());
      const secrets = {
        front: "secret front",
        back: "secret back",
        gradingNotes: "secret notes",
        answer: "secret answer",
        macros: [],
      };

      await grade(secrets, {
        apiKey: "sk-or-v1-secret-key",
        model: MODEL,
        fetch: openRouter.fetch,
        readImage: () => undefined,
        wait,
      });

      const attempts = logs.filter((record) => record.category.join(".") === "banki.grader");
      expect(attempts.map((record) => record.level)).toEqual(["warning", "warning", "warning"]);
      expect(attempts.map((record) => record.properties)).toEqual([
        { attempt: 1, failure: "error_status", status: 500, model: MODEL },
        { attempt: 2, failure: "network_error", status: null, model: MODEL },
        { attempt: 3, failure: "error_status", status: 429, model: MODEL },
      ]);
      const logged = JSON.stringify(logs.map((record) => [record.message, record.properties]));
      for (const secret of [
        ...Object.values(secrets).filter((v) => typeof v === "string"),
        "sk-or-v1-secret-key",
      ]) {
        expect(logged).not.toContain(secret);
      }
    });
  });

  describe("aborting", () => {
    test("makes no attempt after the abort, and ends a pending wait", async () => {
      const controller = new AbortController();
      let calls = 0;
      let waited: Promise<void> | undefined;
      const fetch: OpenRouterFetch = async () => {
        calls += 1;
        return status(500)();
      };
      // A wait that only ends on the abort, as the real one would after 0.5 s.
      const wait: Wait = (_ms, signal) => {
        waited = new Promise((resolve) => signal?.addEventListener("abort", () => resolve()));
        controller.abort();
        return waited;
      };

      const graded = await gradeWith(fetch, wait, controller.signal);

      expect(graded).toEqual({ failed: "cancelled" });
      expect(calls).toBe(1);
    });

    test("stops an attempt on its way, and makes no other", async () => {
      const controller = new AbortController();
      const { waits, wait } = fakeWaits();
      let calls = 0;
      const graded = gradeWith(
        (url, init) => {
          calls += 1;
          return hanging(url, init);
        },
        wait,
        controller.signal,
      );
      controller.abort();

      expect(await graded).toEqual({ failed: "cancelled" });
      expect(calls).toBe(1);
      expect(waits).toEqual([]);
    });

    test("makes no attempt when aborted before it starts", async () => {
      const controller = new AbortController();
      controller.abort();
      const openRouter = answering(() => completion());

      expect(await gradeWith(openRouter.fetch, fakeWaits().wait, controller.signal)).toEqual({
        failed: "cancelled",
      });
      expect(openRouter.calls()).toBe(0);
    });

    test("the real wait doesn't start once the signal has aborted", async () => {
      const { realWait } = await import("./grade");
      const started = performance.now();
      await realWait(10_000, AbortSignal.abort());
      expect(performance.now() - started).toBeLessThan(1000);
    });

    test("the real wait ends at once on an abort", async () => {
      const { realWait } = await import("./grade");
      const controller = new AbortController();
      const started = performance.now();
      const waited = realWait(10_000, controller.signal);
      controller.abort();
      await waited;
      expect(performance.now() - started).toBeLessThan(1000);
    });
  });
});

describe("retryAfterMs", () => {
  test("reads delay-seconds and an HTTP date", () => {
    const now = Date.parse("2026-11-08T12:00:00Z");
    expect(retryAfterMs("2", now)).toBe(2000);
    expect(retryAfterMs("0", now)).toBe(0);
    expect(retryAfterMs("Sun, 08 Nov 2026 12:00:05 GMT", now)).toBe(5000);
    expect(retryAfterMs("Sun, 08 Nov 2026 11:00:00 GMT", now)).toBe(0);
    expect(retryAfterMs(null, now)).toBeUndefined();
    expect(retryAfterMs("soon", now)).toBeUndefined();
    expect(MAX_RETRY_AFTER_MS).toBe(8000);
  });
});
