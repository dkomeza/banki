import { expect, test } from "bun:test";
import { startRemovalSweep } from "./removal-sweep";

test("sweeps at once, then every interval, until it is stopped, outlasting a run that throws", async () => {
  let runs = 0;
  const stop = startRemovalSweep(() => {
    runs += 1;
    if (runs === 2) throw new Error("database is locked");
    return 1;
  }, 20);
  expect(runs).toBe(1);

  await Bun.sleep(70);
  stop();
  const stoppedAt = runs;
  expect(stoppedAt).toBeGreaterThanOrEqual(3);

  await Bun.sleep(50);
  expect(runs).toBe(stoppedAt);
});
