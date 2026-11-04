// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  type RouterHistory,
  RouterContextProvider,
  createBrowserHistory,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { type Card, cardsQueryOptions } from "@/lib/cards";
import type { Deck } from "@/lib/decks";
import { createStudySession } from "@/lib/study";
import { StudyEditor, type StudyEditorHandle, leaveOrCancelEdit } from "./study-editor";

vi.mock("@/components/folders/drag", () => ({ useFinePointer: () => false }));

const DECK: Deck = {
  id: "d1",
  name: "Spanish",
  description: null,
  folderId: null,
  createdAt: "2026-05-01T09:00:00.000Z",
  cardCount: 1,
  desiredRetention: null,
  macros: [],
};

const card = (studied: boolean): Card => ({
  id: "c1",
  deckId: "d1",
  front: "el desayuno",
  back: "breakfast",
  tags: ["food"],
  gradingNotes: null,
  createdAt: "2026-05-01T09:00:00.000Z",
  updatedAt: "2026-05-01T09:00:00.000Z",
  studied,
});

/** A Session whose side of the editor only records what it is asked, with the spies that record it. */
function recordingSession() {
  const session = createStudySession({
    studyApi: {
      next: async () => ({ next: null, newHeld: 0 }),
      rate: async () => "gone",
      undo: async () => "gone",
      intervals: async () => "gone",
    },
    notify: () => {},
  });
  return {
    session,
    cancelEdit: vi.spyOn(session, "cancelEdit").mockImplementation(() => {}),
    closeGone: vi.spyOn(session, "closeGone").mockImplementation(async () => {}),
    saveEdit: vi.spyOn(session, "saveEdit").mockImplementation(async () => {}),
  };
}

/**
 * The API, answering `answer` for each request it is sent, and recording those
 * that write (the form's own reads, such as the Settings, go unrecorded).
 */
function stubApi(answer: (method: string, path: string) => Response | Promise<Response>) {
  const sent: { method: string; path: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(
      new URL(String(input instanceof Request ? input.url : input), "http://banki.test"),
      init,
    );
    const path = new URL(request.url).pathname;
    const text = await request.text();
    if (request.method !== "GET") {
      sent.push({ method: request.method, path, body: text === "" ? undefined : JSON.parse(text) });
    }
    return answer(request.method, path);
  });
  return sent;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/**
 * The open editor over `shown`, on a Session that records what it is asked,
 * its handle in `ref`, with the router it sits in, on `history`.
 */
function renderEditor(
  shown: Card,
  ref = createRef<StudyEditorHandle>(),
  history: RouterHistory = createMemoryHistory(),
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(cardsQueryOptions(DECK.id).queryKey, [shown]);
  const router = createRouter({ routeTree: createRootRoute(), history });
  const recording = recordingSession();
  render(
    <QueryClientProvider client={queryClient}>
      <RouterContextProvider router={router}>
        <StudyEditor deck={DECK} card={shown} revealed session={recording.session} ref={ref} />
      </RouterContextProvider>
    </QueryClientProvider>,
  );
  return { ...recording, router };
}

/**
 * The browser's history, on the study screen opened from the Deck, so Back
 * goes to the Deck. A memory history wouldn't do: it asks the blockers about
 * a link, never about Back, which the browser's does on popstate.
 */
function studyingFromDeck() {
  window.history.replaceState(null, "", "/decks/d1");
  window.history.pushState(null, "", "/decks/d1/study");
  return createBrowserHistory();
}

