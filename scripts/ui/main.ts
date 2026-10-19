import { readFileSync } from "node:fs";
import { constants } from "node:os";
import { join, relative } from "node:path";
import { type Command, parseCommand, type UpMode, USAGE, UsageError } from "./args.ts";
import { launchChromium, shootRoutes } from "./browser.ts";
import { themes } from "./shots.ts";
import { decideUp, type StackFile } from "./stack-file.ts";
import {
  EMAIL,
  readStackFile,
  recordedStackRunning,
  refreshSetupUrl,
  exclusively,
  removeStackFile,
  removeUnusedDataDirs,
  ROOT,
  Stack,
  STACK_FILE,
  stopRecordedStack,
  UI_DIR,
  UiError,
} from "./stack.ts";

// The `ui` script: lets the /work-issue agents (and anyone) see the web app.
// It starts a throwaway copy of Banki on free ports in this worktree, set up,
// seeded and signed in, and screenshots routes at phone, tablet and desktop
// sizes (`shoot`), or leaves the copy running to drive with playwright-cli
// (`up` / `down`). Run with `bun run ui …`; see the README.
//
// Node runs it (Playwright doesn't support Bun), straight from TypeScript, so
// it imports no workspace packages at runtime.

// SIGINT, SIGTERM and SIGHUP don't kill the script: they abort the run, which
// lands in a `finally` that stops the stack and deletes its data.
const interrupt = new AbortController();
let interruptedBy: "SIGINT" | "SIGTERM" | "SIGHUP" | undefined;
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    if (interruptedBy === undefined) console.error(`\nInterrupted (${signal}), stopping…`);
    interruptedBy ??= signal;
    interrupt.abort(new UiError(`Interrupted by ${signal}`));
  });
}

const show = (path: string) => relative(process.cwd(), path) || ".";

function webPackageJson(): unknown {
  return JSON.parse(readFileSync(join(ROOT, "apps/web/package.json"), "utf8"));
}

async function shoot({ routes, agent, mode }: Extract<Command, { name: "shoot" }>) {
  const { signal } = interrupt;
  const browser = await launchChromium();
  // Closing the browser fails whatever it is doing, so an interrupt mid-shot
  // goes straight to the teardown.
  const closeBrowser = () => void browser.close();
  signal.addEventListener("abort", closeBrowser);
  const stack = new Stack();
  try {
    signal.throwIfAborted();
    await stack.start({ mode, watch: false, signal });
    const shootThemes = themes(webPackageJson());
    console.log(`Shooting ${routes.join(" ")} (${shootThemes.join(" and ")})`);
    const files = await shootRoutes({
      browser,
      url: stack.url,
      routes,
      themes: shootThemes,
      storageState: stack.signedInState,
      outDir: join(UI_DIR, "shots", agent),
    });
    for (const file of files) console.log(`  ${show(file)}`);
  } finally {
    signal.removeEventListener("abort", closeBrowser);
    await browser.close();
    console.log("Stopping the stack");
    await stack.teardown();
  }
}

function describeStack(file: StackFile): string {
  const lines = [
    `The ui stack is running at ${file.url} (stack.json: ${show(STACK_FILE)})`,
    `  API on ${file.apiPort} under bun --watch, data in ${show(file.dataDir)}`,
    `  logs: ${show(file.logs.api)}, ${show(file.logs.web)}`,
  ];
  if (file.mode === "signed-in") {
    lines.push(`  signed in as ${EMAIL}: playwright-cli state-load ${show(file.signedInState)}`);
  } else {
    lines.push(`  waiting for Setup: ${file.setupUrl}`);
  }
  lines.push("Stop it with: bun run ui down");
  return lines.join("\n");
}

async function up({ mode }: Extract<Command, { name: "up" }>) {
  const { signal } = interrupt;
  // Agents drive this stack with playwright-cli, on the same Chromium.
  await (await launchChromium()).close();
  // A second ui up at the same moment waits here, then reuses this one's stack.
  await exclusively(signal, () => upExclusively(mode, signal));
}

async function upExclusively(mode: UpMode, signal: AbortSignal) {
  const recorded = readStackFile();
  if (recorded === "corrupt") {
    throw new UiError(`${show(STACK_FILE)} can't be read. Run bun run ui down first.`);
  }
  const decision = decideUp(
    recorded,
    recorded !== undefined && recordedStackRunning(recorded),
    mode,
  );
  switch (decision.action) {
    case "mode-mismatch":
      throw new UiError(
        `A ui stack is already running ${decision.running === "signed-in" ? "signed in" : "before Setup"}. Run bun run ui down first.`,
      );
    case "reuse":
      console.log(describeStack(refreshSetupUrl(decision.stack)));
      return;
    case "replace-stale":
      console.log("The recorded ui stack has stopped; clearing it away");
      await stopRecordedStack(decision.stack);
      break;
    case "start":
      break;
  }

  const stack = new Stack();
  try {
    await stack.start({ mode, watch: true, signal });
    signal.throwIfAborted();
    console.log(describeStack(stack.handOver(mode)));
  } finally {
    // Stops it only if it wasn't handed over: a failed or interrupted start.
    await stack.teardown();
  }
}

async function down() {
  await exclusively(interrupt.signal, downExclusively);
}

async function downExclusively() {
  const recorded = readStackFile();
  const said: string[] = [];
  if (recorded === "corrupt") {
    removeStackFile();
    said.push(`Removed the unreadable ${show(STACK_FILE)}`);
  } else if (recorded !== undefined) {
    await stopRecordedStack(recorded);
    said.push(`Stopped the ui stack at ${recorded.url} and deleted ${show(recorded.dataDir)}`);
  }
  // Also a stack whose stack.json was lost or unreadable, or one a racing
  // ui up never recorded: it is stopped before its folder goes.
  const { removed, stopped } = await removeUnusedDataDirs();
  if (stopped > 0) said.push(`Stopped ${stopped} unrecorded ui stack(s)`);
  if (removed.length > 0) said.push(`Removed unused data folders: ${removed.join(", ")}`);
  console.log(said.length > 0 ? said.join("\n") : "No ui stack is running.");
}

async function main(argv: string[]) {
  const command = parseCommand(argv);
  switch (command.name) {
    case "help":
      console.log(USAGE);
      return;
    case "shoot":
      return shoot(command);
    case "up":
      return up(command);
    case "down":
      return down();
  }
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  if (interruptedBy !== undefined) {
    console.error("Stopped.");
    process.exit(128 + constants.signals[interruptedBy]);
  }
  if (error instanceof UsageError) {
    console.error(`${error.message}\n\n${USAGE}`);
    process.exit(2);
  }
  console.error(error instanceof UiError ? error.message : error);
  process.exit(1);
}
// Playwright and the signal handlers would otherwise keep it alive.
process.exit(0);
