import type { SettingsPatch, SettingsResponse } from "@banki/shared";
import { describe, expect, test } from "vitest";
import { type SaverState, createSettingsSaver, shownSettings } from "./settings-saver";

/** The Grading Settings, which these tests leave alone. */
const GRADING = { model: "anthropic/claude-haiku-5.5", apiKey: { state: "unset" } } as const;

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

const START: SettingsResponse = { timezone: "Europe/Warsaw", dayStartHour: 4, ...GRADING };

/** A read of the Settings, issued at `issuedAt` on the test's clock. */
const read = (settings: SettingsResponse, issuedAt: number) => ({ settings, issuedAt });

function setUp() {
  const server = fakeServer(START);
  const kept: SettingsResponse[] = [];
  let time = 0;
  const saver = createSettingsSaver({
    initial: read(START, 0),
    save: server.save,
    onStored: ({ settings }) => kept.push(settings),
    afterSaved: () => () => {},
    now: () => time,
  });
  const state = (): SaverState => saver.getState();
  /** Moves the test's clock on. */
  const at = (next: number) => {
    time = next;
  };
  return { server, saver, state, kept, at };
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
    expect(state().stored).toEqual({ timezone: "Europe/Warsaw", dayStartHour: 6, ...GRADING });
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
    expect(shownSettings(state())).toEqual({
      timezone: "Europe/London",
      dayStartHour: 6,
      ...GRADING,
    });

    server.requests[0]?.fail();
    await flush();
    server.requests[1]?.succeed();
    await flush();

    expect(state().failures).toEqual([{ field: "timezone", attempted: "Europe/London" }]);
    expect(shownSettings(state())).toEqual({
      timezone: "Europe/Warsaw",
      dayStartHour: 6,
      ...GRADING,
    });
    expect(kept.at(-1)).toEqual({ timezone: "Europe/Warsaw", dayStartHour: 6, ...GRADING });
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
    expect(server.stored()).toEqual({ timezone: "Asia/Tokyo", dayStartHour: 0, ...GRADING });
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

    saver.sync(read({ timezone: "Asia/Tokyo", dayStartHour: 4, ...GRADING }, 1));
    expect(state().stored.timezone).toBe("Asia/Tokyo");

    saver.change({ field: "dayStartHour", attempted: 6 });
    saver.sync(read({ timezone: "Europe/Lisbon", dayStartHour: 4, ...GRADING }, 2));
    expect(state().stored.timezone).toBe("Asia/Tokyo");
    server.requests[0]?.succeed();
    await flush();
  });

  test("Settings that arrive mid-save show once the queue drains, if the save fails", async () => {
    const { server, saver, state } = setUp();

    saver.change({ field: "dayStartHour", attempted: 6 });
    // The first fill, say, stores a Timezone meanwhile.
    saver.sync(read({ timezone: "Asia/Tokyo", dayStartHour: 4, ...GRADING }, 1));
    server.requests[0]?.fail();
    await flush();

    expect(shownSettings(state())).toEqual({ timezone: "Asia/Tokyo", dayStartHour: 4, ...GRADING });
    expect(state().failures).toEqual([{ field: "dayStartHour", attempted: 6 }]);
  });

  test("a save answered after Settings arrived mid-save is the truth", async () => {
    const { server, saver, state } = setUp();

    saver.change({ field: "dayStartHour", attempted: 6 });
    saver.sync(read({ timezone: "Asia/Tokyo", dayStartHour: 4, ...GRADING }, 1));
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

    expect(shownSettings(state())).toEqual({
      timezone: "Europe/Warsaw",
      dayStartHour: 6,
      ...GRADING,
    });
  });

  test("a refetch issued before a save, answered after it, doesn't undo the save", async () => {
    const { server, saver, state, at } = setUp();
    // The refetch goes out at 1 and reads the server as it is.
    const refetch = read({ ...server.stored() }, 1);
    at(2);
    saver.change({ field: "dayStartHour", attempted: 6 });
    at(3);
    server.requests[0]?.succeed();
    await flush();

    // Its answer reaches the cache only now.
    at(4);
    saver.sync(refetch);

    expect(shownSettings(state())).toEqual({
      timezone: "Europe/Warsaw",
      dayStartHour: 6,
      ...GRADING,
    });
  });

  test("a first fill issued during a save, answered after it, doesn't undo the save", async () => {
    const { server, saver, state, at } = setUp();
    at(1);
    saver.change({ field: "dayStartHour", attempted: 6 });
    // The fill's PUT goes out at 2 and the server applies it before the PATCH.
    at(2);
    const fill = read({ ...server.stored(), timezone: "Europe/Lisbon" }, 2);
    server.stored().timezone = "Europe/Lisbon";
    at(3);
    server.requests[0]?.succeed();
    await flush();

    at(4);
    saver.sync(fill);

    // The PATCH's answer already carried the fill's Timezone.
    expect(shownSettings(state())).toEqual({
      timezone: "Europe/Lisbon",
      dayStartHour: 6,
      ...GRADING,
    });
  });

  test("a read issued after the last save completed is taken", async () => {
    const { server, saver, state, at } = setUp();
    at(1);
    saver.change({ field: "dayStartHour", attempted: 6 });
    at(2);
    server.requests[0]?.succeed();
    await flush();

    // Another tab changed the Timezone; a refetch at 3 sees it.
    saver.sync(read({ timezone: "Asia/Tokyo", dayStartHour: 6, ...GRADING }, 3));

    expect(shownSettings(state())).toEqual({ timezone: "Asia/Tokyo", dayStartHour: 6, ...GRADING });
  });

  test("of two reads, an older one answered later doesn't replace the newer", () => {
    const { saver, state } = setUp();

    saver.sync(read({ timezone: "Asia/Tokyo", dayStartHour: 4, ...GRADING }, 2));
    saver.sync(read({ timezone: "Europe/Lisbon", dayStartHour: 4, ...GRADING }, 1));

    expect(state().stored.timezone).toBe("Asia/Tokyo");
  });

  test("a read held during a failed save is dropped if it predates the last completed save", async () => {
    const { server, saver, state, at } = setUp();
    at(1);
    saver.change({ field: "dayStartHour", attempted: 5 });
    at(2);
    server.requests[0]?.succeed();
    await flush();
    at(3);
    saver.change({ field: "dayStartHour", attempted: 6 });

    // A read issued at 1, before 5 saved, lands while 6 is saving; 6 fails.
    saver.sync(read({ timezone: "Europe/Warsaw", dayStartHour: 4, ...GRADING }, 1));
    server.requests[1]?.fail();
    await flush();

    expect(shownSettings(state()).dayStartHour).toBe(5);
  });
});

