import { QueryClient } from "@tanstack/react-query";
import { describe, expect, test, vi } from "vitest";
import { cardQueryOptions, cardsQueryOptions } from "@/lib/cards";
import { deleteAllWithUndo, deleteWithUndo, showMovedToast } from "./card-toasts";

type Options = { id?: string; action?: { label: string; onClick: () => void } };
const toasts = vi.hoisted(() => ({
  shown: [] as string[],
  options: [] as Options[],
  errors: [] as string[],
}));
vi.mock("sonner", () => ({
  toast: Object.assign(
    (title: unknown, options: Options = {}) => {
      toasts.shown.push(typeof title === "string" ? title : (options.id ?? ""));
      toasts.options.push(options);
    },
    {
      error: (message: string) => toasts.errors.push(message),
      dismiss: () => {},
    },
  ),
}));

const CARD = {
  id: "c1",
  deckId: "d1",
  front: "f",
  back: "b",
  tags: [],
  gradingNotes: null,
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
};

describe("deleteWithUndo", () => {
  test("leaves, then shows Card deleted, once the Card is deleted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ deletionId: "x1" })),
    );
    const queryClient = new QueryClient();
    queryClient.setQueryData(cardQueryOptions("c1").queryKey, CARD);
    const leave = vi.fn(async () => {
      // The edit page is still showing its Card while it leaves.
      expect(queryClient.getQueryData(cardQueryOptions("c1").queryKey)).toEqual(CARD);
    });

    await deleteWithUndo(queryClient, CARD, leave);

    expect(leave).toHaveBeenCalledOnce();
    expect(toasts.shown).toContain("Card deleted");
    expect(queryClient.getQueryData(cardQueryOptions("c1").queryKey)).toBeUndefined();
  });

  test("stays, with an error toast and the Card back in its list, when the delete fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const queryClient = new QueryClient();
    queryClient.setQueryData(cardsQueryOptions("d1").queryKey, [CARD]);
    const leave = vi.fn(async () => {});

    await deleteWithUndo(queryClient, CARD, leave);

    expect(leave).not.toHaveBeenCalled();
    expect(toasts.errors).toHaveLength(1);
  });
});

const urlOf = (input: RequestInfo | URL) =>
  input instanceof Request ? input.url : input.toString();

describe("Undo", () => {
  test("restores the Card's Deletion", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) =>
      urlOf(input).includes("/restore")
        ? Response.json({ kind: "card", id: "c1", name: "f", movedToRoot: false, renamed: false })
        : Response.json({ deletionId: "x1" }),
    );
    vi.stubGlobal("fetch", fetch);

    await deleteWithUndo(new QueryClient(), CARD);
    toasts.options.at(-1)?.action?.onClick();

    await vi.waitFor(() =>
      expect(fetch.mock.calls.map(([input]) => urlOf(input))).toContainEqual(
        expect.stringContaining("/api/deletions/x1/restore"),
      ),
    );
  });
});

const card = (id: string) => ({ ...CARD, id });

describe("deleteAllWithUndo", () => {
  test("deletes the Cards in one request, shows N cards deleted, and Undo restores them all", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) =>
      urlOf(input).includes("/api/deletions/restore")
        ? Response.json({ restored: [] })
        : Response.json({
            deletions: [
              { cardId: "c1", deletionId: "x1" },
              { cardId: "c2", deletionId: "x2" },
              { cardId: "c3", deletionId: "x3" },
            ],
          }),
    );
    vi.stubGlobal("fetch", fetch);

    expect(
      await deleteAllWithUndo(new QueryClient(), "d1", [card("c1"), card("c2"), card("c3")]),
    ).toBe(true);
    expect(toasts.shown.at(-1)).toBe("3 cards deleted");
    toasts.options.at(-1)?.action?.onClick();
    await vi.waitFor(() =>
      expect(fetch.mock.calls.map(([input]) => urlOf(input))).toContainEqual(
        expect.stringContaining("/api/deletions/restore"),
      ),
    );
  });

  test("answers false, with an error toast, when the delete fails, so the selection stays", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: { code: "not_found", message: "…" } }, { status: 404 }),
      ),
    );

    expect(await deleteAllWithUndo(new QueryClient(), "d1", [card("c1"), card("c2")])).toBe(false);
    expect(toasts.errors.at(-1)).toBe(
      "Some of these cards are gone already, so nothing was deleted.",
    );
  });

  test("keeps Card deleted for one Card alone", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ deletionId: "x1" })),
    );

    await deleteAllWithUndo(new QueryClient(), "d1", [card("c1")]);

    expect(toasts.shown.at(-1)).toBe("Card deleted");
  });

  test("says why Undo couldn't restore them when their Deck is deleted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        urlOf(input).includes("/api/deletions/restore")
          ? Response.json(
              {
                error: { code: "place_deleted", message: "Restore Spanish first" },
                deck: { id: "d1", name: "Spanish" },
              },
              { status: 409 },
            )
          : Response.json({
              deletions: [
                { cardId: "c1", deletionId: "x1" },
                { cardId: "c2", deletionId: "x2" },
              ],
            }),
      ),
    );

    await deleteAllWithUndo(new QueryClient(), "d1", [card("c1"), card("c2")]);
    toasts.options.at(-1)?.action?.onClick();

    await vi.waitFor(() =>
      expect(toasts.errors).toContain("Couldn't undo: the cards' deck was deleted."),
    );
  });
});

describe("showMovedToast", () => {
  const from = { id: "d1", name: "Spanish" };
  const to = { id: "d2", name: "Verbs" };

  test("Undo moves the Cards back to their Deck in one request", async () => {
    const sent: { url: string; body: unknown }[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push({
        url: urlOf(input),
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      });
      return Response.json({ cards: [] });
    });
    vi.stubGlobal("fetch", fetch);

    showMovedToast(new QueryClient(), ["c1", "c2"], from, to);
    toasts.options.at(-1)?.action?.onClick();

    await vi.waitFor(() =>
      expect(sent).toEqual([
        {
          url: expect.stringContaining("/api/cards/move"),
          body: { cardIds: ["c1", "c2"], deckId: "d1" },
        },
      ]),
    );
  });

  test("says why Undo couldn't move them back when the Deck or a Card is gone", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: { code: "not_found", message: "…" } }, { status: 404 }),
      ),
    );

    showMovedToast(new QueryClient(), ["c1"], from, to);
    toasts.options.at(-1)?.action?.onClick();

    await vi.waitFor(() =>
      expect(toasts.errors).toContain("Couldn't undo: Spanish or one of the cards was deleted."),
    );
  });
});
