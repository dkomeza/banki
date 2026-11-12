import type { TuningStatus } from "@banki/shared";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, test, vi } from "vitest";
import { createApiClient } from "./api";
import { resetTuning, tuneNow, tuningQueryOptions, tuningStatusLines } from "./tuning";

const NOW = new Date("2026-10-26T12:00:00.000Z");

const STATUS: TuningStatus = {
  parameters: "default",
  tuned: null,
  lastAttempt: null,
  reviewsUntilAutomatic: 200,
  paused: false,
  running: false,
  recommendedRetention: null,
};

const TUNED: TuningStatus = {
  parameters: "tuned",
  tuned: { at: "2026-10-20T09:00:00.000Z", reviews: 1234 },
  lastAttempt: { at: "2026-10-20T09:00:00.000Z", trigger: "automatic", outcome: "applied" },
  reviewsUntilAutomatic: 57,
  paused: false,
  running: false,
  recommendedRetention: null,
};

describe("tuningStatusLines", () => {
  test("standard scheduling until there's enough history, and when the next check is", () => {
    expect(tuningStatusLines(STATUS, NOW)).toEqual([
      "Standard scheduling until there's enough of your review history to fit it to you.",
      "Next check after 200 more reviews.",
    ]);
    expect(
      tuningStatusLines(
        {
          ...STATUS,
          lastAttempt: {
            at: "2026-10-25T09:00:00.000Z",
            trigger: "manual",
            outcome: "not_enough_data",
          },
          reviewsUntilAutomatic: 1,
        },
        NOW,
      ),
    ).toEqual([
      "Standard scheduling until there's enough of your review history to fit it to you.",
      "Last check, 25 October: not enough review history yet.",
      "Next check after 1 more review.",
    ]);
  });

  test("tuned on a date from so many Reviews, then a later check's outcome", () => {
    expect(tuningStatusLines(TUNED, NOW)).toEqual([
      "Fitted to how you remember on 20 October, from 1,234 reviews.",
      "Next check after 57 more reviews.",
    ]);
    for (const [outcome, line] of [
      ["kept", "no better fit than the current one, so it stayed."],
      ["failed", "it couldn't finish."],
    ] as const) {
      expect(
        tuningStatusLines(
          { ...TUNED, lastAttempt: { at: "2025-12-31T09:00:00.000Z", trigger: "manual", outcome } },
          NOW,
        )[1],
      ).toBe(`Last check, 31 December 2025: ${line}`);
    }
  });

  test("paused after a Reset, with Tune now to resume, and no next check", () => {
    expect(
      tuningStatusLines(
        {
          ...STATUS,
          lastAttempt: { at: "2026-10-25T09:00:00.000Z", trigger: "reset", outcome: "reset" },
          reviewsUntilAutomatic: 0,
          paused: true,
        },
        NOW,
      ),
    ).toEqual([
      "Standard scheduling, reset by you. Banki won't fit it to you again until you press Tune now.",
    ]);
  });

  test("never says FSRS or parameters", () => {
    const lines = [STATUS, TUNED, { ...STATUS, paused: true }].flatMap((status) =>
      tuningStatusLines(status, NOW),
    );
    expect(lines.join(" ")).not.toMatch(/fsrs|parameter/i);
  });
});

/** A client answering every request with `status` and `body`, recording each method and URL. */
const answering = (status: number, body: unknown) => {
  const sent: string[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push(
      `${init?.method ?? "GET"} ${input instanceof Request ? input.url : input.toString()}`,
    );
    return Response.json(body, { status });
  });
  return { client: createApiClient(fetch), sent };
};

/** A query client with the schedule-showing queries in it, recording which it invalidates. */
const withSchedules = () => {
  const queryClient = new QueryClient();
  const invalidated: unknown[] = [];
  vi.spyOn(queryClient, "invalidateQueries").mockImplementation(async (filters) => {
    invalidated.push(filters?.queryKey);
  });
  return { queryClient, invalidated };
};

describe("tuneNow", () => {
  test("keeps the status it answers, and has schedules fetched again when it applied", async () => {
    const { client, sent } = answering(200, { result: "applied", status: TUNED });
    const { queryClient, invalidated } = withSchedules();

    expect(await tuneNow(queryClient, client)).toBe("applied");

    expect(sent).toEqual(["POST /api/tuning"]);
    expect(queryClient.getQueryData(tuningQueryOptions().queryKey)).toEqual(TUNED);
    expect(invalidated).toEqual([["decks"], ["cards"]]);
  });

  test("leaves schedules alone when nothing applied", async () => {
    const { client } = answering(200, { result: "kept", status: STATUS });
    const { queryClient, invalidated } = withSchedules();

    expect(await tuneNow(queryClient, client)).toBe("kept");
    expect(invalidated).toEqual([]);
  });

  test("throws when the request fails", async () => {
    const { client } = answering(500, {});
    await expect(tuneNow(new QueryClient(), client)).rejects.toThrow();
  });
});

describe("resetTuning", () => {
  test("keeps the status it answers, and has schedules fetched again", async () => {
    const paused = { ...STATUS, paused: true };
    const { client, sent } = answering(200, paused);
    const { queryClient, invalidated } = withSchedules();

    expect(await resetTuning(queryClient, client)).toBe(true);

    expect(sent).toEqual(["POST /api/tuning/reset"]);
    expect(queryClient.getQueryData(tuningQueryOptions().queryKey)).toEqual(paused);
    expect(invalidated).toEqual([["decks"], ["cards"]]);
  });

  test("with the defaults in use already, fetches the status again", async () => {
    const { client } = answering(409, {
      error: { code: "defaults_in_use", message: "Scheduling already uses the defaults" },
    });
    const { queryClient, invalidated } = withSchedules();

    expect(await resetTuning(queryClient, client)).toBe(false);
    expect(invalidated).toEqual([["tuning"]]);
  });
});
