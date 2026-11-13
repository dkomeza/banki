// @vitest-environment happy-dom
import type { SettingsResponse } from "@banki/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createBrowserHistory, createRouter } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cardsQueryOptions } from "@/lib/cards";
import { type Deck, deckQueryOptions, decksQueryOptions } from "@/lib/decks";
import { foldersQueryOptions } from "@/lib/folders";
import { meQueryOptions } from "@/lib/me";
import { settingsQueryOptions } from "@/lib/settings";
import { setupStatusQueryOptions, signedInQueryOptions } from "@/lib/signed-in";
import type { SignedIn } from "@/lib/signed-in-key";
import {
  type Statistics,
  deckStatisticsQueryOptions,
  statisticsQueryOptions,
} from "@/lib/statistics";
import { routeTree } from "@/routeTree.gen";

// The Statistics pages in the real route tree, signed in, their data already
// in the cache: nothing reaches an API.

const SETTINGS: SettingsResponse = {
  timezone: "Europe/Warsaw",
  dayStartHour: 4,
  model: "anthropic/claude-haiku-5.5",
  apiKey: { state: "unset" },
  autoClose: "brackets",
  desiredRetention: 90,
  newCardBatch: 20,
  learningLimit: 10,
  sessionTimeoutMinutes: 30,
  macros: [],
  answerMode: "self-rate",
};

const DECK: Deck = {
  id: "d1",
  name: "World capitals",
  description: null,
  folderId: null,
  createdAt: "2026-05-01T09:00:00.000Z",
  cardCount: 0,
  desiredRetention: null,
  macros: [],
  answerMode: null,
  plan: null,
};

const STATS: Statistics = {
  range: "30",
  from: "2026-10-15",
  to: "2026-11-13",
  calendar: [
    { day: "2026-11-02", reviews: 12, ms: 4 * 60_000 },
    { day: "2026-11-12", reviews: 30, ms: 9 * 60_000 },
  ],
  minutes: {
    bucket: "day",
    points: [
      { start: "2026-11-12", ms: 9 * 60_000 },
      { start: "2026-11-13", ms: 0 },
    ],
  },
  actualRetention: { recalled: 9, total: 10, desiredRetention: 88.5 },
  cards: { new: 4, learning: 2, learned: 24 },
  graderAgreement: {
    kept: 7,
    higher: 2,
    lower: 1,
    models: [
      { model: "anthropic/claude-haiku-5.5", kept: 6, higher: 0, lower: 1 },
      { model: "gone/model-1", kept: 1, higher: 2, lower: 0 },
    ],
  },
};

const EMPTY: Statistics = {
  ...STATS,
  calendar: [],
  minutes: { bucket: "day", points: [{ start: "2026-11-13", ms: 0 }] },
  actualRetention: { recalled: 0, total: 0, desiredRetention: 90 },
  graderAgreement: { kept: 0, higher: 0, lower: 0, models: [] },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

async function open(
  path: string,
  statsOf: (range: string) => Statistics = () => STATS,
  heading = "Statistics",
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({}, { status: 500 })),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(setupStatusQueryOptions.queryKey, { setUp: true });
  const signedIn: SignedIn = { email: "u@x.y" };
  queryClient.setQueryData(signedInQueryOptions.queryKey, signedIn);
  queryClient.setQueryData(meQueryOptions.queryKey, { email: "u@x.y" });
  queryClient.setQueryData(settingsQueryOptions().queryKey, { settings: SETTINGS, issuedAt: 0 });
  queryClient.setQueryData(foldersQueryOptions().queryKey, []);
  queryClient.setQueryData(decksQueryOptions().queryKey, [DECK]);
  queryClient.setQueryData(deckQueryOptions(DECK.id).queryKey, DECK);
  queryClient.setQueryData(deckQueryOptions("gone").queryKey, null);
  queryClient.setQueryData(cardsQueryOptions(DECK.id).queryKey, []);
  for (const range of ["7", "30", "90", "all"] as const)
    queryClient.setQueryData(deckStatisticsQueryOptions("gone", range).queryKey, null);
  for (const range of ["7", "30", "90", "all"] as const) {
    const stats = { ...statsOf(range), range };
    queryClient.setQueryData(statisticsQueryOptions(range).queryKey, stats);
    queryClient.setQueryData(deckStatisticsQueryOptions(DECK.id, range).queryKey, stats);
  }
  window.history.replaceState(null, "", path);
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createBrowserHistory(),
  });
  await router.load();
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: heading, level: 1 });
  return router;
}

