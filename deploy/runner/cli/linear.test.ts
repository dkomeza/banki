import { describe, expect, test } from "bun:test";
import { BLIND_RETRIES_MS, issueBranch } from "./linear";

// A fresh Linear token, minted just after another of the app's was revoked,
// answers "Entity not found" for under a second: the reads wait it out.

const BLIND = {
  errors: [{ message: "Entity not found: Issue", extensions: { code: "INPUT_ERROR" } }],
};
const FOUND = { data: { issue: { branchName: "bankirunner/ban-1-x" } } };

/** A fetch that answers each call with the next of `answers`, and counts them. */
function answering(...answers: { status: number; body: unknown }[]) {
  const seen = { calls: 0 };
  const fetch = async () => {
    const answer = answers[Math.min(seen.calls, answers.length - 1)];
    seen.calls += 1;
    return new Response(JSON.stringify(answer?.body), { status: answer?.status ?? 500 });
  };
  return { fetch, seen };
}

/** What a promise rejects with, or undefined when it resolves. */
const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error: unknown) => error,
  );

const slept: number[] = [];
const sleep = async (ms: number) => {
  slept.push(ms);
};

describe("the issue's branch, read with a fresh token", () => {
  test("is read once the token sees the issue, whether its blindness came as a 200 or a 400", async () => {
    const { fetch, seen } = answering(
      { status: 200, body: BLIND },
      { status: 400, body: BLIND },
      { status: 200, body: FOUND },
    );
    slept.length = 0;

    expect(await issueBranch("lin", "BAN-1", undefined, { fetch, sleep })).toBe(
      "bankirunner/ban-1-x",
    );
    expect(seen.calls).toBe(3);
    expect(slept).toEqual(BLIND_RETRIES_MS.slice(0, 2));
  });

  test("gives up after the last retry, saying what Linear said", async () => {
    const { fetch, seen } = answering({ status: 200, body: BLIND });

    expect(
      String(await failure(issueBranch("lin", "BAN-1", undefined, { fetch, sleep }))),
    ).toContain("Entity not found");
    expect(seen.calls).toBe(BLIND_RETRIES_MS.length + 1);
  });

  test("never retries any other error", async () => {
    const { fetch, seen } = answering({
      status: 200,
      body: { errors: [{ message: "Rate limited", extensions: { code: "RATELIMITED" } }] },
    });

    expect(
      String(await failure(issueBranch("lin", "BAN-1", undefined, { fetch, sleep }))),
    ).toContain("Rate limited");
    expect(seen.calls).toBe(1);
  });

  test("never retries an HTTP error that isn't blindness", async () => {
    const { fetch, seen } = answering({ status: 401, body: { error: "unauthorized" } });

    expect(
      String(await failure(issueBranch("lin", "BAN-1", undefined, { fetch, sleep }))),
    ).toContain("HTTP 401");
    expect(seen.calls).toBe(1);
  });
});
