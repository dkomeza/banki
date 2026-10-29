import { QueryClient } from "@tanstack/react-query";
import { describe, expect, test, vi } from "vitest";
import { createApiClient } from "./api";
import { type Deck, sortItems } from "./decks";
import {
  type Folder,
  type Library,
  FOLDER_NAME_TAKEN,
  cantMoveTo,
  contentsOf,
  countInside,
  countLabel,
  createFolder,
  deckRows,
  folderNameProblem,
  foldersInside,
  keepBothName,
  moveItem,
  pathTo,
  treeRows,
} from "./folders";

const folder = (
  id: string,
  name: string,
  parentId: string | null,
  createdAt = "2026-10-01T00:00:00.000Z",
): Folder => ({
  id,
  name,
  parentId,
  createdAt,
});

const deck = (id: string, name: string, folderId: string | null): Deck => ({
  id,
  name,
  description: null,
  folderId,
  createdAt: "2026-10-01T00:00:00.000Z",
  cardCount: 0,
  desiredRetention: null,
});

// Languages and Maths › Analysis › Real, Archive empty, Organic at the Root.
const LIBRARY: Library = {
  folders: [
    folder("lang", "Languages", null, "2026-09-01T00:00:00.000Z"),
    folder("maths", "Maths", null, "2026-09-10T00:00:00.000Z"),
    folder("analysis", "Analysis", "maths"),
    folder("real", "Real analysis", "analysis"),
    folder("archive", "Archive", null, "2026-10-20T00:00:00.000Z"),
  ],
  decks: [
    deck("spanish", "Spanish", "lang"),
    deck("kanji", "Kanji", "lang"),
    deck("calc2", "Calculus 2", "analysis"),
    deck("calc10", "Calculus 10", "real"),
    deck("organic", "Organic", null),
  ],
};

describe("contentsOf", () => {
  test("is a place's own Folders and Decks, not those deeper down", () => {
    const root = contentsOf(LIBRARY, null);
    expect(root.folders.map((f) => f.name)).toEqual(["Languages", "Maths", "Archive"]);
    expect(root.decks.map((d) => d.name)).toEqual(["Organic"]);
    expect(contentsOf(LIBRARY, "maths").decks).toEqual([]);
  });

  test("sorts Folders as Decks are sorted, by name or newest first", () => {
    const { folders } = contentsOf(LIBRARY, null);
    expect(sortItems(folders, "alphabetical").map((f) => f.name)).toEqual([
      "Archive",
      "Languages",
      "Maths",
    ]);
    expect(sortItems(folders, "newest").map((f) => f.name)).toEqual([
      "Archive",
      "Maths",
      "Languages",
    ]);
  });
});

describe("pathTo", () => {
  test("is the Folders from the Root down to the place", () => {
    expect(pathTo(LIBRARY.folders, "real").map((f) => f.name)).toEqual([
      "Maths",
      "Analysis",
      "Real analysis",
    ]);
    expect(pathTo(LIBRARY.folders, null)).toEqual([]);
    expect(pathTo(LIBRARY.folders, "gone")).toEqual([]);
  });
});

describe("foldersInside and countInside", () => {
  test("reach every depth", () => {
    expect([...foldersInside(LIBRARY.folders, "maths")].toSorted()).toEqual(["analysis", "real"]);
    expect(countInside(LIBRARY, "maths")).toEqual({ folders: 2, decks: 2 });
    expect(countInside(LIBRARY, "archive")).toEqual({ folders: 0, decks: 0 });
  });
});

describe("countLabel", () => {
  test("names what is inside, in words", () => {
    expect(countLabel({ decks: 2, folders: 1 })).toBe("2 decks and 1 folder");
    expect(countLabel({ decks: 1, folders: 0 })).toBe("1 deck");
    expect(countLabel({ decks: 0, folders: 3 })).toBe("3 folders");
    expect(countLabel({ decks: 0, folders: 0 })).toBe("");
  });
});

describe("deckRows", () => {
  test("lists every Deck under its Folders, the Root's first, each level A–Z, empty Folders left out", () => {
    expect(
      deckRows(LIBRARY).map(
        (r) => `${"-".repeat(r.depth)}${r.kind === "deck" ? r.deck.name : `[${r.name}]`}`,
      ),
    ).toEqual([
      "Organic",
      "[Languages]",
      "-Kanji",
      "-Spanish",
      "[Maths]",
      "-[Analysis]",
      "--Calculus 2",
      "--[Real analysis]",
      "---Calculus 10",
    ]);
  });
});