const pressed = () =>
  within(screen.getByRole("group", { name: "Range" }))
    .getAllByRole("button")
    .filter((b) => b.getAttribute("aria-pressed") === "true")
    .map((b) => b.textContent);

describe("the global page", () => {
  test("is in the nav, between Home and Settings, and current there", async () => {
    await open("/statistics");
    const navs = screen.getAllByRole("navigation");
    expect(navs.length).toBeGreaterThan(0);
    for (const nav of navs) {
      const links = within(nav).getAllByRole("link");
      const names = links.map((l) => l.textContent?.trim());
      const at = names.indexOf("Statistics");
      expect(at).toBeGreaterThan(names.indexOf("Home"));
      expect(at).toBeLessThan(names.indexOf("Settings"));
      expect(links[at]?.getAttribute("aria-current")).toBe("page");
    }
  });

  test("stays current in the nav with a range in the URL", async () => {
    await open("/statistics?range=7");
    for (const nav of screen.getAllByRole("navigation")) {
      expect(
        within(nav).getByRole("link", { name: "Statistics" }).getAttribute("aria-current"),
      ).toBe("page");
    }
  });

  test("shows 30 days by default, and an unknown range as 30 days", async () => {
    await open("/statistics?range=365");
    expect(pressed()).toEqual(["30 days"]);
  });

  test("the range picker sets ?range=, and the range survives Back", async () => {
    const router = await open("/statistics", (range) => ({
      ...STATS,
      cards: { ...STATS.cards, new: range === "7" ? 7 : 4 },
    }));
    fireEvent.click(screen.getByRole("button", { name: "7 days" }));
    await screen.findByText("Every review you've made, in every deck.");
    await vi.waitFor(() => expect(window.location.search).toBe("?range=7"));
    expect(pressed()).toEqual(["7 days"]);

    fireEvent.click(screen.getByRole("button", { name: "30 days" }));
    await vi.waitFor(() => expect(window.location.search).toBe(""));
    fireEvent.click(screen.getByRole("button", { name: "All time" }));
    await vi.waitFor(() => expect(window.location.search).toBe("?range=all"));

    await act(() => router.navigate({ to: "/settings" }));
    await act(async () => {
      router.history.back();
      await vi.waitFor(() => expect(window.location.pathname).toBe("/statistics"));
    });
    await vi.waitFor(() => expect(pressed()).toEqual(["All time"]));
    expect(window.location.search).toBe("?range=all");
  });

  test("each chart's values read as text and as accessible names", async () => {
    await open("/statistics");
    // The activity calendar: the year, and each day.
    expect(
      screen.getByText(/The last 53 weeks, whatever the range: 42 reviews on 2 days\./),
    ).toBeTruthy();
    expect(
      screen.getAllByRole("img", { name: "Thu, 12 Nov 2026: 30 reviews, 9 min" }).length,
    ).toBeGreaterThan(0);
    // Minutes per day.
    expect(screen.getByText("9 min")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Thu, 12 Nov 2026: 9 min" })).toBeTruthy();
    // Actual retention, beside Desired retention.
    expect(screen.getByText("90.0%")).toBeTruthy();
    expect(
      screen.getByText(/of 10 reviews of learned cards recalled, over the last 30 days/),
    ).toBeTruthy();
    expect(
      screen.getByRole("img", { name: "Actual retention 90.0%, Desired retention 88.5%" }),
    ).toBeTruthy();
    // Cards by stage.
    expect(screen.getByRole("img", { name: "4 new, 2 learning, 24 learned" })).toBeTruthy();
    expect(screen.getByText("Now, whatever the range: 30 cards.")).toBeTruthy();
    // Grader agreement, overall and per Model, by name or ID.
    expect(screen.getByText("70% kept")).toBeTruthy();
    expect(screen.getByText("of 10 reviews graded · 2 rated higher · 1 rated lower")).toBeTruthy();
    expect(screen.getByRole("img", { name: "7 kept, 2 rated higher, 1 rated lower" })).toBeTruthy();
    expect(screen.getByText("Claude Haiku 5.5")).toBeTruthy();
    expect(screen.getByText("gone/model-1")).toBeTruthy();
  });

  test("a calendar day's tooltip gives the date, the Reviews and the minutes", async () => {
    await open("/statistics");
    const [day] = screen.getAllByRole("img", { name: "Mon, 2 Nov 2026: 12 reviews, 4 min" });
    if (day === undefined) throw new Error("No such day");
    fireEvent.pointerEnter(day);
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.textContent).toBe("Mon, 2 Nov 202612 reviews · 4 min");
  });

  test("the calendar covers 53 weeks from a Monday, in 5 levels", async () => {
    const calendar8 = [1, 2, 3, 4, 5, 6, 7, 8].map((reviews) => ({
      day: `2026-11-0${reviews}`,
      reviews,
      ms: 60_000,
    }));
    await open("/statistics", () => ({ ...STATS, calendar: calendar8 }));
    const [calendar] = screen.getAllByRole("group", { name: /^Activity over the last 53 weeks/ });
    if (calendar === undefined) throw new Error("No calendar");
    const days = calendar.querySelectorAll("rect");
    // 52 full weeks, and Monday to Friday of this one.
    expect(days).toHaveLength(52 * 7 + 5);
    expect(days[0]?.getAttribute("aria-label")).toMatch(/^Mon, 10 Nov 2025:/);
    const levels = new Set([...days].map((d) => d.getAttribute("data-level")));
    expect([...levels].toSorted((a, b) => Number(a) - Number(b))).toEqual([
      "0",
      "1",
      "2",
      "3",
      "4",
    ]);
    const levelOf = (day: string) =>
      [...days]
        .find((d) => d.getAttribute("aria-label")?.startsWith(day))
        ?.getAttribute("data-level");
    expect(levelOf("Sun, 1 Nov 2026")).toBe("1");
    expect(levelOf("Sun, 8 Nov 2026")).toBe("4");
    expect(levelOf("Mon, 9 Nov 2026")).toBe("0");
  });

  test("each chart's empty state shows", async () => {
    await open("/statistics", () => EMPTY);
    expect(screen.getAllByText("No reviews in the last 53 weeks").length).toBeGreaterThan(0);
    expect(screen.getByText("No study time in this range")).toBeTruthy();
    expect(screen.getByText("No reviews of learned cards in this range")).toBeTruthy();
    expect(screen.getByText("No graded reviews in this range")).toBeTruthy();
    // Cards by stage always shows.
    expect(screen.getByRole("heading", { name: "Cards by stage" })).toBeTruthy();
  });

  test("has no streaks, badges or goals", async () => {
    await open("/statistics");
    expect(document.body.textContent).not.toMatch(/streak|badge|goal/i);
  });
});

