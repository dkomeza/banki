import { tmpdir } from "node:os";
import { failure, run } from "../lib/run";
import { GATE_ARGS, type Reading, readingFrom } from "./gate";

// The `claude` adapter for the gate (ADR-0013): one line from Haiku, with the
// Runner's Claude token, whose `rate_limit_event` says how much of each usage
// window is used. A reading that fails starts nothing.

export async function takeReading(
  claudeToken: string,
  now: () => Date = () => new Date(),
): Promise<Reading> {
  const result = await run(GATE_ARGS, {
    timeoutMs: 120_000,
    cwd: tmpdir(),
    env: { CLAUDE_CODE_OAUTH_TOKEN: claudeToken },
  });
  if (result.exitCode !== 0) throw new Error(`the gate's claude call ${failure(result)}`);
  return readingFrom(result.stdout, now());
}