describe("the API key's answers", () => {
  const SET = { state: "set", lastFour: "3f9a" } as const;
  const withKey = (settings: SettingsResponse) => ({ ...settings, apiKey: SET });

  test("show even when a Model save issued after the key's request answered first", async () => {
    const { server, saver, state, kept, at } = setUp();
    // The key's request goes out at 1; the Model save at 2 answers at 3,
    // from before the key was stored.
    at(2);
    saver.change({ field: "model", attempted: "openai/gpt-6-luna" });
    at(3);
    server.requests[0]?.succeed();
    await flush();
    at(4);

    saver.storeApiKey(read(withKey(server.stored()), 1));

    expect(state().stored.apiKey).toEqual(SET);
    expect(state().stored.model).toBe("openai/gpt-6-luna");
    expect(kept.at(-1)?.apiKey).toEqual(SET);
  });

  test("aren't undone by a Model save issued before them that answers after", async () => {
    const { server, saver, state, kept, at } = setUp();
    at(1);
    saver.change({ field: "model", attempted: "openai/gpt-6-luna" });
    at(2);
    saver.storeApiKey(read(withKey(START), 1.5));
    expect(state().stored.apiKey).toEqual(SET);

    // The server answered the Model save with the Settings from before the key.
    at(3);
    server.requests[0]?.succeed();
    await flush();

    expect(state().stored.apiKey).toEqual(SET);
    expect(state().stored.model).toBe("openai/gpt-6-luna");
    expect(kept.at(-1)?.apiKey).toEqual(SET);
  });

  test("aren't undone by a read issued before they arrived", () => {
    const { saver, state, at } = setUp();
    at(2);
    saver.storeApiKey(read(withKey(START), 1));

    saver.sync(read(START, 1.5));

    expect(state().stored.apiKey).toEqual(SET);
  });

  test("give way to a read issued after they arrived", () => {
    const { saver, state, at } = setUp();
    at(2);
    saver.storeApiKey(read(withKey(START), 1));

    saver.sync(read({ ...START, apiKey: { state: "unset" } }, 5));

    expect(state().stored.apiKey).toEqual({ state: "unset" });
  });

  test("give way to a later answer about the key", () => {
    const { saver, state, at } = setUp();
    at(3);
    saver.storeApiKey(read({ ...START, apiKey: { state: "unset" } }, 2));

    saver.storeApiKey(read(withKey(START), 1));

    expect(state().stored.apiKey).toEqual({ state: "unset" });
  });
});
