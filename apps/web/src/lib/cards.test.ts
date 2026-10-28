import { QueryClient } from "@tanstack/react-query";
import { describe, expect, test, vi } from "vitest";
import { createApiClient } from "./api";
import {
  type Card,
  cardCountLabel,
  cardQueryOptions,
  cardsQueryOptions,
  createCard,
  deleteCard,
  duplicatesOf,
  hasUnsavedChanges,
  sideErrors,
  sideProblem,
  updateCard,
} from "./cards";
import { CANT_REACH } from "./decks";

const card = (id: string, front = "f", back = "b"): Card => ({
  id,
  deckId: "d1",
  front,
  back,
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
});

/** A client answering every request with `res()`, recording the URL and body of each. */
const answering = (res: () => Response) => {
  const sent: { url: string; body: unknown }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    sent.push({ url, body });
    return res();
  });
  return { client: createApiClient(fetch), fetch, sent };
};
const unreachable = () =>
  createApiClient(
    vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }),
  );

describe("hasUnsavedChanges", () => {
  const saved = { front: "el desayuno", back: "breakfast" };

  test("is false with nothing changed, or nothing typed on a new card", () => {
    expect(hasUnsavedChanges({ ...saved }, saved)).toBe(false);
    expect(hasUnsavedChanges({ front: "", back: "" }, { front: "", back: "" })).toBe(false);
  });

  test("is true once either side differs, even only by whitespace", () => {
    expect(hasUnsavedChanges({ ...saved, front: "el desayuno " }, saved)).toBe(true);
    expect(hasUnsavedChanges({ ...saved, back: "breakfast\n" }, saved)).toBe(true);
    expect(hasUnsavedChanges({ front: " ", back: "" }, { front: "", back: "" })).toBe(true);
  });

  test("is false again once the text is back to what was saved", () => {
    expect(hasUnsavedChanges({ front: "el desayuno", back: "breakfast" }, saved)).toBe(false);
  });
});

describe("sideProblem and sideErrors", () => {
  test("refuse a blank side or one over 20,000 characters, without trimming", () => {
    expect(sideProblem("", "Front")).toBe("Write the Front.");
    expect(sideProblem(" \n\t", "Back")).toBe("Write the Back.");
    expect(sideProblem("b".repeat(20_001), "Back")).toBe("Keep the Back to 20,000 characters.");
    expect(sideProblem(" ".repeat(19_999) + "x", "Front")).toBeUndefined();
    expect(sideProblem(`${"x".repeat(20_000)} `, "Front")).toBeDefined();
  });

  test("name each side's problem under its own field", () => {
    expect(sideErrors({ front: "", back: "b" })).toEqual({ front: "Write the Front." });
    expect(sideErrors({ front: "", back: "" })).toEqual({
      front: "Write the Front.",
      back: "Write the Back.",
    });
    expect(sideErrors({ front: "f", back: "b" })).toEqual({});
  });
});

