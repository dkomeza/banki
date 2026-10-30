import type { SettingsPatch, SettingsResponse } from "@banki/shared";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, test } from "vitest";
import { settingsQueryOptions } from "./settings";
import { shownSettings } from "./settings-saver";
import { dropSettingsSaver, settingsSaverFor } from "./settings-store";

/** The Grading and Editor Settings, which these tests leave alone. */
const GRADING = {
  model: "anthropic/claude-haiku-5.5",
  apiKey: { state: "unset" },
  autoClose: "brackets",
  desiredRetention: 90,
  newCardBatch: 20,
  learningLimit: 10,
} as const;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const KEY = settingsQueryOptions().queryKey;
const START: SettingsResponse = { timezone: "Europe/Warsaw", dayStartHour: 4, ...GRADING };

/** A signed-in app's query cache holding the Settings, and a save the test answers. */
function setUp() {
  const queryClient = new QueryClient();
  queryClient.setQueryData(KEY, { settings: START, issuedAt: 0 });
  const requests: { patch: SettingsPatch; succeed: () => void; fail: () => void }[] = [];
  const save = (patch: SettingsPatch) =>
    new Promise<SettingsResponse>((resolve, reject) => {
      requests.push({
        patch,
        succeed: () => resolve({ ...START, ...patch }),
        fail: () => reject(new Error("500")),
      });
    });
  return { queryClient, requests, saver: () => settingsSaverFor(queryClient, { save }) };
}

describe("the app's settings saver", () => {
  test("is one per query client, whoever asks", () => {
    const { saver } = setUp();

    expect(saver()).toBe(saver());
  });

  test("a save that fails after the page was left shows its failure when it comes back", async () => {
    const { saver, requests } = setUp();
    const leave = saver().subscribe(() => {});
    saver().change({ field: "dayStartHour", attempted: 6 });
    leave();

    requests[0]?.fail();
    await flush();

    const back = saver();
    back.subscribe(() => {});
    expect(back.getState().failures).toEqual([{ field: "dayStartHour", attempted: 6 }]);
    expect(shownSettings(back.getState()).dayStartHour).toBe(4);
    back.retry("dayStartHour");
    expect(requests[1]?.patch).toEqual({ dayStartHour: 6 });
  });

  test("a save that succeeds after the page was left shows, and is in the cache", async () => {
    const { saver, requests, queryClient } = setUp();
    const leave = saver().subscribe(() => {});
    saver().change({ field: "dayStartHour", attempted: 6 });
    leave();

    requests[0]?.succeed();
    await flush();

    expect(shownSettings(saver().getState()).dayStartHour).toBe(6);
    expect(queryClient.getQueryData(KEY)?.settings.dayStartHour).toBe(6);
  });

  test("takes reads that reach the cache with no page open, such as the first fill", () => {
    const { saver, queryClient } = setUp();
    const store = saver();

    queryClient.setQueryData(KEY, {
      settings: { timezone: "Asia/Tokyo", dayStartHour: 4, ...GRADING },
      issuedAt: performance.now(),
    });

    expect(store.getState().stored.timezone).toBe("Asia/Tokyo");
  });

  test("signing out drops it: the next one starts clean, and a late answer writes nothing", async () => {
    const { saver, requests, queryClient } = setUp();
    const before = saver();
    before.change({ field: "dayStartHour", attempted: 6 });

    dropSettingsSaver(queryClient);
    queryClient.removeQueries({ queryKey: KEY });
    requests[0]?.succeed();
    await flush();

    expect(queryClient.getQueryData(KEY)).toBeUndefined();
    queryClient.setQueryData(KEY, { settings: START, issuedAt: performance.now() });
    const after = saver();
    expect(after).not.toBe(before);
    expect(after.getState()).toMatchObject({ queue: [], failures: [], stored: START });
  });
});
