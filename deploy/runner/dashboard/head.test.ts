import { describe, expect, test } from "bun:test";
import { watchHead } from "./head";

// The Dashboard runs from the clone of `main`, and goes once the clone's HEAD
// has moved, for Docker to start it again on the new `main`.

const A = "a".repeat(40);
const B = "b".repeat(40);

/** Reads each of `heads` in turn, then the last one for good. */
const reader = (heads: (string | undefined)[]) => {
  let i = 0;
  return async () => heads[Math.min(i++, heads.length - 1)];
};

describe("watching the clone's HEAD", () => {
  test("says so once it has moved, and only then", async () => {
    const heads = [A, A, undefined, B];
    const moves: string[] = [];

    const stop = await watchHead({
      read: reader(heads),
      everyMs: 5,
      onMove: (head) => moves.push(head),
    });
    await Bun.sleep(60);
    stop();

    expect(moves).toEqual([B]);
  });

  test("takes the first HEAD it can read as where it started", async () => {
    const heads = [undefined, A, A, B];
    const moves: string[] = [];

    const stop = await watchHead({
      read: reader(heads),
      everyMs: 5,
      onMove: (head) => moves.push(head),
    });
    await Bun.sleep(60);
    stop();

    expect(moves).toEqual([B]);
  });
});
