// @vitest-environment happy-dom
import type { PlanCheckResponse, SettingsResponse } from "@banki/shared";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { type Deck, deckQueryOptions } from "@/lib/decks";
import { type Plan, planCheckQueryOptions } from "@/lib/plans";
import { settingsQueryOptions } from "@/lib/settings";
import { PlanCard } from "./plan-card";

// Noon on Thursday 12 November 2026 in Warsaw: the Study day 2026-11-12.
const NOW = new Date("2026-11-12T11:00:00Z");

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
  answerMode: "self-rate",
  macros: [],
};

const DECK: Deck = {
  id: "d1",
  name: "Spanish vocabulary",
  description: null,
  folderId: null,
  createdAt: "2026-05-01T09:00:00.000Z",
  cardCount: 300,
  desiredRetention: null,
  macros: [],
  answerMode: null,
  plan: null,
  cardPrompt: { language: "", count: null, difficulty: "intermediate", instructions: "" },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** The checks the API answers: 35 minutes a day covers 300 New cards by 12 Dec. */
function exampleCheck({ dailyMinutes }: Plan): PlanCheckResponse {
  if (dailyMinutes >= 35) return { newCards: 300, unlearned: 0, neededMinutes: 35 };
  return { newCards: 300, unlearned: 140, neededMinutes: 35 };
}

type Sent = { method: string; path: string; body: unknown };

let sent: Sent[] = [];
let checks: Plan[] = [];

/** The API: each check answered by `check`, and a Plan's save or removal done. */
function stubApi(check: (plan: Plan) => PlanCheckResponse = exampleCheck) {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const request = new Request(new URL(url, "http://banki.test"), init);
    const { pathname, searchParams } = new URL(request.url);
    const text = await request.text();
    if (pathname.endsWith("/plan/check")) {
      const plan = {
        deadline: searchParams.get("deadline") ?? "",
        dailyMinutes: Number(searchParams.get("dailyMinutes")),
      };
      checks.push(plan);
      return json(check(plan));
    }
    const body: unknown = text === "" ? undefined : JSON.parse(text);
    sent.push({ method: request.method, path: pathname, body });
    if (request.method === "PUT") return json(body);
    if (request.method === "DELETE") return new Response(null, { status: 204 });
    return json({ error: { code: "not_found", message: "?" } }, 404);
  });
}

