import { InitialTimezoneRequest } from "@banki/shared";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, test, vi } from "vitest";
import { createApiClient } from "./api";
import { fillFirstTimezone, saveSettings, settingsQueryOptions } from "./settings";

type Call = { method: string; path: string; body: unknown };

/** A fake API holding Settings, answering GET, PATCH and the first fill as the real one does. */
function fakeApi(stored: { timezone: string | null; dayStartHour: number }, { failWith = 0 } = {}) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const request = new Request(new URL(url, "http://banki.test"), init);
    const body: unknown = request.method === "GET" ? undefined : await request.json();
    const path = new URL(request.url).pathname;
    calls.push({ method: request.method, path, body });
    if (failWith !== 0) return new Response(null, { status: failWith });
    if (request.method === "PATCH") Object.assign(stored, body);
    if (request.method === "PUT" && stored.timezone === null) {
      stored.timezone = InitialTimezoneRequest.parse(body).timezone;
    }
    return Response.json(stored);
  });
  return { client: createApiClient(fetch), calls };
}

describe("fillFirstTimezone", () => {
  test("sends this browser's zone when no Timezone is stored, and keeps the answer", async () => {
    const { client, calls } = fakeApi({ timezone: null, dayStartHour: 4 });
    const queryClient = new QueryClient();

    await fillFirstTimezone(queryClient, { client, deviceTimezone: () => "Europe/Lisbon" });

    expect(calls.map(({ method, path, body }) => [method, path, body])).toEqual([
      ["GET", "/api/settings", undefined],
      ["PUT", "/api/settings/timezone/initial", { timezone: "Europe/Lisbon" }],
    ]);
    expect(queryClient.getQueryData(settingsQueryOptions(client).queryKey)).toEqual({
      settings: { timezone: "Europe/Lisbon", dayStartHour: 4 },
      issuedAt: expect.any(Number),
    });
  });

  test("sends nothing once a Timezone is stored", async () => {
    const { client, calls } = fakeApi({ timezone: "Europe/Warsaw", dayStartHour: 4 });

    await fillFirstTimezone(new QueryClient(), { client, deviceTimezone: () => "Europe/Lisbon" });

    expect(calls.map(({ method }) => method)).toEqual(["GET"]);
  });

  test("gives up quietly when the API can't be reached", async () => {
    const { client } = fakeApi({ timezone: null, dayStartHour: 4 }, { failWith: 500 });

    await expect(
      fillFirstTimezone(new QueryClient(), { client, deviceTimezone: () => "Europe/Lisbon" }),
    ).resolves.toBeUndefined();
  });
});

describe("settingsQueryOptions", () => {
  test("stamps a read with when its request was issued, not when it answered", async () => {
    const answers: Array<() => void> = [];
    const client = createApiClient(
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            answers.push(() => resolve(Response.json({ timezone: null, dayStartHour: 4 })));
          }),
      ),
    );
    const before = performance.now();
    const read = new QueryClient().fetchQuery(settingsQueryOptions(client));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const answeredAfter = performance.now();
    for (const answer of answers) answer();

    const { issuedAt } = await read;
    expect(issuedAt).toBeGreaterThanOrEqual(before);
    expect(issuedAt).toBeLessThan(answeredAfter);
  });
});

describe("saveSettings", () => {
  test("sends the change and answers the new Settings", async () => {
    const { client, calls } = fakeApi({ timezone: "Europe/Warsaw", dayStartHour: 4 });

    await expect(saveSettings({ dayStartHour: 6 }, client)).resolves.toEqual({
      timezone: "Europe/Warsaw",
      dayStartHour: 6,
    });
    expect(calls).toEqual([{ method: "PATCH", path: "/api/settings", body: { dayStartHour: 6 } }]);
  });

  test("throws when the API refuses it", async () => {
    const { client } = fakeApi({ timezone: "Europe/Warsaw", dayStartHour: 4 }, { failWith: 500 });

    await expect(saveSettings({ dayStartHour: 6 }, client)).rejects.toThrow();
  });
});
