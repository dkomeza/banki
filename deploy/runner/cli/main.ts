import { errorText } from "../lib/config";
import { parseArgs, USAGE } from "./args";
import { runStage } from "./stage";

// `runner <command>`, run from the clone of `main` by the `runner` wrapper on
// PATH (bin/runner), so a merged change applies on the next tick:
//
//   docker compose -f deploy/runner/compose.yaml exec runner runner status
//   docker compose -f deploy/runner/compose.yaml exec runner runner run-now BAN-94
//   docker compose -f deploy/runner/compose.yaml exec runner runner stage implement BAN-94
//
// `run-now` logs as the tick does: to the terminal and to the tick log.

const parsed = parseArgs(process.argv.slice(2));
switch (parsed.command) {
  case "help":
    console.log(USAGE);
    break;
  case "error":
    console.error(parsed.message);
    process.exit(2);
    break;
  case "stage":
    try {
      process.exit(await runStage(parsed.kind, parsed.issue));
    } catch (error) {
      console.error(`The ${parsed.kind} Stage on ${parsed.issue} failed: ${errorText(error)}`);
      process.exit(1);
    }
    break;
  case "status": {
    const [{ status }, { dispatcherDeps }] = await Promise.all([
      import("../dispatch/dispatcher"),
      import("../dispatch/wiring"),
    ]);
    try {
      console.log(await status(dispatcherDeps()));
    } catch (error) {
      console.error(`runner status failed: ${errorText(error)}`);
      process.exit(1);
    }
    break;
  }
  case "run-now": {
    const [{ runNow }, { dispatcherDeps }, { tickLogger }, { run }] = await Promise.all([
      import("../dispatch/dispatcher"),
      import("../dispatch/wiring"),
      import("../dispatch/tick-log"),
      import("../lib/run"),
    ]);
    // The commit of `main` it runs from: bin/runner runs it in the clone.
    const head = await run(["git", "rev-parse", "HEAD"], { timeoutMs: 30_000 }).catch(
      () => undefined,
    );
    const main = head?.exitCode === 0 ? head.stdout.trim() : "";
    const log = tickLogger({ main });
    const fail = tickLogger({ main, print: (line) => console.error(line) });
    try {
      const started = await runNow(parsed.issue, parsed.force, dispatcherDeps({ log }));
      if (started.log === undefined) {
        log(`Nothing starts on ${parsed.issue}: ${started.why ?? "nothing is ready"}`);
        process.exit(1);
      }
      log(
        `Started ${parsed.issue}'s Stage under its supervisor.\n  The Stage's log: ${started.log}\n  The supervisor's: ${started.log.replace(/\.jsonl$/, ".log")}`,
      );
    } catch (error) {
      fail(`runner run-now ${parsed.issue} failed: ${errorText(error)}`);
      process.exit(1);
    }
    break;
  }
  case "supervise": {
    const [{ supervise }, { supervisorDeps }] = await Promise.all([
      import("../dispatch/supervisor"),
      import("../dispatch/wiring"),
    ]);
    try {
      process.exit(
        await supervise(
          parsed.kind,
          parsed.issue,
          { log: parsed.log, resume: parsed.resume },
          supervisorDeps(),
        ),
      );
    } catch (error) {
      console.error(
        `The supervisor of the ${parsed.kind} Stage on ${parsed.issue} failed: ${errorText(error)}`,
      );
      process.exit(1);
    }
  }
}
