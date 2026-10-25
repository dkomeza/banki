import { describe, expect, test } from "bun:test";
import { linear } from "./linear";

// The Dispatcher's Linear adapter waits out a fresh token's blindness, as
// `runner stage` does (cli/linear.test.ts).

describe("the Dispatcher's Linear adapter", () => {
  test("retries a query a fresh token couldn't see, and gets its answer", async () => {
    const answers = [
      {
        status: 400,
        body: {
          errors: [{ message: "Entity not found: Issue", extensions: { code: "INPUT_ERROR" } }],
        },
      },
      { status: 200, body: { data: { viewer: { id: "runner" } } } },
    ];
    let calls = 0;
    const client = linear("lin", {
      fetch: async () => {
        const answer = answers[Math.min(calls++, answers.length - 1)];
        return new Response(JSON.stringify(answer?.body), { status: answer?.status ?? 500 });
      },
      sleep: async () => undefined,
    });

    expect(await client.viewer()).toBe("runner");
    expect(calls).toBe(2);
  });
});