describe("createCard", () => {
  test("sends the sides exactly as typed, and answers the new Card", async () => {
    const queryClient = new QueryClient();
    const created = card("c1", " $x^2$\n", "line\n\nline ");
    const { client, sent } = answering(() => Response.json(created, { status: 201 }));

    const outcome = await createCard(
      queryClient,
      "d1",
      { front: " $x^2$\n", back: "line\n\nline " },
      client,
    );

    expect(outcome).toEqual({ ok: true, card: created });
    expect(sent[0]?.body).toEqual({ front: " $x^2$\n", back: "line\n\nline " });
    expect(queryClient.getQueryData(cardQueryOptions("c1").queryKey)).toEqual(created);
  });

  test("sends nothing when a side is blank, naming it", async () => {
    const { client, fetch } = answering(() => Response.json({}, { status: 201 }));

    const outcome = await createCard(new QueryClient(), "d1", { front: "  ", back: "b" }, client);

    expect(outcome).toEqual({ ok: false, errors: { front: "Write the Front." } });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("says when the Deck is gone, or Banki can't be reached", async () => {
    const gone = answering(() =>
      Response.json({ error: { code: "not_found", message: "…" } }, { status: 404 }),
    );

    expect(
      await createCard(new QueryClient(), "d1", { front: "f", back: "b" }, gone.client),
    ).toEqual({ ok: false, notFound: true });
    expect(
      await createCard(new QueryClient(), "d1", { front: "f", back: "b" }, unreachable()),
    ).toEqual({ ok: false, message: CANT_REACH });
  });
});

describe("updateCard", () => {
  test("answers the changed Card and caches it", async () => {
    const queryClient = new QueryClient();
    const changed = card("c1", "new", "new back");
    const { client } = answering(() => Response.json(changed));

    expect(await updateCard(queryClient, "c1", { front: "new", back: "new back" }, client)).toEqual(
      { ok: true, card: changed },
    );
    expect(queryClient.getQueryData(cardQueryOptions("c1").queryKey)).toEqual(changed);
  });
});

describe("deleteCard", () => {
  test("takes the Card out of its Deck's list", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(cardsQueryOptions("d1").queryKey, [card("c2"), card("c1")]);
    const { client } = answering(() => Response.json({ deletionId: "x1" }));

    expect(await deleteCard(queryClient, card("c1"), client)).toEqual({
      ok: true,
      deletionId: "x1",
    });
    expect(queryClient.getQueryData(cardsQueryOptions("d1").queryKey)?.map((c) => c.id)).toEqual([
      "c2",
    ]);
  });

  test("counts a Card that is gone already as deleted", async () => {
    const { client } = answering(() =>
      Response.json({ error: { code: "not_found", message: "…" } }, { status: 404 }),
    );

    expect(await deleteCard(new QueryClient(), card("c1"), client)).toEqual({ ok: true });
  });

  test("answers a message when it can't reach Banki", async () => {
    expect(await deleteCard(new QueryClient(), card("c1"), unreachable())).toEqual({
      ok: false,
      message: CANT_REACH,
    });
  });
});

describe("cardCountLabel", () => {
  test("counts Cards in words", () => {
    expect(cardCountLabel(0)).toBe("No cards");
    expect(cardCountLabel(1)).toBe("1 card");
    expect(cardCountLabel(12)).toBe("12 cards");
  });
});

/** A Card with `front`, created at `createdAt`. */
const at = (id: string, front: string, createdAt: string): Card => ({
  ...card(id, front),
  createdAt,
});

describe("duplicatesOf", () => {
  const older = at("c1", "el desayuno", "2026-10-01T10:00:00.000Z");
  const newest = at("c3", "**El** desayuno", "2026-10-03T10:00:00.000Z");
  const middle = at("c2", "El  Desayuno\n", "2026-10-02T10:00:00.000Z");
  const other = at("c4", "la cena", "2026-10-04T10:00:00.000Z");
  const deck = [other, middle, older, newest];

  test("finds the Cards whose Front reads the same, newest first", () => {
    expect(duplicatesOf("El  Desayuno", deck).map((c) => c.id)).toEqual(["c3", "c2", "c1"]);
  });

  test("finds nothing once the Front no longer matches", () => {
    expect(duplicatesOf("el desayuno grande", deck)).toEqual([]);
    expect(duplicatesOf("el desayun", deck)).toEqual([]);
  });

  test("never matches the Card being edited with itself", () => {
    expect(duplicatesOf("la cena", deck, "c4")).toEqual([]);
    expect(duplicatesOf("el desayuno", deck, "c3").map((c) => c.id)).toEqual(["c2", "c1"]);
  });

  test("never matches with a Front whose key is empty, even against another such Front", () => {
    expect(duplicatesOf("**", [at("c5", "_", "2026-10-05T10:00:00.000Z")])).toEqual([]);
    expect(duplicatesOf("   ", deck)).toEqual([]);
  });

  test("never matches a deleted Card: deleting takes it out of the Deck's list", async () => {
    const queryClient = new QueryClient();
    const listKey = cardsQueryOptions("d1").queryKey;
    queryClient.setQueryData(listKey, [newest, older]);
    const { client } = answering(() => new Response(null, { status: 204 }));
    vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
    await deleteCard(queryClient, newest, client);
    const live = queryClient.getQueryData(listKey) ?? [];
    expect(duplicatesOf("el desayuno", live).map((c) => c.id)).toEqual(["c1"]);
  });
});
