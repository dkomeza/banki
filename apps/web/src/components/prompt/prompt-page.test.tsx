// @vitest-environment happy-dom
import {
  buildCardPrompt,
  type CardPromptOptions,
  cardFileSchemaUrl,
  DEFAULT_CARD_PROMPT_OPTIONS,
  type Macro,
  type SettingsResponse,
} from "@banki/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterContextProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { deckCardPromptSaverFor } from "@/lib/card-prompt";
import { type Deck, decksQueryOptions } from "@/lib/decks";
import { foldersQueryOptions } from "@/lib/folders";
import { settingsQueryOptions } from "@/lib/settings";
import { PromptPage } from "./prompt-page";

const DECK: Deck = {
  id: "d1",
  name: "Calculus 2",
  description: null,
  folderId: null,
  createdAt: "2026-05-01T09:00:00.000Z",
  cardCount: 2,
  desiredRetention: null,
  macros: [{ name: "\\norm", definition: "\\left\\| #1 \\right\\|" }],
  answerMode: null,
  plan: null,
  cardPrompt: DEFAULT_CARD_PROMPT_OPTIONS,
};

const SETTINGS_MACROS: Macro[] = [{ name: "\\R", definition: "\\mathbb{R}" }];

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
  macros: SETTINGS_MACROS,
};

const URL = cardFileSchemaUrl(window.location.origin);
const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  writeText.mockReset().mockResolvedValue();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});
afterEach(cleanup);

/** The page for `deck`, its options saving through `save`, with Settings' `macros`. */
function renderPage(
  deck: Deck,
  save: (options: CardPromptOptions) => Promise<void> = async () => {},
  macros: Macro[] = SETTINGS_MACROS,
) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(settingsQueryOptions().queryKey, {
    settings: { ...SETTINGS, macros },
    issuedAt: 0,
  });
  queryClient.setQueryData(foldersQueryOptions().queryKey, []);
  queryClient.setQueryData(decksQueryOptions().queryKey, [deck]);
  deckCardPromptSaverFor(queryClient, deck.id, { save });
  const router = createRouter({ routeTree: createRootRoute(), history: createMemoryHistory() });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterContextProvider router={router}>
        <PromptPage deck={deck} />
      </RouterContextProvider>
    </QueryClientProvider>,
  );
}

const shown = () => screen.getByLabelText("The Card prompt").textContent;
const copyPrompt = () => screen.getByRole<HTMLButtonElement>("button", { name: "Copy prompt" });
const field = (name: string) => screen.getByLabelText<HTMLInputElement>(name);

