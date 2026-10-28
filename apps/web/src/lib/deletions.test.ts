import { QueryClient } from "@tanstack/react-query";
import { describe, expect, test, vi } from "vitest";
import { createApiClient } from "./api";
import {
  type Deletion,
  agoLabel,
  countsLabel,
  daysLeft,
  daysLeftLabel,
  deleteQuestion,
  deletionsQueryOptions,
  firstLine,
  groupOf,
  nameOf,
  removeDeletion,
  restoreDeletion,
  restoreDeletions,
  restoredToast,
  whereLabel,
  withLabel,
} from "./deletions";

const NOW = new Date("2026-10-26T12:00:00.000Z");

const deletion = (overrides: Partial<Deletion> = {}): Deletion => ({
  id: "x1",
  deletedAt: "2026-10-26T09:00:00.000Z",
  removesAt: "2026-11-25T09:00:00.000Z",
  top: { kind: "folder", id: "f1", name: "Maths" },
  path: [],
  deck: null,
  counts: { folders: 1, decks: 2, cards: 30 },
  ...overrides,
});

/** A client answering every request with `res()`, recording each URL. */
const answering = (res: () => Response) => {
  const sent: string[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    sent.push(input instanceof Request ? input.url : input.toString());
    return res();
  });
  return { client: createApiClient(fetch), sent };
};

describe("daysLeft", () => {
  test("rounds up to whole days until Removal", () => {
    expect(daysLeft("2026-11-25T09:00:00.000Z", NOW)).toBe(30);
    expect(daysLeft("2026-11-24T12:00:00.000Z", NOW)).toBe(29);
    expect(daysLeft("2026-10-27T10:00:00.000Z", NOW)).toBe(1);
    expect(daysLeft("2026-10-26T12:00:00.001Z", NOW)).toBe(1);
  });

  test("never goes below 0, for a Removal the sweep hasn't reached yet", () => {
    expect(daysLeft("2026-10-26T12:00:00.000Z", NOW)).toBe(0);
    expect(daysLeft("2026-10-20T00:00:00.000Z", NOW)).toBe(0);
  });

  test("says it in words", () => {
    expect(daysLeftLabel(29)).toBe("29 days left");
    expect(daysLeftLabel(1)).toBe("1 day left");
    expect(daysLeftLabel(0)).toBe("0 days left");
  });
});

describe("what went with it", () => {
  test("names the decks, folders and cards, leaving out what there's none of", () => {
    expect(countsLabel({ folders: 1, decks: 2, cards: 30 })).toBe("2 decks, 1 folder and 30 cards");
    expect(countsLabel({ folders: 0, decks: 1, cards: 9 })).toBe("1 deck and 9 cards");
    expect(countsLabel({ folders: 0, decks: 0, cards: 12 })).toBe("12 cards");
    expect(countsLabel({ folders: 0, decks: 0, cards: 1 })).toBe("1 card");
    expect(countsLabel({ folders: 0, decks: 0, cards: 0 })).toBe("");
  });

  test("says 'with …', or nothing for a Card or an empty Deck or Folder", () => {
    expect(withLabel(deletion())).toBe("with 2 decks, 1 folder and 30 cards");
    expect(withLabel(deletion({ counts: { folders: 0, decks: 0, cards: 12 } }))).toBe(
      "with 12 cards",
    );
    expect(withLabel(deletion({ counts: { folders: 0, decks: 0, cards: 0 } }))).toBe("");
  });

  test("asks before Delete permanently, naming what goes", () => {
    expect(deleteQuestion(deletion())).toBe(
      "Delete Maths and the 2 decks, 1 folder and 30 cards in it permanently? This can't be undone.",
    );
    expect(
      deleteQuestion(
        deletion({
          top: { kind: "deck", id: "d1", name: "Calculus 1" },
          counts: { folders: 0, decks: 0, cards: 0 },
        }),
      ),
    ).toBe("Delete Calculus 1 permanently? This can't be undone.");
    expect(
      deleteQuestion(
        deletion({
          top: { kind: "card", id: "c1", name: "der Termin\nthe appointment" },
          counts: { folders: 0, decks: 0, cards: 0 },
        }),
      ),
    ).toBe("Delete the card “der Termin” permanently? This can't be undone.");
  });
});

