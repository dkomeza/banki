// @vitest-environment happy-dom
import type { SettingsResponse } from "@banki/shared";
import { EditorView } from "@codemirror/view";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterContextProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cardsQueryOptions } from "@/lib/cards";
import { type Deck, decksQueryOptions } from "@/lib/decks";
import { foldersQueryOptions } from "@/lib/folders";
import { settingsQueryOptions } from "@/lib/settings";
import { CardEditor, useCardForm } from "./card-editor";
import { useTagInput } from "./tag-field";

const DECK: Deck = {
  id: "d1",
  name: "Spanish",
  description: null,
  folderId: null,
  createdAt: "2026-05-01T09:00:00.000Z",
  cardCount: 0,
  desiredRetention: null,
  macros: [],
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
  macros: [],
};

/** The form as the new-card page has it: focused as it opens, held while a save is on its way. */
function NewCardForm() {
  const form = useCardForm({ front: "", back: "", gradingNotes: "" });
  const tags = useTagInput(["food"]);
  const [saving, setSaving] = useState(false);
  return (
    <CardEditor
      deck={DECK}
      title="New card"
      dateline="Today"
      form={form}
      tags={tags}
      onSave={() => {}}
      saving={saving}
      autoFocus
      foot={
        <button type="button" onClick={() => setSaving((was) => !was)}>
          {saving ? "End the save" : "Start a save"}
        </button>
      }
    />
  );
}

function renderForm() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(foldersQueryOptions().queryKey, []);
  queryClient.setQueryData(decksQueryOptions().queryKey, [DECK]);
  queryClient.setQueryData(settingsQueryOptions().queryKey, { settings: SETTINGS, issuedAt: 0 });
  queryClient.setQueryData(cardsQueryOptions(DECK.id).queryKey, []);
  const router = createRouter({ routeTree: createRootRoute(), history: createMemoryHistory() });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterContextProvider router={router}>
        <NewCardForm />
      </RouterContextProvider>
    </QueryClientProvider>,
  );
}

const sides = () => [...document.querySelectorAll<HTMLElement>(".cm-content")];
const readOnly = (side: HTMLElement) => EditorView.findFromDOM(side)?.state.readOnly;

// Nothing reaches a real API.
beforeEach(() => {
  vi.stubGlobal("fetch", async () => new Response("[]"));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CardForm on the new-card page", () => {
  test("focuses the Front as it opens", async () => {
    renderForm();

    await waitFor(() => expect(sides().length).toBeGreaterThan(0));
    await waitFor(() => expect(sides()[0]?.contains(document.activeElement)).toBe(true));
  });

  test("holds the sides and the Tags while a save is on its way, and frees them after", async () => {
    renderForm();
    await waitFor(() => expect(sides().length).toBeGreaterThan(0));

    fireEvent.click(screen.getByText("Start a save"));
    for (const side of sides()) expect(readOnly(side)).toBe(true);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Backspace" });
    expect(screen.getByText("food")).toBeTruthy();

    fireEvent.click(screen.getByText("End the save"));
    for (const side of sides()) expect(readOnly(side)).toBe(false);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Backspace" });
    expect(screen.queryByText("food")).toBeNull();
  });
});