/** A link to the Deck, then Back, each given time to land. */
async function tryLeaving(history: RouterHistory) {
  await act(async () => {
    history.push("/decks/d1");
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  expect(history.location.pathname).toBe("/decks/d1/study");
  await act(async () => {
    history.back();
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  expect(history.location.pathname).toBe("/decks/d1/study");
}

/** The foot's Cancel, not the top bar's ×, which is named Cancel too. */
const footCancel = () => screen.getByText("Cancel", { selector: "button" });
/** The panel header's ×. */
const headerCancel = () => screen.getByTitle("Cancel (Esc)");
/** The Reset progress checkbox. */
function resetBox(): HTMLInputElement {
  const box = screen.getByRole("checkbox");
  if (!(box instanceof HTMLInputElement)) throw new Error("Reset progress isn't an input");
  return box;
}
const discardAsked = () => screen.queryByText("Discard changes?");
const press = (target: Element, key: string, repeat = false) =>
  fireEvent.keyDown(target, { key, repeat });

// Nothing reaches a real API: what a test doesn't stub answers 404.
beforeEach(() => {
  stubApi(() => json({ code: "not_found" }, 404));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("StudyEditor", () => {
  test("offers Reset progress on a studied Card, unticked", () => {
    renderEditor(card(true));

    expect(screen.getByText("Reset progress")).toBeTruthy();
    expect(resetBox().checked).toBe(false);
  });

  test("never offers it on a New Card", () => {
    renderEditor(card(false));

    expect(screen.queryByText("Reset progress")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  test("is the edit page's form, with Delete, Cancel and Save along its foot", () => {
    renderEditor(card(true));

    expect(screen.getByRole("dialog", { name: "Edit card" })).toBeTruthy();
    expect(screen.getByRole("toolbar", { name: "Front formatting" })).toBeTruthy();
    expect(screen.getByRole("toolbar", { name: "Back formatting" })).toBeTruthy();
    for (const action of ["Delete", "Cancel", "Save"]) {
      expect(screen.getByText(action, { selector: "button" })).toBeTruthy();
    }
  });

  describe("Cancel", () => {
    test("with nothing unsaved closes the editor at once", () => {
      const session = renderEditor(card(true));

      fireEvent.click(footCancel());

      expect(session.cancelEdit).toHaveBeenCalledTimes(1);
      expect(discardAsked()).toBeNull();
    });

    test("with Reset progress ticked asks first; Keep editing stays, Discard closes", async () => {
      const session = renderEditor(card(true));
      fireEvent.click(resetBox());

      fireEvent.click(footCancel());
      await waitFor(() => expect(discardAsked()).not.toBeNull());
      expect(session.cancelEdit).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
      await waitFor(() => expect(discardAsked()).toBeNull());
      expect(session.cancelEdit).not.toHaveBeenCalled();
      expect(resetBox().checked).toBe(true);

      fireEvent.click(footCancel());
      fireEvent.click(await screen.findByRole("button", { name: "Discard" }));
      expect(session.cancelEdit).toHaveBeenCalledTimes(1);
    });

    test("once it has closed the editor, a Save or a Delete in the frame before it goes sends nothing", async () => {
      const sent = stubApi(() => json({ code: "not_found" }, 404));
      const session = renderEditor(card(true));

      fireEvent.click(footCancel());
      expect(session.cancelEdit).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      expect(sent).toEqual([]);
      expect(session.saveEdit).not.toHaveBeenCalled();
      expect(session.closeGone).not.toHaveBeenCalled();
    });

    test("while it asks, a link or Back waits, unasked, so only one dialog asks", async () => {
      const history = studyingFromDeck();
      const session = renderEditor(card(true), undefined, history);
      fireEvent.click(resetBox());
      fireEvent.click(footCancel());
      await waitFor(() => expect(discardAsked()).not.toBeNull());

      await tryLeaving(history);
      expect(screen.getAllByText("Discard changes?")).toHaveLength(1);
      expect(session.cancelEdit).not.toHaveBeenCalled();
      history.destroy();
    });

    test("the panel's × goes the same way", async () => {
      const session = renderEditor(card(true));
      fireEvent.click(resetBox());

      fireEvent.click(screen.getByTitle("Cancel (Esc)"));

      await waitFor(() => expect(discardAsked()).not.toBeNull());
      expect(session.cancelEdit).not.toHaveBeenCalled();
    });

    test("the top bar's × goes the same way, and stays in the Session", async () => {
      const editor = createRef<StudyEditorHandle>();
      const recording = renderEditor(card(true), editor);
      const leave = vi.spyOn(recording.session, "leave");
      const editing = { getState: () => ({ editing: true }), leave };
      fireEvent.click(resetBox());

      expect(leaveOrCancelEdit(editing, editor.current)).toBe("stay");

      await waitFor(() => expect(discardAsked()).not.toBeNull());
      expect(recording.cancelEdit).not.toHaveBeenCalled();
      expect(leave).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Discard" }));
      expect(recording.cancelEdit).toHaveBeenCalledTimes(1);
    });

    test("the top bar's ×, with nothing unsaved, closes the editor at once", () => {
      const editor = createRef<StudyEditorHandle>();
      const recording = renderEditor(card(true), editor);
      const editing = { getState: () => ({ editing: true }), leave: () => "away" as const };

      expect(leaveOrCancelEdit(editing, editor.current)).toBe("stay");

      expect(recording.cancelEdit).toHaveBeenCalledTimes(1);
    });

    test("the top bar's ×, with the editor closed, leaves as the Session says", () => {
      const editor = createRef<StudyEditorHandle>();
      const recording = renderEditor(card(true), editor);
      const closed = { getState: () => ({ editing: false }), leave: () => "summary" as const };

      expect(leaveOrCancelEdit(closed, editor.current)).toBe("summary");

      expect(recording.cancelEdit).not.toHaveBeenCalled();
    });
  });

  describe("Esc", () => {
    test("outside Front and Back closes the editor at once", () => {
      const session = renderEditor(card(true));

      press(screen.getByRole("dialog", { name: "Edit card" }), "Escape");

      expect(session.cancelEdit).toHaveBeenCalledTimes(1);
    });

    test("in Front first only leaves the field, and a second closes", () => {
      const session = renderEditor(card(true));
      const front = document.querySelector(".cm-content")!;

      press(front, "Escape");
      expect(session.cancelEdit).not.toHaveBeenCalled();

      press(front, "Escape");
      expect(session.cancelEdit).toHaveBeenCalledTimes(1);
    });

    test("held in Front only leaves the field: its repeats don't close", () => {
      const session = renderEditor(card(true));
      const front = document.querySelector(".cm-content")!;

      press(front, "Escape");
      press(front, "Escape", true);
      press(front, "Escape", true);

      expect(session.cancelEdit).not.toHaveBeenCalled();
    });

    test("that cancels an IME conversion is the input method's: it neither closes nor leaves the field", () => {
      const session = renderEditor(card(true));
      const front = document.querySelector(".cm-content")!;
      const composing = { key: "Escape", isComposing: true };

      fireEvent.keyDown(screen.getByRole("combobox"), composing);
      fireEvent.keyDown(front, composing);
      fireEvent.keyDown(front, { key: "Escape", keyCode: 229 });
      press(front, "Escape");

      expect(session.cancelEdit).not.toHaveBeenCalled();
    });

    test("in Front, a key between the two Escs starts over", () => {
      const session = renderEditor(card(true));
      const front = document.querySelector(".cm-content")!;

      press(front, "Escape");
      press(front, "a");
      press(front, "Escape");

      expect(session.cancelEdit).not.toHaveBeenCalled();
    });

    test("in Front, a click between the two Escs starts over", () => {
      const session = renderEditor(card(true));
      const front = document.querySelector(".cm-content")!;

      press(front, "Escape");
      fireEvent.pointerDown(front);
      press(front, "Escape");
      expect(session.cancelEdit).not.toHaveBeenCalled();

      press(front, "Escape");
      expect(session.cancelEdit).toHaveBeenCalledTimes(1);
    });

    test("with something unsaved asks first, and Esc in the dialog keeps editing", async () => {
      const session = renderEditor(card(true));
      fireEvent.click(resetBox());

      press(screen.getByRole("dialog", { name: "Edit card" }), "Escape");
      await waitFor(() => expect(discardAsked()).not.toBeNull());

      press(screen.getByRole("alertdialog"), "Escape");
      await waitFor(() => expect(discardAsked()).toBeNull());
      expect(session.cancelEdit).not.toHaveBeenCalled();
    });

    test("while the route's own Discard dialog asks, only closes that dialog, and keeps editing", async () => {
      const session = renderEditor(card(true));
      fireEvent.click(resetBox());

      session.router.history.push("/elsewhere");
      await waitFor(() => expect(discardAsked()).not.toBeNull());

      // From outside the dialog: one inside it never reaches the editor, as
      // the dialog takes it first.
      press(document.body, "Escape");
      await waitFor(() => expect(discardAsked()).toBeNull());
      expect(session.cancelEdit).not.toHaveBeenCalled();
      expect(session.router.history.location.pathname).toBe("/");
    });

    test("in Front, the route's own Discard dialog between the two Escs starts over", async () => {
      const session = renderEditor(card(true));
      fireEvent.click(resetBox());
      const front = document.querySelector(".cm-content")!;
      press(front, "Escape");

      session.router.history.push("/elsewhere");
      await waitFor(() => expect(discardAsked()).not.toBeNull());
      press(document.body, "Escape");
      await waitFor(() => expect(discardAsked()).toBeNull());

      // Only leaves the field; a second asks, as something is unsaved.
      press(front, "Escape");
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(discardAsked()).toBeNull();
      press(front, "Escape");
      await waitFor(() => expect(discardAsked()).not.toBeNull());
      expect(session.cancelEdit).not.toHaveBeenCalled();
    });
  });

  describe("Save", () => {
    const saved = { ...card(true), studied: false, back: "breakfast" };

    test("with Reset progress ticked sends it, and hands the Session a Progress reset", async () => {
      const sent = stubApi(() => json(saved));
      const session = renderEditor(card(true));
      fireEvent.click(resetBox());

      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(session.saveEdit).toHaveBeenCalledTimes(1));
      expect(sent[0]).toMatchObject({
        method: "PATCH",
        path: "/api/cards/c1",
        body: { resetProgress: true },
      });
      expect(session.saveEdit).toHaveBeenCalledWith(saved, { progressReset: true });
    });

    test("unticked sends no reset, and hands the Session a plain edit", async () => {
      const sent = stubApi(() => json(card(true)));
      const session = renderEditor(card(true));

      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(session.saveEdit).toHaveBeenCalledTimes(1));
      expect(sent[0]?.body).not.toHaveProperty("resetProgress");
      expect(session.saveEdit).toHaveBeenCalledWith(card(true), { progressReset: false });
    });

    test("on a Card deleted meanwhile says so, and closing then loads the next Card", async () => {
      stubApi(() => json({ code: "not_found" }, 404));
      const session = renderEditor(card(true));

      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      expect(
        await screen.findByText("This card, or its deck, was deleted meanwhile."),
      ).toBeTruthy();
      expect(session.saveEdit).not.toHaveBeenCalled();
      // Nothing is left to save it with.
      expect(resetBox().disabled).toBe(true);
      fireEvent.click(footCancel());
      expect(session.closeGone).toHaveBeenCalledTimes(1);
      expect(session.cancelEdit).not.toHaveBeenCalled();
    });

    test("on a Card deleted meanwhile, Ctrl/⌘+Enter sends nothing more", async () => {
      const sent = stubApi(() => json({ code: "not_found" }, 404));
      renderEditor(card(true));

      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await screen.findByText("This card, or its deck, was deleted meanwhile.");
      const patches = () => sent.filter((s) => s.method === "PATCH").length;
      expect(patches()).toBe(1);

      fireEvent.keyDown(document.querySelector(".cm-content")!, { key: "Enter", ctrlKey: true });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(patches()).toBe(1);
    });

    test("on its way holds the rest: Cancel, Esc and the top bar's × wait", async () => {
      let answer: ((res: Response) => void) | undefined;
      stubApi((method) =>
        method === "PATCH"
          ? new Promise<Response>((resolve) => {
              answer = resolve;
            })
          : json({ code: "not_found" }, 404),
      );
      const ref = createRef<StudyEditorHandle>();
      const session = renderEditor(card(true), ref);
      fireEvent.click(resetBox());

      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(answer).toBeDefined());
      for (const name of ["Delete", "Save"]) {
        expect(screen.getByRole("button", { name }).hasAttribute("disabled")).toBe(true);
      }
      expect(footCancel().hasAttribute("disabled")).toBe(true);
      expect(headerCancel().hasAttribute("disabled")).toBe(true);
      expect(resetBox().disabled).toBe(true);
      press(document.body, "Escape");
      act(() => ref.current?.cancel());
      expect(session.cancelEdit).not.toHaveBeenCalled();
      expect(discardAsked()).toBeNull();

      answer?.(json(saved));
      await waitFor(() =>
        expect(session.saveEdit).toHaveBeenCalledWith(saved, { progressReset: true }),
      );
    });

    test("on its way holds the study screen too: a link or Back leaves nothing, unasked", async () => {
      let answer: ((res: Response) => void) | undefined;
      stubApi((method) =>
        method === "PATCH"
          ? new Promise<Response>((resolve) => {
              answer = resolve;
            })
          : json({ code: "not_found" }, 404),
      );
      const history = studyingFromDeck();
      // A Save with nothing changed: nothing unsaved, which alone would let it through.
      const session = renderEditor(card(true), undefined, history);
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(answer).toBeDefined());

      await tryLeaving(history);
      expect(discardAsked()).toBeNull();

      answer?.(json(card(true)));
      await waitFor(() =>
        expect(session.saveEdit).toHaveBeenCalledWith(card(true), { progressReset: false }),
      );
      history.destroy();
    });

    test.each([
      [
        "the API fails",
        () => json({ code: "internal" }, 500),
        "Banki couldn't save the card. Try again.",
      ],
      [
        "Banki can't be reached",
        (): Response => {
          throw new TypeError("Failed to fetch");
        },
        "Can't reach Banki. Check your connection and try again.",
      ],
    ])(
      "that fails because %s keeps the editor open with its error, as it was",
      async (_, fails, error) => {
        stubApi((method) => (method === "PATCH" ? fails() : json({ code: "not_found" }, 404)));
        const session = renderEditor(card(true));
        fireEvent.click(resetBox());

        fireEvent.click(screen.getByRole("button", { name: "Save" }));

        expect(await screen.findByText(error)).toBeTruthy();
        expect(session.saveEdit).not.toHaveBeenCalled();
        for (const name of ["Delete", "Save"]) {
          expect(screen.getByRole("button", { name }).hasAttribute("disabled")).toBe(false);
        }
        expect(resetBox()).toMatchObject({ checked: true, disabled: false });
        // Not frozen: Cancel asks, as the ticked box is still unsaved.
        fireEvent.click(footCancel());
        await waitFor(() => expect(discardAsked()).not.toBeNull());
        expect(session.cancelEdit).not.toHaveBeenCalled();
        expect(session.closeGone).not.toHaveBeenCalled();
      },
    );
  });

  describe("Delete", () => {
    test("deletes the Card at once, unasked, and the next Card loads", async () => {
      const sent = stubApi(() => json({ deletionId: "del1" }));
      const session = renderEditor(card(true));
      fireEvent.click(resetBox());

      fireEvent.click(screen.getByRole("button", { name: "Delete" }));

      await waitFor(() => expect(session.closeGone).toHaveBeenCalledTimes(1));
      expect(sent[0]).toMatchObject({ method: "DELETE", path: "/api/cards/c1" });
      expect(discardAsked()).toBeNull();
      expect(session.cancelEdit).not.toHaveBeenCalled();
    });

    test("on its way holds the rest: the foot is disabled, and Cancel and Esc wait", async () => {
      let answer: ((res: Response) => void) | undefined;
      stubApi((method) =>
        method === "DELETE"
          ? new Promise<Response>((resolve) => {
              answer = resolve;
            })
          : json({ code: "not_found" }, 404),
      );
      const session = renderEditor(card(true));

      fireEvent.click(screen.getByRole("button", { name: "Delete" }));

      await waitFor(() => expect(answer).toBeDefined());
      for (const name of ["Delete", "Save"]) {
        expect(screen.getByRole("button", { name }).hasAttribute("disabled")).toBe(true);
      }
      expect(footCancel().hasAttribute("disabled")).toBe(true);
      expect(headerCancel().hasAttribute("disabled")).toBe(true);
      expect(resetBox().disabled).toBe(true);
      press(document.body, "Escape");
      expect(session.cancelEdit).not.toHaveBeenCalled();

      answer?.(json({ deletionId: "del1" }));
      await waitFor(() => expect(session.closeGone).toHaveBeenCalledTimes(1));
    });

    test("on its way holds the study screen too, with something unsaved: a link or Back leaves nothing, unasked", async () => {
      let answer: ((res: Response) => void) | undefined;
      stubApi((method) =>
        method === "DELETE"
          ? new Promise<Response>((resolve) => {
              answer = resolve;
            })
          : json({ code: "not_found" }, 404),
      );
      const history = studyingFromDeck();
      const session = renderEditor(card(true), undefined, history);
      fireEvent.click(resetBox());
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));
      await waitFor(() => expect(answer).toBeDefined());

      await tryLeaving(history);
      expect(discardAsked()).toBeNull();

      answer?.(json({ deletionId: "del1" }));
      await waitFor(() => expect(session.closeGone).toHaveBeenCalledTimes(1));
      history.destroy();
    });

    test("that fails leaves the editor open, as it was", async () => {
      let answer: ((res: Response) => void) | undefined;
      const sent = stubApi((method) =>
        method === "DELETE"
          ? new Promise<Response>((resolve) => {
              answer = resolve;
            })
          : json({ code: "not_found" }, 404),
      );
      const session = renderEditor(card(true));
      fireEvent.click(resetBox());

      fireEvent.click(screen.getByRole("button", { name: "Delete" }));
      await waitFor(() => expect(sent).toHaveLength(1));
      expect(screen.getByRole("button", { name: "Delete" }).hasAttribute("disabled")).toBe(true);

      answer?.(json({ code: "oops" }, 500));
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Delete" }).hasAttribute("disabled")).toBe(false),
      );
      expect(session.closeGone).not.toHaveBeenCalled();
      expect(resetBox().checked).toBe(true);
      expect(resetBox().disabled).toBe(false);
    });
  });
});
