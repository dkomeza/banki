// @vitest-environment happy-dom
import type { AnswerMode, SettingsPatch, SettingsResponse } from "@banki/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { deckAnswerModeSaverFor } from "@/lib/deck-answer-mode";
import type { Deck } from "@/lib/decks";
import { settingsQueryOptions } from "@/lib/settings";
import { settingsSaverFor } from "@/lib/settings-store";
import { AnswerModeCard } from "./answer-mode-card";

const DECK: Deck = {
  id: "d1",
  name: "Calculus 2",
  description: null,
  folderId: null,
  createdAt: "2026-05-01T09:00:00.000Z",
  cardCount: 2,
  desiredRetention: null,
  macros: [],
  answerMode: null,
};

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

afterEach(cleanup);

/**
 * The card for `deck`, its saver saving through `save`, with Settings in
 * `followed` mode, their saver saving through `saveSettings`.
 */
function renderCard(
  deck: Deck,
  save: (mode: AnswerMode | null) => Promise<void>,
  {
    followed = "self-rate",
    saveSettings = async (patch) => ({ ...SETTINGS, answerMode: followed, ...patch }),
  }: {
    followed?: AnswerMode;
    saveSettings?: (patch: SettingsPatch) => Promise<SettingsResponse>;
  } = {},
) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(settingsQueryOptions().queryKey, {
    settings: { ...SETTINGS, answerMode: followed },
    issuedAt: 0,
  });
  const settingsSaver = settingsSaverFor(queryClient, { save: saveSettings });
  deckAnswerModeSaverFor(queryClient, deck.id, { save });
  render(
    <QueryClientProvider client={queryClient}>
      <AnswerModeCard deck={deck} />
    </QueryClientProvider>,
  );
  return { queryClient, settingsSaver };
}

const picker = () => screen.getByRole<HTMLInputElement>("combobox");

/** Opens the picker and picks the option named `name`. */
function pick(name: string) {
  fireEvent.focus(picker());
  fireEvent.click(screen.getByRole("option", { name: new RegExp(`^${name}`) }));
}

describe("AnswerModeCard", () => {
  test("replaces Coming later: a following Deck shows Follow Settings, with Settings' mode", () => {
    renderCard(DECK, async () => {});

    expect(screen.getByRole("heading", { name: "Answer mode" })).toBeTruthy();
    expect(screen.queryByText("Coming later")).toBeNull();
    expect(picker().value).toBe("Follow Settings (Rate yourself)");
    expect(screen.getByText(/Follows Settings: Rate yourself/)).toBeTruthy();
  });

  test("a following Deck shows Settings' Write and grade in the label and the hint", () => {
    renderCard(DECK, async () => {}, { followed: "write" });

    expect(picker().value).toBe("Follow Settings (Write and grade)");
    expect(screen.getByText(/Follows Settings: Write and grade\./)).toBeTruthy();
  });

  test("shows a change to Settings' mode at once, before it saves, and after a read", async () => {
    let answer: ((settings: SettingsResponse) => void) | undefined;
    const { queryClient, settingsSaver } = renderCard(DECK, async () => {}, {
      saveSettings: () => new Promise((resolve) => (answer = resolve)),
    });

    act(() => settingsSaver.change({ field: "answerMode", attempted: "write" }));
    expect(picker().value).toBe("Follow Settings (Write and grade)");
    expect(screen.getByText(/Follows Settings: Write and grade\./)).toBeTruthy();
    await act(async () => answer?.({ ...SETTINGS, answerMode: "write" }));
    expect(picker().value).toBe("Follow Settings (Write and grade)");

    // Another device changed them back, and a read brought it in.
    act(() => {
      queryClient.setQueryData(settingsQueryOptions().queryKey, {
        settings: { ...SETTINGS, answerMode: "self-rate" },
        issuedAt: performance.now(),
      });
    });
    await waitFor(() => expect(picker().value).toBe("Follow Settings (Rate yourself)"));
    expect(screen.getByText(/Follows Settings: Rate yourself\./)).toBeTruthy();
  });

  test("a Deck with its own shows it", () => {
    renderCard({ ...DECK, answerMode: "write" }, async () => {});

    expect(picker().value).toBe("Write and grade");
    expect(screen.getByText(/Its own, whatever Settings say/)).toBeTruthy();
  });

  test("picks a mode, or Follow Settings, saving each with its save state", async () => {
    const saves: (AnswerMode | null)[] = [];
    const pending: (() => void)[] = [];
    const finish = () => pending.shift()?.();
    // The cache isn't kept here, so the Deck shows its own self-rate again after each save.
    renderCard({ ...DECK, answerMode: "self-rate" }, (mode) => {
      saves.push(mode);
      return new Promise<void>((resolve) => {
        pending.push(resolve);
      });
    });

    pick("Write and grade");
    expect(saves).toEqual(["write"]);
    expect(picker().value).toBe("Write and grade");
    expect(screen.getByText("Saving")).toBeTruthy();
    await act(async () => finish());
    await waitFor(() => expect(screen.getByText("Saved")).toBeTruthy());

    pick("Follow Settings");
    await act(async () => finish());
    expect(saves).toEqual(["write", null]);
  });

  test("a change that didn't save says so, and Try again sends it again", async () => {
    let fail = true;
    const saves: (AnswerMode | null)[] = [];
    renderCard(DECK, async (mode) => {
      saves.push(mode);
      if (fail) throw new Error("offline");
    });

    pick("Write and grade");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "The change to Write and grade didn't save, so it still follows Settings (Rate yourself).",
    );
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(saves).toEqual(["write", "write"]);
  });

  test("a change that didn't save names Settings' mode as it is", async () => {
    renderCard(
      DECK,
      async () => {
        throw new Error("offline");
      },
      { followed: "write" },
    );

    pick("Rate yourself");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "The change to Rate yourself didn't save, so it still follows Settings (Write and grade).",
    );
  });
});
