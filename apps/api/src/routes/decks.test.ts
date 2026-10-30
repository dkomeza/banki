import { describe, expect, test } from "bun:test";
import {
  ApiError,
  DeckListResponse,
  DeckResponse,
  DeleteResponse,
  FolderResponse,
  NameClashError,
} from "@banki/shared";
import { type App, bootApps, codeOf, get, send, setUp } from "../testing/app";

const { boot } = bootApps();

/** A fresh app that Setup is done on, and the signed-in cookie Setup set. */
async function signedIn() {
  const booted = boot();
  const cookie = await setUp(booted);
  return { app: booted.app, cookie };
}

async function createDeck(app: App, cookie: string, body: unknown) {
  const res = await send(app, "POST", "/api/decks", body, cookie);
  if (res.status !== 201) throw new Error(`Create answered ${res.status}`);
  return DeckResponse.parse(await res.json());
}

const namesOf = async (app: App, cookie: string) =>
  DeckListResponse.parse(await (await get(app, "/api/decks", cookie)).json()).map((d) => d.name);

describe("POST /api/decks", () => {
  test("creates a Deck, trimmed, and answers it with 201", async () => {
    const { app, cookie } = await signedIn();

    const res = await send(
      app,
      "POST",
      "/api/decks",
      { name: "  Spanish ", description: " Line one\nLine two  " },
      cookie,
    );

    expect(res.status).toBe(201);
    const created = DeckResponse.parse(await res.json());
    expect(created).toMatchObject({ name: "Spanish", description: "Line one\nLine two" });
    expect(
      DeckResponse.parse(await (await get(app, `/api/decks/${created.id}`, cookie)).json()),
    ).toEqual(created);
  });

  test("takes a Deck without a description", async () => {
    const { app, cookie } = await signedIn();

    expect(await createDeck(app, cookie, { name: "Spanish", description: "" })).toMatchObject({
      description: null,
    });
  });

  test("answers 400 invalid_request for a blank or too long name, or a too long description", async () => {
    const { app, cookie } = await signedIn();

    for (const body of [
      { name: "  " },
      { name: "a".repeat(101) },
      { name: "a", description: "d".repeat(1001) },
      { description: "no name" },
    ]) {
      const res = await send(app, "POST", "/api/decks", body, cookie);
      expect(res.status).toBe(400);
      expect(await codeOf(res)).toBe("invalid_request");
    }
    expect(await namesOf(app, cookie)).toEqual([]);
  });

  test("answers 409 deck_name_taken for a name another Deck has, ignoring case", async () => {
    const { app, cookie } = await signedIn();
    await createDeck(app, cookie, { name: "Calculus 2" });

    const res = await send(app, "POST", "/api/decks", { name: " calculus 2 " }, cookie);

    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("deck_name_taken");
  });

  test("takes the name of a deleted Deck", async () => {
    const { app, cookie } = await signedIn();
    const old = await createDeck(app, cookie, { name: "Calculus 2" });
    await send(app, "DELETE", `/api/decks/${old.id}`, undefined, cookie);

    const res = await send(app, "POST", "/api/decks", { name: "Calculus 2" }, cookie);

    expect(res.status).toBe(201);
  });

  test("answers 401 when signed out", async () => {
    const { app } = await signedIn();

    const res = await send(app, "POST", "/api/decks", { name: "Spanish" });

    expect(res.status).toBe(401);
  });
});

describe("GET /api/decks", () => {
  test("lists the Decks that aren't deleted", async () => {
    const { app, cookie } = await signedIn();
    await createDeck(app, cookie, { name: "Spanish" });
    const gone = await createDeck(app, cookie, { name: "Gone" });
    await createDeck(app, cookie, { name: "Calculus 2", description: "About" });
    await send(app, "DELETE", `/api/decks/${gone.id}`, undefined, cookie);

    const res = await get(app, "/api/decks", cookie);

    expect(res.status).toBe(200);
    expect((await namesOf(app, cookie)).toSorted()).toEqual(["Calculus 2", "Spanish"]);
  });

  test("answers 401 when signed out", async () => {
    const { app } = await signedIn();

    expect((await get(app, "/api/decks")).status).toBe(401);
  });
});

describe("GET /api/decks/:id", () => {
  test("answers 404 not_found for an unknown Deck", async () => {
    const { app, cookie } = await signedIn();

    const res = await get(app, "/api/decks/nope", cookie);

    expect(res.status).toBe(404);
    expect(await codeOf(res)).toBe("not_found");
  });
});