/** 10:00 on `day` October 2026, in this device's timezone. */
const local = (day: number) => new Date(2026, 9, day, 10).toISOString();

describe("names and places", () => {
  test("names a Card by its Front's first line with something on it", () => {
    expect(firstLine("\n  la madrugada \nthe small hours")).toBe("la madrugada");
    expect(nameOf(deletion({ top: { kind: "card", id: "c1", name: "$x$\n\ny" } }))).toBe("$x$");
    expect(nameOf(deletion())).toBe("Maths");
  });

  test("says where it was: the Folder path from Decks, or a Card's Deck", () => {
    expect(whereLabel(deletion({ path: [] }))).toBe("Decks");
    expect(whereLabel(deletion({ path: ["Maths", "Analysis"] }))).toBe("Decks › Maths › Analysis");
    expect(whereLabel(deletion({ path: null, deck: { id: "d1", name: "Spanish" } }))).toBe(
      "Spanish",
    );
  });

  test("says how long ago, and groups by day", () => {
    expect(agoLabel("2026-10-26T11:30:00.000Z", NOW)).toBe("just now");
    expect(agoLabel("2026-10-26T09:00:00.000Z", NOW)).toBe("3 hours ago");
    expect(agoLabel("2026-10-25T10:00:00.000Z", NOW)).toBe("yesterday");
    expect(agoLabel("2026-10-22T09:00:00.000Z", NOW)).toBe("4 days ago");
    const today = new Date(2026, 9, 26, 13);
    expect(groupOf(local(26), today)).toBe("Today");
    expect(groupOf(local(25), today)).toBe("Yesterday");
    expect(groupOf(local(20), today)).toBe("This week");
    expect(groupOf(local(19), today)).toBe("Earlier");
  });

  test("counts days past the first by the calendar, so the label agrees with the group", () => {
    // Deleted on the 24th at 18:00, read on the 26th at 10:00: 40 hours, two days ago.
    const deletedAt = new Date(2026, 9, 24, 18).toISOString();
    const now = new Date(2026, 9, 26, 10);
    expect(agoLabel(deletedAt, now)).toBe("2 days ago");
    expect(groupOf(deletedAt, now)).toBe("This week");
  });
});

describe("restoredToast", () => {
  const restored = {
    kind: "deck" as const,
    id: "d1",
    name: "Statistics",
    movedToRoot: false,
    renamed: false,
  };

  test("says it's back where it was", () => {
    expect(restoredToast(restored, "Statistics", "Decks › Maths")).toEqual({
      title: "Statistics restored",
      description: "Back in Decks › Maths.",
    });
    expect(
      restoredToast({ ...restored, kind: "card", name: "la madrugada" }, "la madrugada", "Spanish")
        .title,
    ).toBe("Card restored");
  });

  test("says when it went to the Root, or came back under a new name", () => {
    expect(
      restoredToast(
        { ...restored, name: "Calculus 2", movedToRoot: true },
        "Calculus 2",
        "Decks › Maths",
      ).title,
    ).toBe("Calculus 2 restored to Decks");
    expect(
      restoredToast(
        { ...restored, name: "Spanish vocabulary (2)", renamed: true },
        "Spanish vocabulary",
        "Decks › Languages",
      ),
    ).toEqual({
      title: "Restored as Spanish vocabulary (2)",
      description: "Decks › Languages already has a deck called Spanish vocabulary.",
    });
  });
});