describe("treeRows", () => {
  test("is the whole tree with Decks on top, each level A–Z, indented by depth", () => {
    expect(treeRows(LIBRARY.folders).map((r) => `${"-".repeat(r.depth)}${r.name}`)).toEqual([
      "Decks",
      "-Archive",
      "-Languages",
      "-Maths",
      "--Analysis",
      "---Real analysis",
    ]);
  });
});

describe("cantMoveTo", () => {
  test("refuses the current place, the Folder itself and anything inside it", () => {
    const maths = { kind: "folder", id: "maths" } as const;
    expect(cantMoveTo(LIBRARY, maths, null)).toBe("current");
    expect(cantMoveTo(LIBRARY, maths, "maths")).toBe("self");
    expect(cantMoveTo(LIBRARY, maths, "real")).toBe("inside");
    expect(cantMoveTo(LIBRARY, maths, "archive")).toBeUndefined();
  });

  test("lets a Deck go anywhere but where it is", () => {
    const spanish = { kind: "deck", id: "spanish" } as const;
    expect(cantMoveTo(LIBRARY, spanish, "lang")).toBe("current");
    expect(cantMoveTo(LIBRARY, spanish, null)).toBeUndefined();
    expect(cantMoveTo(LIBRARY, spanish, "real")).toBeUndefined();
  });
});

describe("keepBothName", () => {
  test("takes the next free Name (n) among things of its kind beside it, ignoring case", () => {
    const library: Library = {
      folders: [folder("a", "Cells", "x"), folder("b", "cells (2)", "x")],
      decks: [deck("d", "Cells (3)", "x")],
    };

    expect(keepBothName(library, "folder", "x", "Cells")).toBe("Cells (3)");
    expect(keepBothName(library, "deck", "x", "Cells")).toBe("Cells (2)");
  });

  test("stays within 100 characters", () => {
    expect(keepBothName(LIBRARY, "deck", null, "a".repeat(100))).toBe(`${"a".repeat(96)} (2)`);
  });
});

describe("folderNameProblem", () => {
  test("refuses a blank name or one over 100 characters, after trimming", () => {
    expect(folderNameProblem(" ")).toBe("Give the folder a name.");
    expect(folderNameProblem("a".repeat(101))).toBe("Keep the name to 100 characters.");
    expect(folderNameProblem(` ${"a".repeat(100)} `)).toBeUndefined();
  });
});

const answering = (res: () => Response) => createApiClient(vi.fn(async () => res()));

describe("createFolder", () => {
  test("puts a taken name under the name field", async () => {
    const outcome = await createFolder(
      new QueryClient(),
      { name: "Maths", parentId: null },
      answering(() =>
        Response.json({ error: { code: "folder_name_taken", message: "…" } }, { status: 409 }),
      ),
    );

    expect(outcome).toEqual({ ok: false, field: "name", message: FOLDER_NAME_TAKEN });
  });
});

describe("moveItem", () => {
  test("answers the clash for the popup", async () => {
    const clash = { id: "x", name: "Analysis", replaceAllowed: false };

    const outcome = await moveItem(
      new QueryClient(),
      { kind: "folder", id: "f" },
      null,
      undefined,
      answering(() =>
        Response.json({ error: { code: "name_clash", message: "…" }, clash }, { status: 409 }),
      ),
    );

    expect(outcome).toEqual({ ok: false, clash });
  });

  test("sends the User's choice, and has the lists fetched again on success", async () => {
    let sent: { url: string; body: unknown } | undefined;
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
      const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      sent = { url, body };
      return Response.json(deck("spanish", "Spanish", null));
    });
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    const outcome = await moveItem(
      queryClient,
      { kind: "deck", id: "spanish" },
      null,
      "keepBoth",
      createApiClient(fetch),
    );

    expect(outcome).toEqual({ ok: true });
    expect(sent?.url).toContain("/api/decks/spanish");
    expect(sent?.body).toEqual({ folderId: null, onClash: "keepBoth" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["folders"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["decks"] });
  });

  test("says so when Banki can't be reached", async () => {
    const client = createApiClient(vi.fn(async () => Promise.reject(new TypeError("offline"))));

    await expect(
      moveItem(new QueryClient(), { kind: "deck", id: "d" }, null, undefined, client),
    ).resolves.toMatchObject({ ok: false, message: expect.stringContaining("Can't reach") });
  });
});
