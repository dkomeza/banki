import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatcherDeps } from "./wiring";

// Everything the tick says goes through the logger it is given, which writes
// the tick log too: its housekeeping's lines included.

const dir = mkdtempSync(join(tmpdir(), "banki-wiring-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("the tick's wiring", () => {
  test("logs a worktree's removal through the tick's logger", async () => {
    const lines: string[] = [];
    const deps = dispatcherDeps({ log: (line) => lines.push(line) });
    mkdirSync(join(dir, "ban-1-x"));

    // Not a worktree with a `ui` script: `ui down` fails, and says so first.
    await deps.housekeeper
      .removeWorktree({ path: join(dir, "ban-1-x"), branch: undefined })
      .catch(() => undefined);

    expect(lines.join("\n")).toContain(`bun run ui down in ${join(dir, "ban-1-x")}`);
  });
});
