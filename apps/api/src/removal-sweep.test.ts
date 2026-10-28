import { expect, test } from "bun:test";
import { startRemovalSweep } from "./removal-sweep";

test("sweeps at once, then every interval, until it is stopped, outlasting a run that throws", async () => {
  let runs = 0;
  let imageSweeps = 0;
  const stop = startRemovalSweep(
    {
      removeExpired: () => {
        runs += 1;
        if (runs === 2) throw new Error("database is locked");
        return 1;
      },
      sweepImages: () => {
        imageSweeps += 1;
        if (imageSweeps === 3) throw new Error("EACCES");
        return { images: 1, files: 0 };
      },
    },
    20,
  );
  expect(runs).toBe(1);
  expect(imageSweeps).toBe(1);

  await Bun.sleep(70);
  stop();
  const stoppedAt = runs;
  expect(stoppedAt).toBeGreaterThanOrEqual(3);
  // A Removal that throws doesn't stop the images' sweep after it.
  expect(imageSweeps).toBe(stoppedAt);

  await Bun.sleep(50);
  expect(runs).toBe(stoppedAt);
  expect(imageSweeps).toBe(stoppedAt);
});
