import { existsSync } from "node:fs";
import { join } from "node:path";
import { errorText } from "../lib/config";
import { failure, run } from "../lib/run";
import { changedPaths, CLONE, pinsOnMain, prepareWork, syncMain } from "./clone";
import { imageCheck, type Stuck, stuckReport, type Toolchain } from "./sync";

// The Runner's tick loop (ADR-0012), baked into the image. Every 5 minutes it
// brings its clone onto `main` in place, even while a Stage runs there, and
// then runs `deploy/runner/tick.ts` from the clone, so a change merged to
// `main` applies on the next tick with no Docker socket and no rebuild. Only
// what is baked into the image (this loop, the Broker, the wrappers on PATH)
// needs `docker compose … up -d --build` by hand, and the loop says when:
// when they changed on `main`, or when `main` pins another bun or node.
// A failed sync skips the tick, a failed tick is logged, and the loop goes on.

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
/** The syncs that have failed in a row, if the last one did. */
let stuck: Stuck | undefined;

/** The bun this loop runs on and the node beside it: the image's own. */
async function imageToolchain(): Promise<Toolchain> {
  const node = await run(["node", "--version"], { timeoutMs: 30_000 });
  return { bun: Bun.version, node: node.stdout.trim().replace(/^v/, "") };
}

async function tick(image: Toolchain): Promise<void> {
  let main: string;
  try {
    main = await syncMain();
  } catch (error) {
    // Never a tick on a clone that may be half-synced.
    stuck = { failures: (stuck?.failures ?? 0) + 1, since: stuck?.since ?? new Date() };
    console.error(stuckReport(stuck, errorText(error)));
    return;
  }
  if (stuck !== undefined) {
    console.log(`The clone is on main again, after ${stuck.failures} failed syncs`);
    stuck = undefined;
  }

  if (main !== warnedOn) {
    const check = imageCheck({
      built,
      main,
      changedPaths: await changedPaths(built, main),
      image,
      pins: pinsOnMain(),
    });
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
    env: { BANKI_RUNNER_MAIN: main },
    logAs: "tick",
  });
  if (result.exitCode !== 0) console.error(`The tick failed: ${failure(result)}`);
}

prepareWork();
const image = await imageToolchain();
console.log(
  `Ticking every ${TICK_MS / 60_000} minutes, from an image built from ${built === "" ? "an unknown commit" : built.slice(0, 7)}, with bun ${image.bun} and node ${image.node}`,
);
for (;;) {
  const started = Date.now();
  await tick(image).catch((error: unknown) => {
    console.error(`The tick failed: ${errorText(error)}`);
  });
  await Bun.sleep(Math.max(0, started + TICK_MS - Date.now()));
}
