// @vitest-environment happy-dom
import type { SettingsPatch, SettingsResponse, TuningStatus } from "@banki/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { type Deck, decksQueryOptions } from "@/lib/decks";
import { settingsQueryOptions } from "@/lib/settings";
import { settingsSaverFor } from "@/lib/settings-store";
import { tuningQueryOptions } from "@/lib/tuning";
import { StudyCard } from "./study-card";

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

const deck = (id: string, own: Partial<Deck> = {}): Deck => ({
  id,
  name: `Deck ${id}`,
  description: null,
  folderId: null,
  createdAt: "2026-05-01T09:00:00.000Z",
  cardCount: 0,
  desiredRetention: null,
  macros: [],
  answerMode: null,
  plan: null,
  cardPrompt: { language: "", count: null, difficulty: "intermediate", instructions: "" },
  ...own,
});

/** How Tuning stands: tuned, with `recommendedRetention`. */
const tuning = (recommendedRetention: number | null): TuningStatus => ({
  parameters: recommendedRetention === null ? "default" : "tuned",
  tuned: recommendedRetention === null ? null : { at: "2026-05-01T09:00:00.000Z", reviews: 400 },
  lastAttempt: null,
  reviewsUntilAutomatic: 200,
  paused: false,
  running: false,
  recommendedRetention,
});

afterEach(cleanup);

/**
 * The Study card over `decks`, the Settings saving through `save`, with
 * `recommended` as the Recommended retention.
 */
function renderCard(
  decks: Deck[],
  save: (patch: SettingsPatch) => Promise<SettingsResponse> = async (patch) => ({
    ...SETTINGS,
    ...patch,
  }),
  recommended: number | null = null,
) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(settingsQueryOptions().queryKey, { settings: SETTINGS, issuedAt: 0 });
  queryClient.setQueryData(decksQueryOptions().queryKey, decks);
  queryClient.setQueryData(tuningQueryOptions().queryKey, tuning(recommended));
  settingsSaverFor(queryClient, { save });
  render(
    <QueryClientProvider client={queryClient}>
      <StudyCard />
    </QueryClientProvider>,
  );
  return queryClient;
}

const answerMode = () => screen.getByRole<HTMLInputElement>("combobox", { name: "Answer mode" });

/** Opens the Answer mode picker and picks the option named `name`. */
function pick(name: string) {
  fireEvent.focus(answerMode());
  fireEvent.click(screen.getByRole("option", { name: new RegExp(`^${name}`) }));
}

describe("StudyCard's Answer mode", () => {
  test("sits under Desired retention, at Settings' mode, offering the two modes and no Follow", () => {
    renderCard([deck("a")]);

    const pickers = screen.getAllByRole("combobox");
    expect(pickers).toHaveLength(2);
    expect(pickers[1]).toBe(answerMode());
    expect(screen.getByRole("combobox", { name: "Desired retention" })).toBe(pickers[0]);
    expect(answerMode().value).toBe("Rate yourself");

    fireEvent.focus(answerMode());
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Rate yourself",
      "Write and grade",
    ]);
  });

  test("says what the modes do, and that every deck follows it while none has its own", () => {
    renderCard([deck("a"), deck("b", { desiredRetention: 85 })]);

    const hint = answerMode().getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(hint)?.textContent).toBe(
      "Rate yourself shows the answer, then you rate how well you recalled it. Write and grade asks you to write your answer first. A new session starts in it. Every deck follows it unless you give it its own, in its Deck settings.",
    );
  });

  test.each([
    [1, "Every deck follows it but one, which has its own."],
    [2, "Every deck follows it but 2, which have their own."],
  ])("counts the %d Decks with their own mode", (count, sentence) => {
    renderCard([
      deck("a"),
      ...Array.from({ length: count }, (_, i) => deck(`own${i}`, { answerMode: "write" })),
    ]);

    const hint = answerMode().getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(hint)?.textContent).toContain(sentence);
  });

  test("saves as it changes, Saving… then Saved", async () => {
    const sent: SettingsPatch[] = [];
    let answer: ((settings: SettingsResponse) => void) | undefined;
    renderCard([deck("a")], (patch) => {
      sent.push(patch);
      return new Promise((resolve) => (answer = resolve));
    });

    pick("Write and grade");

    expect(sent).toEqual([{ answerMode: "write" }]);
    expect(answerMode().value).toBe("Write and grade");
    expect(screen.getByText("Saving")).toBeTruthy();
    await act(async () => answer?.({ ...SETTINGS, answerMode: "write" }));
    await waitFor(() => expect(screen.getByText("Saved")).toBeTruthy());
    expect(answerMode().value).toBe("Write and grade");
  });

  test("a change that didn't save goes back, with an inline error and Try again", async () => {
    let fail = true;
    const sent: SettingsPatch[] = [];
    renderCard([deck("a")], async (patch) => {
      sent.push(patch);
      if (fail) throw new Error("offline");
      return { ...SETTINGS, ...patch };
    });

    pick("Write and grade");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "The change to Write and grade didn't save, so it's still Rate yourself.",
    );
    expect(answerMode().value).toBe("Rate yourself");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(answerMode().value).toBe("Write and grade");
    expect(sent).toEqual([{ answerMode: "write" }, { answerMode: "write" }]);
  });
});