describe("PromptPage", () => {
  test("shows the prompt for the Deck's options and effective Macros, and Copy prompt copies exactly it", async () => {
    renderPage(DECK);

    const expected = buildCardPrompt(
      DEFAULT_CARD_PROMPT_OPTIONS,
      [...SETTINGS_MACROS, ...DECK.macros],
      URL,
    );
    expect(shown()).toBe(expected);
    expect(shown()).toContain("- `\\R` → `\\mathbb{R}`");
    expect(shown()).toContain("- `\\norm` →");
    fireEvent.click(copyPrompt());
    expect(writeText).toHaveBeenCalledWith(expected);
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
    expect(screen.getByText(/characters on your clipboard/)).toBeTruthy();
  });

  test("starts from the options the Deck keeps", () => {
    const cardPrompt = {
      language: "Polish",
      count: 40,
      difficulty: "advanced",
      instructions: "Skip the history.",
    } as const;
    renderPage({ ...DECK, cardPrompt });

    expect(field("Card language").value).toBe("Polish");
    expect(field("Number of cards").value).toBe("40");
    expect(screen.getByRole("radio", { name: "Advanced" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(field("Extra instructions").value).toBe("Skip the history.");
    expect(shown()).toContain("- Card language: Polish.");
    expect(shown()).toContain("## Extra instructions\n\nSkip the history.");
  });

  test("has no Macros section for a Deck with no effective Macros", () => {
    renderPage({ ...DECK, macros: [] }, undefined, []);

    expect(shown()).not.toContain("## Macros");
  });

  test("updates the prompt as an option changes, and saves once typing pauses", async () => {
    const save = vi.fn<(options: CardPromptOptions) => Promise<void>>(async () => {});
    renderPage(DECK, save);

    fireEvent.change(field("Card language"), { target: { value: "Pol" } });
    fireEvent.change(field("Card language"), { target: { value: "Polish " } });

    expect(shown()).toContain("- Card language: Polish.");
    expect(save).not.toHaveBeenCalled();
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith({ ...DEFAULT_CARD_PROMPT_OPTIONS, language: "Polish" });
    fireEvent.click(copyPrompt());
    expect(writeText).toHaveBeenCalledWith(shown());
  });

  test("saves a difficulty at once", () => {
    const save = vi.fn<(options: CardPromptOptions) => Promise<void>>(async () => {});
    renderPage(DECK, save);

    fireEvent.click(screen.getByRole("radio", { name: "Introductory" }));

    expect(save).toHaveBeenCalledWith({
      ...DEFAULT_CARD_PROMPT_OPTIONS,
      difficulty: "introductory",
    });
    expect(shown()).toContain("Keep the questions introductory");
  });

  test("a number out of range or instructions too long show their problem, save nothing and disable Copy prompt", async () => {
    const save = vi.fn<(options: CardPromptOptions) => Promise<void>>(async () => {});
    renderPage(DECK, save);
    const before = shown();

    fireEvent.change(field("Number of cards"), { target: { value: "1500" } });
    expect(screen.getByText("A whole number from 1 to 1,000, or blank")).toBeTruthy();
    fireEvent.change(field("Extra instructions"), { target: { value: "y".repeat(2140) } });
    expect(screen.getByText("Up to 2,000 characters: 140 too many")).toBeTruthy();

    expect(copyPrompt().disabled).toBe(true);
    expect(screen.getByText("Fix the options first.")).toBeTruthy();
    expect(shown()).toBe(before);
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(save).not.toHaveBeenCalled();

    for (const count of ["0", "2.5", "-3", "abc"]) {
      fireEvent.change(field("Number of cards"), { target: { value: count } });
      expect(screen.getByText("A whole number from 1 to 1,000, or blank")).toBeTruthy();
    }
    fireEvent.change(field("Card language"), { target: { value: "x".repeat(51) } });
    expect(screen.getByText("Up to 50 characters: 1 too many")).toBeTruthy();
  });

  test("a failed save shows Try again, which saves again", async () => {
    let fails = true;
    const save = vi.fn<(options: CardPromptOptions) => Promise<void>>(async () => {
      if (fails) throw new Error("offline");
    });
    renderPage(DECK, save);

    fireEvent.click(screen.getByRole("radio", { name: "Advanced" }));
    await screen.findByText(/Couldn.t save these options/);
    expect(screen.queryByText("Saved for this deck, on every device.")).toBeNull();
    fails = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(screen.queryByText(/Couldn.t save these options/)).toBeNull());
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({
      ...DEFAULT_CARD_PROMPT_OPTIONS,
      difficulty: "advanced",
    });
  });

  test("says so when the prompt couldn't be copied, rather than Copied", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    renderPage(DECK);

    fireEvent.click(copyPrompt());

    expect(await screen.findByText(/Couldn.t copy it/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
  });

  test("a change with a problem still lets the valid one before it save", async () => {
    const save = vi.fn<(options: CardPromptOptions) => Promise<void>>(async () => {});
    renderPage(DECK, save);

    fireEvent.change(field("Number of cards"), { target: { value: "5" } });
    fireEvent.change(field("Number of cards"), { target: { value: "50000" } });

    expect(shown()).toContain("- Number of cards: 5.");
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith({ ...DEFAULT_CARD_PROMPT_OPTIONS, count: 5 });
  });

  test("sends a change still waiting when the page closes", () => {
    const save = vi.fn<(options: CardPromptOptions) => Promise<void>>(async () => {});
    const { unmount } = renderPage(DECK, save);

    fireEvent.change(field("Number of cards"), { target: { value: "25" } });
    act(() => unmount());

    expect(save).toHaveBeenCalledWith({ ...DEFAULT_CARD_PROMPT_OPTIONS, count: 25 });
  });

  test("shows the JSON Schema with its absolute URL, and Copy schema copies it", () => {
    renderPage(DECK);

    expect(screen.getByRole("link", { name: URL }).getAttribute("href")).toBe(URL);
    fireEvent.click(screen.getByRole("button", { name: "Copy schema" }));
    expect(writeText).toHaveBeenCalledWith(screen.getByLabelText("The JSON Schema").textContent);
    expect(JSON.parse(writeText.mock.calls[0]?.[0] ?? "")).toHaveProperty("title");
  });

  test("links to the import page", () => {
    renderPage(DECK);

    expect(document.querySelector('a[href="/decks/d1/import"]')?.textContent).toBe(
      "Import the JSON",
    );
  });
});
