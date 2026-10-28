import { QueryClient } from "@tanstack/react-query";
import { describe, expect, test, vi } from "vitest";
import { cardQueryOptions, cardsQueryOptions } from "@/lib/cards";
import { deleteWithUndo } from "./card-toasts";

type Options = { action?: { label: string; onClick: () => void } };
const toasts = vi.hoisted(() => ({
  shown: [] as string[],
  options: [] as Options[],
  errors: [] as string[],
}));
vi.mock("sonner", () => ({
  toast: Object.assign(
    (title: string, options: Options = {}) => {
      toasts.shown.push(title);
      toasts.options.push(options);
    },
    {
      error: (message: string) => toasts.errors.push(message),
    },
  ),
}));

const CARD = {
  id: "c1",
  deckId: "d1",
  front: "f",
  back: "b",
  tags: [],
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