const retention = () =>
  screen.getByRole<HTMLInputElement>("combobox", { name: "Desired retention" });
const useButton = (percent: number) => screen.queryByRole("button", { name: `Use ${percent}%` });

describe("StudyCard's Recommended retention", () => {
  test("shows nothing while there is none", () => {
    renderCard([deck("a")]);

    expect(screen.queryByText(/Recommended/)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Use/ })).toBeNull();
    fireEvent.focus(retention());
    expect(screen.queryByRole("option", { name: /Recommended/ })).toBeNull();
  });

  test("says what it is and why, in plain words, under the picker", () => {
    renderCard([deck("a")], undefined, 84);

    const line = screen.getByText("Recommended for you: 84%").parentElement;
    if (line === null) throw new Error("No line");
    expect(line.textContent).toBe(
      "Recommended for you: 84% · From how well you remember and how long your cards take you, this is where you keep the most for the time you study.",
    );
    expect(line.textContent).not.toMatch(/fsrs|parameter/i);
    // Under the picker, before what the value means.
    const hint = document.getElementById(retention().getAttribute("aria-describedby") ?? "");
    expect(
      retention().compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      (hint?.compareDocumentPosition(line) ?? 0) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
  });

  test("tags its percent in the picker, and a search for it finds it", () => {
    renderCard([deck("a")], undefined, 84);

    fireEvent.focus(retention());
    expect(screen.getByRole("option", { name: "84% Recommended" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "90% default" })).toBeTruthy();
    fireEvent.change(retention(), { target: { value: "recomm" } });
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "84%Recommended",
    ]);
  });

  test("tags the default percent too, when it is the one", () => {
    renderCard([deck("a")], undefined, 90);

    fireEvent.focus(retention());
    expect(screen.getByRole("option", { name: "90% default · Recommended" })).toBeTruthy();
  });

  test("Use saves it as a pick does, and goes once it is the value", async () => {
    const sent: SettingsPatch[] = [];
    renderCard(
      [deck("a")],
      async (patch) => {
        sent.push(patch);
        return { ...SETTINGS, ...patch };
      },
      84,
    );

    fireEvent.click(screen.getByRole("button", { name: "Use 84%" }));

    expect(sent).toEqual([{ desiredRetention: 84 }]);
    expect(retention().value).toBe("84%");
    expect(useButton(84)).toBeNull();
    await waitFor(() => expect(screen.getByText("Saved")).toBeTruthy());
    expect(screen.getByText("Recommended for you: 84%")).toBeTruthy();
  });

  test("Use shows only while the value differs", () => {
    renderCard([deck("a")], undefined, 90);

    expect(screen.getByText("Recommended for you: 90%")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Use/ })).toBeNull();
  });

  test("follows the tuning status as it is fetched again, after Tune now or Reset", async () => {
    const queryClient = renderCard([deck("a")], undefined, 84);

    await act(async () => {
      queryClient.setQueryData(tuningQueryOptions().queryKey, tuning(80));
    });
    await waitFor(() => expect(screen.getByText("Recommended for you: 80%")).toBeTruthy());
    await act(async () => {
      queryClient.setQueryData(tuningQueryOptions().queryKey, tuning(null));
    });
    await waitFor(() => expect(screen.queryByText(/Recommended for you/)).toBeNull());
  });
});