describe("PATCH /api/decks/:id", () => {
  test("changes the name and the description, and answers the Deck", async () => {
    const { app, cookie } = await signedIn();
    const created = await createDeck(app, cookie, { name: "Spanish", description: "Old" });

    const res = await send(
      app,
      "PATCH",
      `/api/decks/${created.id}`,
      { name: " Español ", description: "" },
      cookie,
    );

    expect(res.status).toBe(200);
    expect(DeckResponse.parse(await res.json())).toEqual({
      ...created,
      name: "Español",
      description: null,
    });
  });

  test("answers 409 deck_name_taken for another Deck's name, ignoring case", async () => {
    const { app, cookie } = await signedIn();
    await createDeck(app, cookie, { name: "Calculus 2" });
    const other = await createDeck(app, cookie, { name: "Calculus 10" });

    const res = await send(app, "PATCH", `/api/decks/${other.id}`, { name: "CALCULUS 2" }, cookie);

    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("deck_name_taken");
  });

  test("answers 400 invalid_request for an empty change or a blank name", async () => {
    const { app, cookie } = await signedIn();
    const created = await createDeck(app, cookie, { name: "Spanish" });

    for (const body of [{}, { name: "" }, { name: 3 }]) {
      const res = await send(app, "PATCH", `/api/decks/${created.id}`, body, cookie);
      expect(res.status).toBe(400);
      expect(await codeOf(res)).toBe("invalid_request");
    }
  });

  test("answers 404 not_found for an unknown or deleted Deck", async () => {
    const { app, cookie } = await signedIn();
    const gone = await createDeck(app, cookie, { name: "Gone" });
    await send(app, "DELETE", `/api/decks/${gone.id}`, undefined, cookie);

    for (const id of ["nope", gone.id]) {
      const res = await send(app, "PATCH", `/api/decks/${id}`, { name: "New" }, cookie);
      expect(res.status).toBe(404);
      expect(await codeOf(res)).toBe("not_found");
    }
  });
});

describe("DELETE /api/decks/:id", () => {
  test("deletes the Deck: it answers 404 from then on and leaves the list", async () => {
    const { app, cookie } = await signedIn();
    const created = await createDeck(app, cookie, { name: "Spanish" });

    const res = await send(app, "DELETE", `/api/decks/${created.id}`, undefined, cookie);

    expect(res.status).toBe(200);
    expect(DeleteResponse.parse(await res.json()).deletionId).toBeString();
    const after = await get(app, `/api/decks/${created.id}`, cookie);
    expect(after.status).toBe(404);
    expect(await codeOf(after)).toBe("not_found");
    expect(await namesOf(app, cookie)).toEqual([]);
  });

  test("answers 404 not_found for an unknown or already deleted Deck", async () => {
    const { app, cookie } = await signedIn();
    const created = await createDeck(app, cookie, { name: "Spanish" });
    await send(app, "DELETE", `/api/decks/${created.id}`, undefined, cookie);

    for (const id of ["nope", created.id]) {
      const res = await send(app, "DELETE", `/api/decks/${id}`, undefined, cookie);
      expect(res.status).toBe(404);
      expect(await codeOf(res)).toBe("not_found");
    }
  });

  test("answers 401 when signed out", async () => {
    const { app, cookie } = await signedIn();
    const created = await createDeck(app, cookie, { name: "Spanish" });

    const res = await send(app, "DELETE", `/api/decks/${created.id}`, undefined);

    expect(res.status).toBe(401);
    expect(await namesOf(app, cookie)).toEqual(["Spanish"]);
  });
});

async function createFolder(
  app: App,
  cookie: string,
  name: string,
  parentId: string | null = null,
) {
  const res = await send(app, "POST", "/api/folders", { name, parentId }, cookie);
  if (res.status !== 201) throw new Error(`Create folder answered ${res.status}`);
  return FolderResponse.parse(await res.json()).id;
}

