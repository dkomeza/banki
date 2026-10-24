// The Runner's tick (ADR-0012, ADR-0013), run from the clone of `main` every
// 5 minutes by the loop baked into the image, right after it has brought the
// clone onto `main`: a change here applies on the next tick. The Dispatcher
// (BAN-95) lives here; until then the tick only logs.

const main = process.env.BANKI_RUNNER_MAIN ?? "";

console.log(
  `Tick on main ${main === "" ? "(not fetched)" : main.slice(0, 7)}: no Dispatcher yet, so no Stage starts`,
);
