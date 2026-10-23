import { existsSync } from "node:fs";
import { join } from "node:path";
import { errorText } from "../lib/config";
import { failure, run } from "../lib/run";
import { changedPaths, CLONE, prepareWork, syncMain } from "./clone";
import { imageCheck } from "./sync";

// The Runner's tick loop (ADR-0012), baked into the image. Every 5 minutes it
// brings its clone onto `main` in place, even while a Stage runs there, and
// then runs `deploy/runner/tick.ts` from the clone, so a change merged to
// `main` applies on the next tick with no Docker socket and no rebuild. Only
// what is baked into the image (this loop, the broker, the wrappers on PATH)
// needs `docker compose … up -d --build` by hand, and the loop says when.
// A failed fetch or tick is logged, and the loop goes on.

const TICK_MS = 5 * 60_000;
/** The tick script's limit: well past what it takes, short of hanging the loop. */
const TICK_TIMEOUT_MS = 10 * 60_000;
const TICK_SCRIPT = "deploy/runner/tick.ts";
const REBUILD =
  'BANKI_RUNNER_COMMIT="$(git rev-parse HEAD)" docker compose -f deploy/runner/compose.yaml up -d --build';

/** The `main` commit the image was built from, set at build time; empty when it wasn't given. */
const built = process.env.BANKI_RUNNER_COMMIT?.trim() ?? "";
/** The `main` the image was last reported stale on, so it is said once per commit. */
let warnedOn = "";

async function tick(): Promise<void> {
  let main: string | undefined;
  try {
    main = await syncMain();
  } catch (error) {
    console.error(
      `Couldn't bring the clone onto main, ticking on what it has: ${errorText(error)}`,
    );
  }

  if (main !== undefined && main !== warnedOn) {
    const check = imageCheck({ built, main, changedPaths: await changedPaths(built, main) });
    if (check.kind === "stale") {
      warnedOn = main;
      console.warn(
        `The image is behind main ${main.slice(0, 7)}: ${check.why}. Rebuild it by hand, from a checkout of main on the server:\n  ${REBUILD}`,
      );
    }
  }

  if (!existsSync(join(CLONE, TICK_SCRIPT))) {
    console.error(`No ${TICK_SCRIPT} in the clone yet, so no tick`);
    return;
  }
  const result = await run(["bun", TICK_SCRIPT], {
    cwd: CLONE,
    timeoutMs: TICK_TIMEOUT_MS,
    env: { BANKI_RUNNER_MAIN: main ?? "" },
    logAs: "tick",
  });
  if (result.exitCode !== 0) console.error(`The tick failed: ${failure(result)}`);
}

prepareWork();
console.log(
  `Ticking every ${TICK_MS / 60_000} minutes, from an image built from ${built === "" ? "an unknown commit" : built.slice(0, 7)}`,
);
for (;;) {
  const started = Date.now();
  await tick().catch((error: unknown) => {
    console.error(`The tick failed: ${errorText(error)}`);
  });
  await Bun.sleep(Math.max(0, started + TICK_MS - Date.now()));
}
