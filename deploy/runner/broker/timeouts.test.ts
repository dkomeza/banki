import { describe, expect, test } from "bun:test";
import {
  CLIENT_TIMEOUT_MS,
  IDLE_TIMEOUT_S,
  MAX_UPSTREAM_CALLS,
  UPSTREAM_TIMEOUT_MS,
} from "./timeouts";

// Bun closes a connection after `idleTimeout` (10 s by default) with nothing
// sent, which cut off a mint that took longer: each wait must outlast the
// one inside it.

describe("the Broker's timeouts", () => {
  test("a client waits past the Broker's longest request", () => {
    expect(CLIENT_TIMEOUT_MS).toBeGreaterThan(MAX_UPSTREAM_CALLS * UPSTREAM_TIMEOUT_MS);
  });

  test("the Broker keeps the connection open past what a client waits, within Bun's limit", () => {
    expect(IDLE_TIMEOUT_S * 1000).toBeGreaterThan(CLIENT_TIMEOUT_MS);
    expect(IDLE_TIMEOUT_S).toBeLessThanOrEqual(255);
  });

  test("the wrappers on PATH wait past a GitHub token's mint, two calls, and within the idle timeout", async () => {
    for (const name of ["gh", "git-credential-banki"]) {
      const script = await Bun.file(`${import.meta.dir}/../bin/${name}`).text();
      const maxTime = Number(/--max-time (\d+)/.exec(script)?.[1]);
      expect(maxTime * 1000).toBeGreaterThan(2 * UPSTREAM_TIMEOUT_MS);
      expect(maxTime).toBeLessThan(IDLE_TIMEOUT_S);
    }
  });
});