describe("restoreDeletions", () => {
  test("restores them all in one request, and has the lists fetched again", async () => {
    const restored = [
      { kind: "card", id: "c1", name: "f", movedToRoot: false, renamed: false },
      { kind: "card", id: "c2", name: "g", movedToRoot: false, renamed: false },
    ];
    const { client, sent } = answering(() => Response.json({ restored }));
    const queryClient = new QueryClient();
    queryClient.setQueryData(deletionsQueryOptions().queryKey, [deletion()]);

    expect(await restoreDeletions(queryClient, ["x1", "x2"], client)).toEqual({
      ok: true,
      restored,
    });
    expect(sent).toEqual([expect.stringContaining("/api/deletions/restore")]);
    expect(queryClient.getQueryState(deletionsQueryOptions().queryKey)?.isInvalidated).toBe(true);
  });

  test("names the Deck to restore first on 409 place_deleted", async () => {
    const { client } = answering(() =>
      Response.json(
        {
          error: { code: "place_deleted", message: "Restore German verbs first" },
          deck: { id: "d9", name: "German verbs" },
        },
        { status: 409 },
      ),
    );

    expect(await restoreDeletions(new QueryClient(), ["x1"], client)).toEqual({
      ok: false,
      placeDeleted: { id: "d9", name: "German verbs" },
    });
  });

  test("says so when one is gone", async () => {
    const { client } = answering(() =>
      Response.json({ error: { code: "not_found", message: "…" } }, { status: 404 }),
    );

    expect(await restoreDeletions(new QueryClient(), ["x1"], client)).toEqual({
      ok: false,
      message: "Some of them are no longer in Recently deleted.",
    });
  });
});

describe("restoreDeletion", () => {
  test("answers what came back, and has the lists fetched again", async () => {
    const restored = { kind: "deck", id: "d1", name: "A (2)", movedToRoot: true, renamed: true };
    const { client, sent } = answering(() => Response.json(restored));
    const queryClient = new QueryClient();
    queryClient.setQueryData(deletionsQueryOptions().queryKey, [deletion()]);

    expect(await restoreDeletion(queryClient, "x1", client)).toEqual({ ok: true, restored });
    expect(sent[0]).toContain("/api/deletions/x1/restore");
    expect(queryClient.getQueryState(deletionsQueryOptions().queryKey)?.isInvalidated).toBe(true);
  });

  test("names the Deck to restore first on 409 place_deleted", async () => {
    const { client } = answering(() =>
      Response.json(
        {
          error: { code: "place_deleted", message: "Restore German verbs first" },
          deck: { id: "d9", name: "German verbs" },
        },
        { status: 409 },
      ),
    );

    expect(await restoreDeletion(new QueryClient(), "x1", client)).toEqual({
      ok: false,
      placeDeleted: { id: "d9", name: "German verbs" },
    });
  });

  test("says so when it's gone, or Banki can't be reached", async () => {
    const { client } = answering(() =>
      Response.json({ error: { code: "not_found", message: "…" } }, { status: 404 }),
    );
    expect(await restoreDeletion(new QueryClient(), "x1", client)).toEqual({
      ok: false,
      message: "It's no longer in Recently deleted.",
    });
  });
});

describe("removeDeletion", () => {
  test("takes it out of Recently deleted, counting one that's gone already as removed", async () => {
    for (const res of [
      () => new Response(null, { status: 204 }),
      () => Response.json({ error: { code: "not_found", message: "…" } }, { status: 404 }),
    ]) {
      const queryClient = new QueryClient();
      queryClient.setQueryData(deletionsQueryOptions().queryKey, [
        deletion(),
        deletion({ id: "x2" }),
      ]);

      expect(await removeDeletion(queryClient, "x1", answering(res).client)).toEqual({ ok: true });
      expect(queryClient.getQueryData(deletionsQueryOptions().queryKey)?.map((d) => d.id)).toEqual([
        "x2",
      ]);
    }
  });

  test("says so when it couldn't", async () => {
    const { client } = answering(() =>
      Response.json({ error: { code: "internal_error", message: "…" } }, { status: 500 }),
    );
    expect(await removeDeletion(new QueryClient(), "x1", client)).toEqual({
      ok: false,
      message: "Banki couldn't delete it permanently. Try again.",
    });
  });
});
