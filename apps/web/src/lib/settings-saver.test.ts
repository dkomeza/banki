import type { SettingsPatch, SettingsResponse } from "@banki/shared";
import { describe, expect, test } from "vitest";
import { type SaverState, createSettingsSaver, shownSettings } from "./settings-saver";

/** A fake API that answers each PATCH only when the test says, and stores what it applies. */
function fakeServer(initial: SettingsResponse) {
  let stored = { ...initial };
  const requests: { patch: SettingsPatch; succeed: () => void; fail: () => void }[] = [];
  const save = (patch: SettingsPatch) =>
    new Promise<SettingsResponse>((resolve, reject) => {
      requests.push({
        patch,
        succeed: () => {
          stored = { ...stored, ...patch };
          resolve(stored);
        },
        fail: () => reject(new Error("500")),
      });
    });
  return { save, requests, stored: () => stored };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const START: SettingsResponse = { timezone: "Europe/Warsaw", dayStartHour: 4 };

function setUp() {
  const server = fakeServer(START);
  const kept: SettingsResponse[] = [];
  const saver = createSettingsSaver({
    initial: START,
    save: server.save,
    onStored: (settings) => kept.push(settings),
    afterSaved: () => () => {},
  });
  const state = (): SaverState => saver.getState();
  return { server, saver, state, kept };
}

describe("createSettingsSaver", () => {
  test("shows a change at once, saving, then saved", async () => {
    const { server, saver, state } = setUp();

    saver.change({ field: "dayStartHour", attempted: 6 });

    expect(shownSettings(state()).dayStartHour).toBe(6);
    expect(state().saving).toEqual(["dayStartHour"]);
    server.requests[0]?.succeed();
    await flush();
    expect(state().saving).toEqual([]);
    expect(state().saved).toEqual(["dayStartHour"]);
    expect(state().stored).toEqual({ timezone: "Europe/Warsaw", dayStartHour: 6 });
  });

  test("sends one change at a time, in order", async () => {
    const { server, saver } = setUp();

    saver.change({ field: "dayStartHour", attempted: 5 });
    saver.change({ field: "dayStartHour", attempted: 6 });

    expect(server.requests.map((request) => request.patch)).toEqual([{ dayStartHour: 5 }]);
    server.requests[0]?.succeed();
    await flush();
    expect(server.requests.map((request) => request.patch)).toEqual([
      { dayStartHour: 5 },
      { dayStartHour: 6 },
    ]);
    server.requests[1]?.succeed();
    await flush();
    expect(server.stored().dayStartHour).toBe(6);
  });

  test("a failed change is reported even when a later one saves, and the stored state shows", async () => {
    const { server, saver, state, kept } = setUp();

    saver.change({ field: "timezone", attempted: "Europe/London" });
    saver.change({ field: "dayStartHour", attempted: 6 });
    expect(shownSettings(state())).toEqual({ timezone: "Europe/London", dayStartHour: 6 });

    server.requests[0]?.fail();
    await flush();
    server.requests[1]?.succeed();
    await flush();

    expect(state().failures).toEqual([{ field: "timezone", attempted: "Europe/London" }]);
    expect(shownSettings(state())).toEqual({ timezone: "Europe/Warsaw", dayStartHour: 6 });
    expect(kept.at(-1)).toEqual({ timezone: "Europe/Warsaw", dayStartHour: 6 });
  });

  test("ends showing what the server stored, whatever order the answers would have come in", async () => {
    const { server, saver, state } = setUp();

    saver.change({ field: "timezone", attempted: "Asia/Tokyo" });
    saver.change({ field: "dayStartHour", attempted: 0 });
    server.requests[0]?.succeed();
    await flush();
    server.requests[1]?.succeed();
    await flush();

    expect(shownSettings(state())).toEqual(server.stored());
    expect(server.stored()).toEqual({ timezone: "Asia/Tokyo", dayStartHour: 0 });
  });

  test("a later save of the same Setting clears its failure", async () => {
    const { server, saver, state } = setUp();
    saver.change({ field: "dayStartHour", attempted: 6 });
    server.requests[0]?.fail();
    await flush();
    expect(state().failures).toHaveLength(1);

    saver.change({ field: "dayStartHour", attempted: 7 });
    server.requests[1]?.succeed();
    await flush();

    expect(state().failures).toEqual([]);
  });

  test("Try again sends the failed change again", async () => {
    const { server, saver, state } = setUp();
    saver.change({ field: "dayStartHour", attempted: 6 });
    server.requests[0]?.fail();
    await flush();

    saver.retry("dayStartHour");

    expect(state().failures).toEqual([]);
    expect(server.requests[1]?.patch).toEqual({ dayStartHour: 6 });
  });

  test("takes Settings changed elsewhere only while nothing is being saved", async () => {
    const { server, saver, state } = setUp();

    saver.sync({ timezone: "Asia/Tokyo", dayStartHour: 4 });
    expect(state().stored.timezone).toBe("Asia/Tokyo");

    saver.change({ field: "dayStartHour", attempted: 6 });
    saver.sync({ timezone: "Europe/Lisbon", dayStartHour: 4 });
    expect(state().stored.timezone).toBe("Asia/Tokyo");
    server.requests[0]?.succeed();
    await flush();
  });

  test("Settings that arrive mid-save show once the queue drains, if the save fails", async () => {
    const { server, saver, state } = setUp();

    saver.change({ field: "dayStartHour", attempted: 6 });
    // The first fill, say, stores a Timezone meanwhile.
    saver.sync({ timezone: "Asia/Tokyo", dayStartHour: 4 });
    server.requests[0]?.fail();
    await flush();

    expect(shownSettings(state())).toEqual({ timezone: "Asia/Tokyo", dayStartHour: 4 });
    expect(state().failures).toEqual([{ field: "dayStartHour", attempted: 6 }]);
  });

  test("a save answered after Settings arrived mid-save is the truth", async () => {
    const { server, saver, state } = setUp();

    saver.change({ field: "dayStartHour", attempted: 6 });
    saver.sync({ timezone: "Asia/Tokyo", dayStartHour: 4 });
    server.requests[0]?.succeed();
    await flush();

    expect(shownSettings(state())).toEqual(server.stored());
  });

  test("a new change to a field drops its old failure, so Try again can't undo it", async () => {
    const { server, saver, state } = setUp();
    saver.change({ field: "dayStartHour", attempted: 6 });
    server.requests[0]?.fail();
    await flush();

    saver.change({ field: "dayStartHour", attempted: 7 });

    expect(state().failures).toEqual([]);
    saver.retry("dayStartHour");
    expect(state().queue).toEqual([{ field: "dayStartHour", attempted: 7 }]);
    server.requests[1]?.succeed();
    await flush();
    expect(server.requests).toHaveLength(2);
    expect(server.stored().dayStartHour).toBe(7);
  });

  test("a failure already replaced in the queue isn't shown, so it can't be tried again", async () => {
    const { server, saver, state } = setUp();
    saver.change({ field: "dayStartHour", attempted: 5 });
    saver.change({ field: "dayStartHour", attempted: 6 });

    server.requests[0]?.fail();
    await flush();

    expect(state().failures).toEqual([]);
    saver.retry("dayStartHour");
    expect(state().queue).toEqual([{ field: "dayStartHour", attempted: 6 }]);
    server.requests[1]?.succeed();
    await flush();
    expect(server.requests).toHaveLength(2);
    expect(server.stored().dayStartHour).toBe(6);
    expect(shownSettings(state()).dayStartHour).toBe(6);
  });

  test("when the newer change fails after the older one saved, the newer failure shows over the saved value", async () => {
    const { server, saver, state } = setUp();
    saver.change({ field: "dayStartHour", attempted: 5 });
    saver.change({ field: "dayStartHour", attempted: 6 });

    server.requests[0]?.succeed();
    await flush();
    server.requests[1]?.fail();
    await flush();

    expect(state().failures).toEqual([{ field: "dayStartHour", attempted: 6 }]);
    expect(shownSettings(state()).dayStartHour).toBe(5);
    expect(server.stored().dayStartHour).toBe(5);
  });

  test("a failure on one field leaves a queued change to the other alone", async () => {
    const { server, saver, state } = setUp();
    saver.change({ field: "timezone", attempted: "Asia/Tokyo" });
    saver.change({ field: "dayStartHour", attempted: 6 });

    server.requests[0]?.fail();
    await flush();
    expect(state().failures).toEqual([{ field: "timezone", attempted: "Asia/Tokyo" }]);
    server.requests[1]?.succeed();
    await flush();

    expect(shownSettings(state())).toEqual({ timezone: "Europe/Warsaw", dayStartHour: 6 });
  });
});