describe("a Deck's page", () => {
  test("is opened by a Statistics pill in the deck page's action row, after Settings", async () => {
    await open(`/decks/${DECK.id}`, () => STATS, DECK.name);
    // A pill is a link drawn as a button.
    const pill = screen.getByRole("button", { name: "Statistics" });
    expect(pill.getAttribute("href")).toBe(`/decks/${DECK.id}/statistics`);
    const row = pill.parentElement;
    const names = [...(row?.children ?? [])].map((el) => el.textContent?.trim());
    expect(names.indexOf("Statistics")).toBe(names.indexOf("Settings") + 1);
  });

  test("shows the Deck's statistics, with the breadcrumb down to it", async () => {
    await open(`/decks/${DECK.id}/statistics?range=90`);
    expect(screen.getByText(/The reviews in/).textContent).toBe("The reviews in World capitals.");
    expect(pressed()).toEqual(["90 days"]);
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumbs).getByRole("link", { name: "World capitals" }).getAttribute("href")).toBe(
      `/decks/${DECK.id}`,
    );
    expect(screen.getByText(/Above this deck's Desired retention/)).toBeTruthy();
  });

  test("a Deck that is gone shows the deck page's not-found", async () => {
    await open("/decks/gone/statistics", () => STATS, "Deck not found");
    expect(screen.queryByRole("group", { name: "Range" })).toBeNull();
  });
});
