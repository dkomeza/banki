import { QueryClient } from "@tanstack/react-query";
import { describe, expect, test, vi } from "vitest";
import { createApiClient } from "./api";
import {
  type Deck,
  NAME_TAKEN,
  createDeck,
  createdLabel,
  deckDescriptionProblem,
  deckNameProblem,
  deckQueryOptions,
  decksQueryOptions,
  deleteDeck,
  sortItems,
  updateDeck,
} from "./decks";

const deck = (name: string, createdAt: string, id = name): Deck => ({
  id,
  name,
  description: null,
  folderId: null,
  createdAt,
  cardCount: 0,
  desiredRetention: null,
});

const DECKS = [
  deck("calculus 10", "2026-10-23T10:00:00.000Z"),
  deck("Spanish vocabulary", "2026-09-14T10:00:00.000Z"),
  deck("Calculus 2", "2026-09-25T10:00:00.000Z"),
  deck("Japanese kanji", "2026-10-05T10:00:00.000Z"),
  deck("Organic chemistry", "2026-10-13T10:00:00.000Z"),
];

describe("sortItems", () => {
  test("Alphabetical ignores case and puts numbers in natural order", () => {
    expect(sortItems(DECKS, "alphabetical").map((d) => d.name)).toEqual([
      "Calculus 2",
      "calculus 10",
      "Japanese kanji",
      "Organic chemistry",
      "Spanish vocabulary",
    ]);
  });

  test("Newest is by creation time, newest first", () => {
    expect(sortItems(DECKS, "newest").map((d) => d.name)).toEqual([
      "calculus 10",
      "Organic chemistry",
      "Japanese kanji",
      "Calculus 2",
      "Spanish vocabulary",
    ]);
  });

  test("keeps a set order for ties", () => {
    const tied = [deck("B", "2026-10-01T00:00:00.000Z"), deck("A", "2026-10-01T00:00:00.000Z")];

    expect(sortItems(tied, "newest").map((d) => d.name)).toEqual(["A", "B"]);
    expect(
      sortItems(
        [deck("a", "2026-10-01T00:00:00.000Z", "2"), deck("A", "2026-10-01T00:00:00.000Z", "1")],
        "alphabetical",
      ).map((d) => d.id),
    ).toEqual(["1", "2"]);
  });

  test("leaves the list it was given alone", () => {
    const list = [...DECKS];

    sortItems(list, "alphabetical");

    expect(list).toEqual(DECKS);
  });
});

describe("createdLabel", () => {
  const now = new Date("2026-10-25T12:00:00Z");

  test("leaves the year out this year", () => {
    expect(createdLabel("2026-09-14T10:00:00.000Z", now)).toMatch(/^14 Sept?$/);
  });

  test("names the year before this one", () => {
    expect(createdLabel("2025-09-14T10:00:00.000Z", now)).toMatch(/^14 Sept? 2025$/);
  });
});

describe("deckNameProblem", () => {
  test("refuses a blank name or one over 100 characters, after trimming", () => {
    expect(deckNameProblem("  ")).toBe("Give the deck a name.");
    expect(deckNameProblem("a".repeat(101))).toBe("Keep the name to 100 characters.");
    expect(deckNameProblem(` ${"a".repeat(100)} `)).toBeUndefined();
  });
});

describe("deckDescriptionProblem", () => {
  test("refuses a description over 1,000 characters, after trimming", () => {
    expect(deckDescriptionProblem("d".repeat(1001))).toBe(
      "Keep the description to 1,000 characters.",
    );
    expect(deckDescriptionProblem(` ${"d".repeat(1000)}\n`)).toBeUndefined();
  });
});

const answering = (res: () => Response) => createApiClient(vi.fn(async () => res()));
const refusal = (status: number, code: string) => () =>
  Response.json({ error: { code, message: "…" } }, { status });
const SPANISH = deck("Spanish", "2026-09-14T10:00:00.000Z", "d1");

describe("createDeck", () => {
  test("answers the new Deck and caches it", async () => {
    const queryClient = new QueryClient();

    const outcome = await createDeck(
      queryClient,
      { name: "Spanish", description: null, folderId: null },
      answering(() => Response.json(SPANISH, { status: 201 })),
    );

    expect(outcome).toEqual({ ok: true, deck: SPANISH });
    expect(queryClient.getQueryData(deckQueryOptions("d1").queryKey)).toEqual(SPANISH);
  });

  test("puts a taken name under the name field", async () => {
    await expect(
      createDeck(
        new QueryClient(),
        { name: "x", description: null, folderId: null },
        answering(refusal(409, "deck_name_taken")),
      ),
    ).resolves.toEqual({ ok: false, field: "name", message: NAME_TAKEN });
  });

  test("says so when Banki can't be reached", async () => {
    const client = createApiClient(vi.fn(async () => Promise.reject(new TypeError("offline"))));

    await expect(
      createDeck(new QueryClient(), { name: "x", description: null, folderId: null }, client),
    ).resolves.toMatchObject({
      ok: false,
      field: "form",
      message: "Can't reach Banki. Check your connection and try again.",
    });
  });

  test("says so for any other failure", async () => {
    await expect(
      createDeck(
        new QueryClient(),
        { name: "x", description: null, folderId: null },
        answering(refusal(500, "internal_error")),
      ),
    ).resolves.toEqual({
      ok: false,
      field: "form",
      message: "Banki couldn't create the deck. Try again.",
    });
  });
});

describe("updateDeck", () => {
  test("answers the changed Deck and caches it", async () => {
    const queryClient = new QueryClient();
    const renamed = { ...SPANISH, name: "Español" };

    const outcome = await updateDeck(
      queryClient,
      "d1",
      { name: "Español" },
      answering(() => Response.json(renamed)),
    );

    expect(outcome).toEqual({ ok: true, deck: renamed });
    expect(queryClient.getQueryData(deckQueryOptions("d1").queryKey)).toEqual(renamed);
  });

  test("puts a taken name under the name field", async () => {
    await expect(
      updateDeck(
        new QueryClient(),
        "d1",
        { name: "x" },
        answering(refusal(409, "deck_name_taken")),
      ),
    ).resolves.toEqual({ ok: false, field: "name", message: NAME_TAKEN });
  });
});

describe("deleteDeck", () => {
  test("drops the Deck from the list", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(decksQueryOptions().queryKey, [SPANISH]);
    queryClient.setQueryData(deckQueryOptions("d1").queryKey, SPANISH);

    const outcome = await deleteDeck(
      queryClient,
      "d1",
      answering(() => Response.json({ deletionId: "x1" })),
    );

    expect(outcome).toEqual({ ok: true, deletionId: "x1" });
    expect(queryClient.getQueryData(decksQueryOptions().queryKey)).toEqual([]);
  });

  test("counts a Deck that is gone already as deleted", async () => {
    await expect(
      deleteDeck(new QueryClient(), "d1", answering(refusal(404, "not_found"))),
    ).resolves.toEqual({ ok: true });
  });

  test("says so when it couldn't delete", async () => {
    await expect(
      deleteDeck(new QueryClient(), "d1", answering(refusal(500, "internal_error"))),
    ).resolves.toEqual({ ok: false, message: "Banki couldn't delete the deck. Try again." });
  });
});

describe("deckQueryOptions", () => {
  test("reads an unknown or deleted Deck as null", async () => {
    const queryClient = new QueryClient();

    await expect(
      queryClient.fetchQuery(deckQueryOptions("nope", answering(refusal(404, "not_found")))),
    ).resolves.toBeNull();
  });
});
