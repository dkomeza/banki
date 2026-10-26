import { describe, expect, test } from "bun:test";
import {
  DeckListResponse,
  DeckResponse,
  FolderListResponse,
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

async function createFolder(
  app: App,
  cookie: string,
  name: string,
  parentId: string | null = null,
) {
  const res = await send(app, "POST", "/api/folders", { name, parentId }, cookie);
  if (res.status !== 201) throw new Error(`Create answered ${res.status}`);
  return FolderResponse.parse(await res.json());
}

async function createDeck(app: App, cookie: string, name: string, folderId: string | null) {
  const res = await send(app, "POST", "/api/decks", { name, folderId }, cookie);
  if (res.status !== 201) throw new Error(`Create deck answered ${res.status}`);
  return DeckResponse.parse(await res.json());
}

const patch = (app: App, cookie: string, id: string, body: unknown) =>
  send(app, "PATCH", `/api/folders/${id}`, body, cookie);

const folderNames = async (app: App, cookie: string) =>
  FolderListResponse.parse(await (await get(app, "/api/folders", cookie)).json())
    .map((f) => f.name)
    .toSorted();

describe("POST /api/folders", () => {
  test("creates a Folder, trimmed, at the Root or in a Folder, and answers it with 201", async () => {
    const { app, cookie } = await signedIn();

    const maths = await createFolder(app, cookie, "  Maths ");
    const analysis = await createFolder(app, cookie, "Analysis", maths.id);

    expect(maths).toMatchObject({ name: "Maths", parentId: null });
    expect(analysis).toMatchObject({ name: "Analysis", parentId: maths.id });
    const res = await get(app, `/api/folders/${analysis.id}`, cookie);
    expect(res.status).toBe(200);
    expect(FolderResponse.parse(await res.json())).toEqual(analysis);
  });

  test("answers 400 invalid_request for a blank or too long name, or anything else", async () => {
    const { app, cookie } = await signedIn();

    for (const body of [{ name: " " }, { name: "a".repeat(101) }, {}, { name: "a", x: 1 }]) {
      const res = await send(app, "POST", "/api/folders", body, cookie);
      expect(res.status).toBe(400);
      expect(await codeOf(res)).toBe("invalid_request");
    }
  });

  test("answers 409 folder_name_taken for a name a Folder beside it has, ignoring case", async () => {
    const { app, cookie } = await signedIn();
    await createFolder(app, cookie, "Maths");

    const res = await send(app, "POST", "/api/folders", { name: "MATHS" }, cookie);

    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("folder_name_taken");
  });

  test("takes a name a Deck beside it has", async () => {
    const { app, cookie } = await signedIn();
    await createDeck(app, cookie, "Maths", null);

    expect((await send(app, "POST", "/api/folders", { name: "Maths" }, cookie)).status).toBe(201);
  });

  test("answers 404 not_found for a parent that is unknown or deleted", async () => {
    const { app, cookie } = await signedIn();
    const gone = await createFolder(app, cookie, "Gone");
    await send(app, "DELETE", `/api/folders/${gone.id}`, undefined, cookie);

    for (const parentId of ["nope", gone.id]) {
      const res = await send(app, "POST", "/api/folders", { name: "A", parentId }, cookie);
      expect(res.status).toBe(404);
      expect(await codeOf(res)).toBe("not_found");
    }
  });

  test("answers 401 when signed out", async () => {
    const { app } = await signedIn();

    expect((await send(app, "POST", "/api/folders", { name: "Maths" })).status).toBe(401);
  });
});

describe("GET /api/folders", () => {
  test("lists the live Folders", async () => {
    const { app, cookie } = await signedIn();
    const maths = await createFolder(app, cookie, "Maths");
    await createFolder(app, cookie, "Analysis", maths.id);
    const gone = await createFolder(app, cookie, "Gone");
    await send(app, "DELETE", `/api/folders/${gone.id}`, undefined, cookie);

    expect(await folderNames(app, cookie)).toEqual(["Analysis", "Maths"]);
  });

  test("answers 401 when signed out", async () => {
    const { app } = await signedIn();

    expect((await get(app, "/api/folders")).status).toBe(401);
  });
});

describe("GET /api/folders/:id", () => {
  test("answers 404 not_found for an unknown Folder", async () => {
    const { app, cookie } = await signedIn();

    const res = await get(app, "/api/folders/nope", cookie);

    expect(res.status).toBe(404);
    expect(await codeOf(res)).toBe("not_found");
  });
});

describe("PATCH /api/folders/:id", () => {
  test("renames a Folder", async () => {
    const { app, cookie } = await signedIn();
    const maths = await createFolder(app, cookie, "Maths");

    const res = await patch(app, cookie, maths.id, { name: " Mathematics " });

    expect(res.status).toBe(200);
    expect(FolderResponse.parse(await res.json())).toEqual({ ...maths, name: "Mathematics" });
  });

  test("answers 409 folder_name_taken for a rename to a name beside it", async () => {
    const { app, cookie } = await signedIn();
    await createFolder(app, cookie, "Maths");
    const other = await createFolder(app, cookie, "Other");

    const res = await patch(app, cookie, other.id, { name: "maths" });

    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("folder_name_taken");
  });

  test("moves a Folder", async () => {
    const { app, cookie } = await signedIn();
    const maths = await createFolder(app, cookie, "Maths");
    const analysis = await createFolder(app, cookie, "Analysis");

    const res = await patch(app, cookie, analysis.id, { parentId: maths.id });

    expect(res.status).toBe(200);
    expect(FolderResponse.parse(await res.json()).parentId).toBe(maths.id);
  });

  test("answers 400 invalid_move for a move into itself or inside itself, whatever onClash says", async () => {
    const { app, cookie } = await signedIn();
    const maths = await createFolder(app, cookie, "Maths");
    const analysis = await createFolder(app, cookie, "Analysis", maths.id);

    for (const parentId of [maths.id, analysis.id]) {
      for (const onClash of [undefined, "replace", "keepBoth"]) {
        const res = await patch(app, cookie, maths.id, { parentId, onClash });
        expect(res.status).toBe(400);
        expect(await codeOf(res)).toBe("invalid_move");
      }
    }
  });

  test("answers 409 name_clash, then Keep both or Replace", async () => {
    const { app, cookie } = await signedIn();
    const archive = await createFolder(app, cookie, "Archive");
    const there = await createFolder(app, cookie, "Analysis", archive.id);
    const deckThere = await createDeck(app, cookie, "Calculus", there.id);
    const moved = await createFolder(app, cookie, "Analysis");

    const clash = await patch(app, cookie, moved.id, { parentId: archive.id });
    expect(clash.status).toBe(409);
    expect(NameClashError.parse(await clash.json())).toMatchObject({
      error: { code: "name_clash" },
      clash: { id: there.id, name: "Analysis", replaceAllowed: true },
    });

    const kept = await patch(app, cookie, moved.id, { parentId: archive.id, onClash: "keepBoth" });
    expect(kept.status).toBe(200);
    expect(FolderResponse.parse(await kept.json()).name).toBe("Analysis (2)");

    const again = await createFolder(app, cookie, "Analysis");
    const replaced = await patch(app, cookie, again.id, {
      parentId: archive.id,
      onClash: "replace",
    });
    expect(replaced.status).toBe(200);
    expect((await get(app, `/api/folders/${there.id}`, cookie)).status).toBe(404);
    expect((await get(app, `/api/decks/${deckThere.id}`, cookie)).status).toBe(404);
  });

  test("answers 409 invalid_move for Replace where the clashing Folder holds the moved one", async () => {
    const { app, cookie } = await signedIn();
    const bio = await createFolder(app, cookie, "Bio");
    const x = await createFolder(app, cookie, "X", bio.id);
    const inner = await createFolder(app, cookie, "Bio", x.id);

    const clash = await patch(app, cookie, inner.id, { parentId: null });
    expect(NameClashError.parse(await clash.json()).clash.replaceAllowed).toBe(false);

    const res = await patch(app, cookie, inner.id, { parentId: null, onClash: "replace" });

    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("invalid_move");
    expect((await get(app, `/api/folders/${bio.id}`, cookie)).status).toBe(200);
  });

  test("answers 404 not_found for an unknown or deleted Folder, or destination", async () => {
    const { app, cookie } = await signedIn();
    const gone = await createFolder(app, cookie, "Gone");
    await send(app, "DELETE", `/api/folders/${gone.id}`, undefined, cookie);
    const maths = await createFolder(app, cookie, "Maths");

    for (const [id, body] of [
      ["nope", { name: "x" }],
      [gone.id, { name: "x" }],
      [maths.id, { parentId: gone.id }],
      [maths.id, { parentId: "nope" }],
    ] as const) {
      const res = await patch(app, cookie, id, body);
      expect(res.status).toBe(404);
      expect(await codeOf(res)).toBe("not_found");
    }
  });

  test("answers 400 invalid_request for an empty change or onClash without a move", async () => {
    const { app, cookie } = await signedIn();
    const maths = await createFolder(app, cookie, "Maths");

    for (const body of [{}, { name: "" }, { name: "B", onClash: "keepBoth" }]) {
      const res = await patch(app, cookie, maths.id, body);
      expect(res.status).toBe(400);
      expect(await codeOf(res)).toBe("invalid_request");
    }
  });
});

describe("DELETE /api/folders/:id", () => {
  test("deletes the Folder and everything in it: none of it answers or lists any more", async () => {
    const { app, cookie } = await signedIn();
    const maths = await createFolder(app, cookie, "Maths");
    const analysis = await createFolder(app, cookie, "Analysis", maths.id);
    const calculus = await createDeck(app, cookie, "Calculus", analysis.id);
    await createDeck(app, cookie, "Spanish", null);

    const res = await send(app, "DELETE", `/api/folders/${maths.id}`, undefined, cookie);

    expect(res.status).toBe(204);
    for (const path of [
      `/api/folders/${maths.id}`,
      `/api/folders/${analysis.id}`,
      `/api/decks/${calculus.id}`,
    ]) {
      expect((await get(app, path, cookie)).status).toBe(404);
    }
    expect(await folderNames(app, cookie)).toEqual([]);
    const decks = DeckListResponse.parse(await (await get(app, "/api/decks", cookie)).json());
    expect(decks.map((d) => d.name)).toEqual(["Spanish"]);
  });

  test("answers 404 not_found for an unknown or already deleted Folder", async () => {
    const { app, cookie } = await signedIn();
    const maths = await createFolder(app, cookie, "Maths");
    await send(app, "DELETE", `/api/folders/${maths.id}`, undefined, cookie);

    for (const id of ["nope", maths.id]) {
      const res = await send(app, "DELETE", `/api/folders/${id}`, undefined, cookie);
      expect(res.status).toBe(404);
      expect(await codeOf(res)).toBe("not_found");
    }
  });

  test("answers 401 when signed out", async () => {
    const { app, cookie } = await signedIn();
    const maths = await createFolder(app, cookie, "Maths");

    expect((await send(app, "DELETE", `/api/folders/${maths.id}`, undefined)).status).toBe(401);
    expect(await folderNames(app, cookie)).toEqual(["Maths"]);
  });
});
