import { describe, expect, test } from "bun:test";
import type { OpenRouterFetch } from "../openrouter/check-api-key";
import { captureLogs } from "../testing/logs";
import { grade } from "./grade";

const logs = captureLogs();

const INPUT = { front: "1 + 1", back: "2", gradingNotes: null, answer: "2", macros: [] };

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

    expect(graded).toEqual({ failed: "timeout" });
    expect(logs.at(-1)?.properties).toMatchObject({
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

    expect(graded).toEqual({ failed: "timeout" });
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
});