describe("Decks in Folders", () => {
  test("creates a Deck in a Folder, and answers 404 not_found for a Folder that isn't live", async () => {
    const { app, cookie } = await signedIn();
    const maths = await createFolder(app, cookie, "Maths");
    const gone = await createFolder(app, cookie, "Gone");
    await send(app, "DELETE", `/api/folders/${gone}`, undefined, cookie);

    expect(await createDeck(app, cookie, { name: "Calculus", folderId: maths })).toMatchObject({
      folderId: maths,
    });
    for (const folderId of ["nope", gone]) {
      const res = await send(app, "POST", "/api/decks", { name: "A", folderId }, cookie);
      expect(res.status).toBe(404);
      expect(await codeOf(res)).toBe("not_found");
    }
  });

  test("takes a name a Deck in another place has", async () => {
    const { app, cookie } = await signedIn();
    const maths = await createFolder(app, cookie, "Maths");
    await createDeck(app, cookie, { name: "Notes", folderId: maths });

    const res = await send(app, "POST", "/api/decks", { name: "Notes" }, cookie);

    expect(res.status).toBe(201);
  });

  test("moves a Deck, answering 409 name_clash, then Replace or Keep both", async () => {
    const { app, cookie } = await signedIn();
    const maths = await createFolder(app, cookie, "Maths");
    const there = await createDeck(app, cookie, { name: "Notes", folderId: maths });
    const moved = await createDeck(app, cookie, { name: "Notes" });

    const clash = await send(app, "PATCH", `/api/decks/${moved.id}`, { folderId: maths }, cookie);
    expect(clash.status).toBe(409);
    expect(NameClashError.parse(await clash.json()).clash).toEqual({
      id: there.id,
      name: "Notes",
      replaceAllowed: true,
    });

    const kept = await send(
      app,
      "PATCH",
      `/api/decks/${moved.id}`,
      { folderId: maths, onClash: "keepBoth" },
      cookie,
    );
    expect(kept.status).toBe(200);
    expect(DeckResponse.parse(await kept.json())).toMatchObject({
      name: "Notes (2)",
      folderId: maths,
    });

    const back = await createDeck(app, cookie, { name: "Notes (2)" });
    const replaced = await send(
      app,
      "PATCH",
      `/api/decks/${back.id}`,
      { folderId: maths, onClash: "replace" },
      cookie,
    );
    expect(replaced.status).toBe(200);
    expect((await get(app, `/api/decks/${moved.id}`, cookie)).status).toBe(404);
  });

  test("answers 404 not_found for a destination that isn't live", async () => {
    const { app, cookie } = await signedIn();
    const deck = await createDeck(app, cookie, { name: "Notes" });

    const res = await send(app, "PATCH", `/api/decks/${deck.id}`, { folderId: "nope" }, cookie);

    expect(res.status).toBe(404);
    expect(await codeOf(res)).toBe("not_found");
  });

  test("answers 400 invalid_request for onClash without a move", async () => {
    const { app, cookie } = await signedIn();
    const deck = await createDeck(app, cookie, { name: "Notes" });

    const res = await send(
      app,
      "PATCH",
      `/api/decks/${deck.id}`,
      { name: "B", onClash: "replace" },
      cookie,
    );

    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe("invalid_request");
  });
});

describe("A Deck's own Macros", () => {
  const d = { name: "\\d", definition: "\\mathrm{d}" };
  const eps = { name: "\\eps", definition: "\\epsilon" };

  test("are [] for a new Deck", async () => {
    const { app, cookie } = await signedIn();

    expect((await createDeck(app, cookie, { name: "Calculus 2" })).macros).toEqual([]);
  });

  test("PATCH replaces the whole list as given, and the Deck reads it back", async () => {
    const { app, cookie } = await signedIn();
    const created = await createDeck(app, cookie, { name: "Calculus 2" });

    const res = await send(app, "PATCH", `/api/decks/${created.id}`, { macros: [d, eps] }, cookie);
    expect(res.status).toBe(200);
    expect(DeckResponse.parse(await res.json())).toEqual({ ...created, macros: [d, eps] });

    await send(app, "PATCH", `/api/decks/${created.id}`, { macros: [eps] }, cookie);
    const read = DeckResponse.parse(
      await (await get(app, `/api/decks/${created.id}`, cookie)).json(),
    );
    expect(read.macros).toEqual([eps]);
    const listed = DeckListResponse.parse(await (await get(app, "/api/decks", cookie)).json());
    expect(listed.find((deck) => deck.id === created.id)?.macros).toEqual([eps]);
  });

  test("are one Deck's own: another Deck's stay as they are", async () => {
    const { app, cookie } = await signedIn();
    const one = await createDeck(app, cookie, { name: "One" });
    const other = await createDeck(app, cookie, { name: "Other" });

    await send(app, "PATCH", `/api/decks/${one.id}`, { macros: [d] }, cookie);

    const read = DeckResponse.parse(
      await (await get(app, `/api/decks/${other.id}`, cookie)).json(),
    );
    expect(read.macros).toEqual([]);
  });

  test("refuses with a 400 naming the problem", async () => {
    const { app, cookie } = await signedIn();
    const created = await createDeck(app, cookie, { name: "Calculus 2" });
    const refused: [unknown, string][] = [
      [[{ name: "\\1a", definition: "x" }], "A macro's name is \\ and letters"],
      [[{ name: "\\R", definition: "" }], "Write what the macro stands for"],
      [
        [{ name: "\\R", definition: "x".repeat(1001) }],
        "Keep \\R's definition to 1,000 characters",
      ],
      [[d, d], "\\d is in the list twice"],
      [
        Array.from({ length: 101 }, (_, i) => ({
          name: `\\m${"a".repeat(i + 1)}`,
          definition: "x",
        })),
        "Keep to 100 macros",
      ],
    ];

    for (const [macros, message] of refused) {
      const res = await send(app, "PATCH", `/api/decks/${created.id}`, { macros }, cookie);
      expect(res.status).toBe(400);
      const { error } = ApiError.parse(await res.json());
      expect(error.code).toBe("invalid_request");
      expect(error.message).toContain(message);
    }
  });
});
