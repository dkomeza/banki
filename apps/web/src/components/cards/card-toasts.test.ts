import { QueryClient } from "@tanstack/react-query";
import { describe, expect, test, vi } from "vitest";
import { cardQueryOptions, cardsQueryOptions } from "@/lib/cards";
import { deleteWithUndo } from "./card-toasts";

const toasts = vi.hoisted(() => ({ shown: [] as string[], errors: [] as string[] }));
vi.mock("sonner", () => ({
  toast: Object.assign((title: string) => toasts.shown.push(title), {
    error: (message: string) => toasts.errors.push(message),
  }),
}));

const CARD = {
  id: "c1",
  deckId: "d1",
  front: "f",
  back: "b",
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
};

describe("deleteWithUndo", () => {
  test("leaves, then shows Card deleted, once the Card is deleted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
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
