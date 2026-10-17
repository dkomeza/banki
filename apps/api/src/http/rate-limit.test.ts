import { describe, expect, test } from "bun:test";
import { createRateLimiter } from "./rate-limit";

const fakeClock = (start = 1_000_000) => {
  let time = start;
  return {
    now: () => time,
    advance: (ms: number) => {
      time += ms;
    },
  };
};

describe("createRateLimiter", () => {
  test("allows max attempts per key within the window, then refuses with seconds to wait", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ max: 5, windowMs: 60_000, now: clock.now });

    for (let attempt = 1; attempt <= 5; attempt++) {
      expect(limiter.consume("203.0.113.7")).toEqual({ allowed: true });
      clock.advance(1000);
    }

    expect(limiter.consume("203.0.113.7")).toEqual({ allowed: false, retryAfterSeconds: 55 });
  });

  test("counts each key separately", () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 60_000, now: fakeClock().now });

    expect(limiter.consume("203.0.113.7")).toEqual({ allowed: true });
    expect(limiter.consume("198.51.100.1")).toEqual({ allowed: true });
    expect(limiter.consume("203.0.113.7").allowed).toBe(false);
  });

  test("allows attempts again once the window has passed", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ max: 2, windowMs: 60_000, now: clock.now });
    limiter.consume("203.0.113.7");
    limiter.consume("203.0.113.7");
    expect(limiter.consume("203.0.113.7").allowed).toBe(false);

    clock.advance(60_000);

    expect(limiter.consume("203.0.113.7")).toEqual({ allowed: true });
    expect(limiter.consume("203.0.113.7")).toEqual({ allowed: true });
    expect(limiter.consume("203.0.113.7").allowed).toBe(false);
  });

  test("refused attempts don't extend the wait", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ max: 1, windowMs: 60_000, now: clock.now });
    limiter.consume("203.0.113.7");

    clock.advance(30_000);
    expect(limiter.consume("203.0.113.7")).toEqual({ allowed: false, retryAfterSeconds: 30 });
    clock.advance(29_500);
    expect(limiter.consume("203.0.113.7")).toEqual({ allowed: false, retryAfterSeconds: 1 });
    clock.advance(500);
    expect(limiter.consume("203.0.113.7")).toEqual({ allowed: true });
  });
});
