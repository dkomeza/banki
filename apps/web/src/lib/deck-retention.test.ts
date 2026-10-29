import { describe, expect, test } from "vitest";
import { createDeckRetentionSaver, shownRetention } from "./deck-retention";

/** A fake API that answers each save only when the test says, and stores what it applies. */
function fakeServer() {
  let stored: number | null = null;
  const requests: { value: number | null; succeed: () => void; fail: () => void }[] = [];
  const save = (value: number | null) =>
    new Promise<void>((resolve, reject) => {
      requests.push({
        value,
        succeed: () => {
          stored = value;
          resolve();
        },
        fail: () => reject(new Error("500")),
      });
    });
  return { save, requests, stored: () => stored };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setUp() {
  const server = fakeServer();
  const saver = createDeckRetentionSaver({ save: server.save, afterSaved: () => () => {} });
  return { server, saver };
}

describe("createDeckRetentionSaver", () => {
  test("shows a change at once, saving, then saved", async () => {
    const { server, saver } = setUp();

    saver.change(85);

    expect(shownRetention(saver.getState(), null)).toBe(85);
    expect(saver.getState().queue).toEqual([85]);
    server.requests[0]?.succeed();
    await flush();
    expect(saver.getState()).toEqual({ queue: [], saved: true, failed: undefined });
    expect(server.stored()).toBe(85);
  });

  test("sends changes one at a time, in order, so the last one is stored", async () => {
    const { server, saver } = setUp();

    saver.change(85);
    saver.change(null);
    saver.change(80);
    expect(server.requests).toHaveLength(1);
    expect(shownRetention(saver.getState(), null)).toBe(80);

    for (let i = 0; i < 3; i++) {
      server.requests[i]?.succeed();
      await flush();
    }

    expect(server.requests.map((request) => request.value)).toEqual([85, null, 80]);
    expect(server.stored()).toBe(80);
    expect(saver.getState().saved).toBe(true);
  });

  test("reports a change that didn't save, shows the stored value, and Try again sends it again", async () => {
    const { server, saver } = setUp();

    saver.change(null);
    server.requests[0]?.fail();
    await flush();

    expect(saver.getState()).toEqual({ queue: [], saved: false, failed: { attempted: null } });
    expect(shownRetention(saver.getState(), 85)).toBe(85);

    saver.retry();
    expect(saver.getState().failed).toBeUndefined();
    server.requests[1]?.succeed();
    await flush();

    expect(server.requests.map((request) => request.value)).toEqual([null, null]);
    expect(saver.getState().saved).toBe(true);
  });

  test("a failure a newer change replaces is moot", async () => {
    const { server, saver } = setUp();

    saver.change(85);
    saver.change(75);
    server.requests[0]?.fail();
    await flush();
    server.requests[1]?.succeed();
    await flush();

    expect(saver.getState().failed).toBeUndefined();
    expect(server.stored()).toBe(75);
  });
});
