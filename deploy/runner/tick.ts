import { tickLogger } from "./dispatch/tick-log";
import { errorText } from "./lib/config";

// The Runner's tick (ADR-0012, ADR-0013), run from the clone of `main` every
// 5 minutes by the loop baked into the image, right after it has brought the
// clone onto `main`: a change here applies on the next tick. It runs the
// Dispatcher (dispatch/dispatcher.ts), whose Stages run under supervisors of
// their own, detached, so they outlive the tick's 10 minutes. Each line it
// prints goes to the tick log too, for the Dashboard.

const main = process.env.BANKI_RUNNER_MAIN ?? "";
const log = tickLogger({ main });
const fail = tickLogger({ main, print: (line) => console.error(line) });
log(`Tick on main ${main === "" ? "(not fetched)" : main.slice(0, 7)}`);

try {
  const [{ tick }, { dispatcherDeps }] = await Promise.all([
    import("./dispatch/dispatcher"),
    import("./dispatch/wiring"),
  ]);
  await tick(dispatcherDeps({ log }));
} catch (error) {
  fail(`The Dispatcher failed: ${errorText(error)}`);
  process.exit(1);
}