beforeEach(() => {
  sent = [];
  checks = [];
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The card on the Deck as cached, as the page reads it. */
function CachedDeck() {
  const deck = useQuery({ ...deckQueryOptions(DECK.id), staleTime: Infinity }).data;
  return deck === undefined || deck === null ? null : <PlanCard deck={deck} />;
}

function renderCard(plan: Plan | null = null, queryClient = new QueryClient()) {
  queryClient.setQueryData(settingsQueryOptions().queryKey, { settings: SETTINGS, issuedAt: 0 });
  const deck: Deck = { ...DECK, plan };
  queryClient.setQueryData(deckQueryOptions(DECK.id).queryKey, deck);
  render(
    <QueryClientProvider client={queryClient}>
      <CachedDeck />
    </QueryClientProvider>,
  );
  return queryClient;
}

const card = () => within(screen.getByRole("region", { name: "Plan" }));
const minutes = () => card().getByRole<HTMLInputElement>("textbox", { name: "Daily goal" });
const deadlineField = () => card().getByRole("button", { name: "Deadline" });

/** The calendar's button named `name`. */
const day = (name: string) => screen.getByRole<HTMLButtonElement>("button", { name });

/** Opens the Deadline's calendar and picks `name`'s day, moving `months` on first. */
function pickDeadline(name: string, months = 1) {
  fireEvent.click(deadlineField());
  for (let i = 0; i < months; i++) {
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
  }
  fireEvent.click(screen.getByRole("button", { name }));
}

describe("PlanCard", () => {
  test("without a Plan, says so and offers Create plan", () => {
    stubApi();
    renderCard();

    expect(card().getByText(/This deck has no Plan/)).toBeTruthy();
    expect(card().getByRole("button", { name: "Create plan" })).toBeTruthy();
    expect(checks).toEqual([]);
  });

  test("Create plan opens the form in place: no Deadline, 30 minutes, and no check", () => {
    stubApi();
    renderCard();

    fireEvent.click(card().getByRole("button", { name: "Create plan" }));

    expect(deadlineField().textContent).toContain("Pick the day");
    expect(minutes().value).toBe("30");
    expect(card().getByText("The exam day. You study on the days before it.")).toBeTruthy();
    expect(card().queryByText(/Checking the plan/)).toBeNull();
  });

  test("checks the Plan live once both fields are valid, and creates it with PUT", async () => {
    stubApi();
    renderCard();
    fireEvent.click(card().getByRole("button", { name: "Create plan" }));
    fireEvent.change(minutes(), { target: { value: "40" } });

    pickDeadline("Saturday 12 December");

    expect(deadlineField().textContent).toContain("Sat 12 Dec 2026");
    expect(card().getByText("In 30 days. You study on the days before it.")).toBeTruthy();
    expect(card().getByText("Checking the plan…")).toBeTruthy();
    await waitFor(() =>
      expect(card().getByText("Covers all 300 new cards by 12 Dec.")).toBeTruthy(),
    );
    expect(checks).toEqual([{ deadline: "2026-12-12", dailyMinutes: 40 }]);
    expect(sent).toEqual([]);

    fireEvent.click(card().getByRole("button", { name: "Create plan" }));

    await waitFor(() => expect(card().getByText("days left")).toBeTruthy());
    expect(sent).toEqual([
      {
        method: "PUT",
        path: "/api/decks/d1/plan",
        body: { deadline: "2026-12-12", dailyMinutes: 40 },
      },
    ]);
    expect(card().getByText("30")).toBeTruthy();
    expect(card().getByText("Saturday 12 December 2026")).toBeTruthy();
    expect(card().getByText("40 min")).toBeTruthy();
  });

  test("checks only once the fields rest", async () => {
    stubApi();
    renderCard({ deadline: "2026-12-12", dailyMinutes: 40 });
    await waitFor(() => expect(checks).toHaveLength(1));
    fireEvent.click(card().getByRole("button", { name: "Edit" }));

    for (const value of ["4", "45", "4", "50"]) {
      fireEvent.change(minutes(), { target: { value } });
    }

    await waitFor(() =>
      expect(checks.at(-1)).toEqual({ deadline: "2026-12-12", dailyMinutes: 50 }),
    );
    expect(checks.map((c) => c.dailyMinutes)).not.toContain(45);
  });

  test("warns when the goal falls short, and Use N min sets it", async () => {
    stubApi();
    renderCard();
    fireEvent.click(card().getByRole("button", { name: "Create plan" }));
    fireEvent.change(minutes(), { target: { value: "20" } });
    pickDeadline("Saturday 12 December");

    await waitFor(() =>
      expect(
        card().getByText(
          "At 20 min a day, ~140 of 300 new cards won't be learned by 12 Dec. 35 min a day would cover them.",
        ),
      ).toBeTruthy(),
    );
    fireEvent.click(card().getByRole("button", { name: "Use 35 min" }));

    expect(minutes().value).toBe("35");
    await waitFor(() =>
      expect(card().getByText("Covers all 300 new cards by 12 Dec.")).toBeTruthy(),
    );
  });

  test("never lets the warning block saving", async () => {
    stubApi();
    renderCard();
    fireEvent.click(card().getByRole("button", { name: "Create plan" }));
    fireEvent.change(minutes(), { target: { value: "20" } });
    pickDeadline("Saturday 12 December");
    await waitFor(() => expect(card().getByText(/won't be learned/)).toBeTruthy());

    fireEvent.click(card().getByRole("button", { name: "Create plan" }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toEqual({ deadline: "2026-12-12", dailyMinutes: 20 });
  });

  test("says when even 600 minutes won't do, and suggests a later deadline", async () => {
    stubApi(() => ({ newCards: 300, unlearned: 260, neededMinutes: null }));
    renderCard();
    fireEvent.click(card().getByRole("button", { name: "Create plan" }));

    pickDeadline("Friday 13 November", 0);

    await waitFor(() =>
      expect(
        card().getByText(
          "Even 600 min a day won't cover all 300 new cards by 13 Nov. A later deadline would give them time.",
        ),
      ).toBeTruthy(),
    );
    expect(card().queryByRole("button", { name: /^Use/ })).toBeNull();
  });

  test("says when there are no new cards to learn", async () => {
    stubApi(() => ({ newCards: 0, unlearned: 0, neededMinutes: 5 }));
    renderCard();
    fireEvent.click(card().getByRole("button", { name: "Create plan" }));

    pickDeadline("Saturday 12 December");

    await waitFor(() => expect(card().getByText("No new cards to learn.")).toBeTruthy());
  });

  test("shows a saved Plan with Edit and Remove plan, checked again each time it shows", async () => {
    stubApi();
    const plan = { deadline: "2026-12-12", dailyMinutes: 20 };
    const queryClient = new QueryClient();
    // A check from before the Deck's Cards changed.
    const stale: PlanCheckResponse = { newCards: 100, unlearned: 0, neededMinutes: 10 };
    queryClient.setQueryData(planCheckQueryOptions(DECK.id, plan).queryKey, stale);

    renderCard(plan, queryClient);

    expect(card().getByText("Saturday 12 December 2026")).toBeTruthy();
    expect(card().getByText("20 min")).toBeTruthy();
    expect(card().getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(card().getByRole("button", { name: "Remove plan" })).toBeTruthy();
    await waitFor(() => expect(card().getByText(/~140 of 300 new cards/)).toBeTruthy());
    expect(checks).toEqual([plan]);
  });

  test("Use N min on a saved Plan opens Edit with the goal set", async () => {
    stubApi();
    renderCard({ deadline: "2026-12-12", dailyMinutes: 20 });
    await waitFor(() => expect(card().getByRole("button", { name: "Use 35 min" })).toBeTruthy());

    fireEvent.click(card().getByRole("button", { name: "Use 35 min" }));

    expect(minutes().value).toBe("35");
    expect(deadlineField().textContent).toContain("Sat 12 Dec 2026");
    expect(card().getByRole("button", { name: "Save" })).toBeTruthy();
  });

  test("Edit opens the form at the Plan, and Save sends the change", async () => {
    stubApi();
    renderCard({ deadline: "2026-12-12", dailyMinutes: 40 });
    fireEvent.click(card().getByRole("button", { name: "Edit" }));
    expect(minutes().value).toBe("40");
    expect(deadlineField().textContent).toContain("Sat 12 Dec 2026");

    fireEvent.change(minutes(), { target: { value: "45" } });
    fireEvent.click(card().getByRole("button", { name: "Save" }));

    await waitFor(() => expect(card().getByText("45 min")).toBeTruthy());
    expect(sent).toEqual([
      {
        method: "PUT",
        path: "/api/decks/d1/plan",
        body: { deadline: "2026-12-12", dailyMinutes: 45 },
      },
    ]);
  });

  test("Cancel leaves the Plan as it was", () => {
    stubApi();
    renderCard({ deadline: "2026-12-12", dailyMinutes: 40 });
    fireEvent.click(card().getByRole("button", { name: "Edit" }));
    fireEvent.change(minutes(), { target: { value: "90" } });

    fireEvent.click(card().getByRole("button", { name: "Cancel" }));

    expect(card().getByText("40 min")).toBeTruthy();
    expect(card().queryByRole("textbox")).toBeNull();
    expect(sent).toEqual([]);
  });

  test("Cancel on a new Plan leaves the Deck with none", () => {
    stubApi();
    renderCard();
    fireEvent.click(card().getByRole("button", { name: "Create plan" }));

    fireEvent.click(card().getByRole("button", { name: "Cancel" }));

    expect(card().getByText(/This deck has no Plan/)).toBeTruthy();
    expect(sent).toEqual([]);
  });

  test("Remove plan asks first, and removes it with DELETE", async () => {
    stubApi();
    renderCard({ deadline: "2026-12-12", dailyMinutes: 40 });
    fireEvent.click(card().getByRole("button", { name: "Remove plan" }));

    const dialog = screen.getByRole("alertdialog", { name: "Remove this plan?" });
    expect(within(dialog).getByText(/will have no deadline or daily goal/)).toBeTruthy();
    expect(within(dialog).queryByText(/Recently deleted/)).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove plan" }));

    await waitFor(() => expect(card().getByText(/This deck has no Plan/)).toBeTruthy());
    expect(sent).toEqual([{ method: "DELETE", path: "/api/decks/d1/plan", body: undefined }]);
  });

  test("Cancel in the confirm keeps the Plan", async () => {
    stubApi();
    renderCard({ deadline: "2026-12-12", dailyMinutes: 40 });
    fireEvent.click(card().getByRole("button", { name: "Remove plan" }));

    const dialog = screen.getByRole("alertdialog", { name: "Remove this plan?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(card().getByText("40 min")).toBeTruthy();
    expect(sent).toEqual([]);
  });

  test("shows the minutes' errors inline once typed, and saves nothing", () => {
    stubApi();
    renderCard();
    fireEvent.click(card().getByRole("button", { name: "Create plan" }));
    pickDeadline("Saturday 12 December");

    fireEvent.change(minutes(), { target: { value: "601" } });
    expect(card().getByText("Between 5 and 600 minutes.")).toBeTruthy();
    expect(minutes().getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(minutes(), { target: { value: "4" } });
    expect(card().getByText("Between 5 and 600 minutes.")).toBeTruthy();
    fireEvent.change(minutes(), { target: { value: "" } });
    expect(card().getByText("Enter the minutes a day.")).toBeTruthy();

    fireEvent.click(card().getByRole("button", { name: "Create plan" }));
    expect(sent).toEqual([]);
  });

  test("asks for the Deadline when Create plan is pressed without one", () => {
    stubApi();
    renderCard();
    fireEvent.click(card().getByRole("button", { name: "Create plan" }));

    fireEvent.click(card().getByRole("button", { name: "Create plan" }));

    expect(card().getByText("Pick the day.")).toBeTruthy();
    expect(sent).toEqual([]);
  });

  test("offers only the days from tomorrow to 2 years out", () => {
    stubApi();
    renderCard();
    fireEvent.click(card().getByRole("button", { name: "Create plan" }));
    fireEvent.click(deadlineField());

    expect(day("Thursday 12 November").disabled).toBe(true);
    expect(day("Friday 13 November").disabled).toBe(false);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Previous month" }).disabled).toBe(
      true,
    );
  });

  test("marks a Plan whose Deadline has come, with Edit and Remove, and no check", async () => {
    stubApi();
    renderCard({ deadline: "2026-11-09", dailyMinutes: 30 });

    expect(
      card().getByText("Its deadline has passed. Edit it for the next exam, or remove it."),
    ).toBeTruthy();
    expect(card().getByText("0")).toBeTruthy();
    expect(card().getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(card().getByRole("button", { name: "Remove plan" })).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(checks).toEqual([]);
  });

  test("Edit on a passed Plan says its Deadline needs a day after today", () => {
    stubApi();
    renderCard({ deadline: "2026-11-09", dailyMinutes: 30 });

    fireEvent.click(card().getByRole("button", { name: "Edit" }));

    expect(card().getByText("Pick a day after today.")).toBeTruthy();
    expect(deadlineField().getAttribute("aria-invalid")).toBe("true");
    fireEvent.click(card().getByRole("button", { name: "Save" }));
    expect(sent).toEqual([]);
  });
});
