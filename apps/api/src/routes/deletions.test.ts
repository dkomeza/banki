import { describe, expect, test } from "bun:test";
import {
  CardResponse,
  DeckListResponse,
  DeckResponse,
  DeleteResponse,
  DeletionListResponse,
  FolderResponse,
  PlaceDeletedError,
  RestoreResponse,
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
  if (res.status !== 201) throw new Error(`Create folder answered ${res.status}`);
  return FolderResponse.parse(await res.json());
}

async function createDeck(app: App, cookie: string, name: string, folderId: string | null = null) {
  const res = await send(app, "POST", "/api/decks", { name, folderId }, cookie);
  if (res.status !== 201) throw new Error(`Create deck answered ${res.status}`);
  return DeckResponse.parse(await res.json());
}

async function createCard(app: App, cookie: string, deckId: string, front: string) {
  const res = await send(app, "POST", `/api/decks/${deckId}/cards`, { front, back: "b" }, cookie);
  if (res.status !== 201) throw new Error(`Create card answered ${res.status}`);
  return CardResponse.parse(await res.json());
}

/** Deletes a Card, Deck or Folder and answers its Deletion's ID. */
async function remove(app: App, cookie: string, path: string) {
  const res = await send(app, "DELETE", path, undefined, cookie);
  if (res.status !== 200) throw new Error(`Delete answered ${res.status}`);
  return DeleteResponse.parse(await res.json()).deletionId;
}

const listed = async (app: App, cookie: string) =>
  DeletionListResponse.parse(await (await get(app, "/api/deletions", cookie)).json());

const restore = (app: App, cookie: string | undefined, id: string) =>
  send(app, "POST", `/api/deletions/${id}/restore`, undefined, cookie);

describe("GET /api/deletions", () => {
  test("lists the User's Deletions, newest first, each with its top item, place and counts", async () => {
    const { app, cookie } = await signedIn();
    const maths = await createFolder(app, cookie, "Maths");
    const calculus = await createDeck(app, cookie, "Calculus", maths.id);
    await createCard(app, cookie, calculus.id, "c1");
    const spanish = await createDeck(app, cookie, "Spanish");
    const card = await createCard(app, cookie, spanish.id, "la madrugada");
    const cardDeletion = await remove(app, cookie, `/api/cards/${card.id}`);
    const folderDeletion = await remove(app, cookie, `/api/folders/${maths.id}`);

    const entries = await listed(app, cookie);

    // Both may be stamped in the same millisecond: the repository's tests pin the order.
    expect(entries.map((d) => d.id).toSorted()).toEqual([folderDeletion, cardDeletion].toSorted());
    const folderEntry = entries.find((d) => d.id === folderDeletion);
    expect(folderEntry).toMatchObject({
      top: { kind: "folder", id: maths.id, name: "Maths" },
      path: [],
      counts: { folders: 0, decks: 1, cards: 1 },
    });
    expect(entries.find((d) => d.id === cardDeletion)).toMatchObject({
      top: { kind: "card", id: card.id, name: "la madrugada" },
      deck: { id: spanish.id, name: "Spanish" },
    });
    expect(
      Date.parse(folderEntry?.removesAt ?? "") - Date.parse(folderEntry?.deletedAt ?? ""),
    ).toBe(30 * 24 * 60 * 60 * 1000);
  });

  test("answers 401 when signed out", async () => {
    const { app } = await signedIn();

    expect((await get(app, "/api/deletions")).status).toBe(401);
  });
});

describe("POST /api/deletions/:id/restore", () => {
  test("restores the Deletion and answers its top item; the entry leaves the list", async () => {
    const { app, cookie } = await signedIn();
    const spanish = await createDeck(app, cookie, "Spanish");
    await createCard(app, cookie, spanish.id, "s1");
    const id = await remove(app, cookie, `/api/decks/${spanish.id}`);

    const res = await restore(app, cookie, id);

    expect(res.status).toBe(200);
    expect(RestoreResponse.parse(await res.json())).toEqual({
      kind: "deck",
      id: spanish.id,
      name: "Spanish",
      movedToRoot: false,
      renamed: false,
    });
    expect(
      DeckResponse.parse(await (await get(app, `/api/decks/${spanish.id}`, cookie)).json()),
    ).toMatchObject({ cardCount: 1 });
    expect(await listed(app, cookie)).toEqual([]);
  });

  test("restores to the Root when the Folder is deleted, and as Name (2) on a clash", async () => {
    const { app, cookie } = await signedIn();
    const old = await createFolder(app, cookie, "Old semester");
    const linear = await createDeck(app, cookie, "Linear algebra", old.id);
    const id = await remove(app, cookie, `/api/decks/${linear.id}`);
    await remove(app, cookie, `/api/folders/${old.id}`);
    await createDeck(app, cookie, "Linear algebra");

    const res = await restore(app, cookie, id);

    expect(RestoreResponse.parse(await res.json())).toMatchObject({
      name: "Linear algebra (2)",
      movedToRoot: true,
      renamed: true,
    });
    const decks = DeckListResponse.parse(await (await get(app, "/api/decks", cookie)).json());
    expect(decks.map((d) => [d.name, d.folderId])).toContainEqual(["Linear algebra (2)", null]);
  });

  test("restores a Card's Deletion, as the Card's Undo does", async () => {
    const { app, cookie } = await signedIn();
    const spanish = await createDeck(app, cookie, "Spanish");
    const card = await createCard(app, cookie, spanish.id, "back again");
    const id = await remove(app, cookie, `/api/cards/${card.id}`);

    const res = await restore(app, cookie, id);

    expect(res.status).toBe(200);
    expect((await get(app, `/api/cards/${card.id}`, cookie)).status).toBe(200);
  });

  test("answers 409 place_deleted, naming the Deck, for a Card whose Deck is deleted", async () => {
    const { app, cookie } = await signedIn();
    const german = await createDeck(app, cookie, "German verbs");
    const card = await createCard(app, cookie, german.id, "der Termin");
    const id = await remove(app, cookie, `/api/cards/${card.id}`);
    await remove(app, cookie, `/api/decks/${german.id}`);

    const res = await restore(app, cookie, id);

    expect(res.status).toBe(409);
    expect(PlaceDeletedError.parse(await res.json())).toMatchObject({
      error: { code: "place_deleted" },
      deck: { id: german.id, name: "German verbs" },
    });
  });

  test("answers 404 not_found for an unknown Deletion, or one restored or removed already", async () => {
    const { app, cookie } = await signedIn();
    const restored = await remove(
      app,
      cookie,
      `/api/decks/${(await createDeck(app, cookie, "A")).id}`,
    );
    await restore(app, cookie, restored);
    const removed = await remove(
      app,
      cookie,
      `/api/decks/${(await createDeck(app, cookie, "B")).id}`,
    );
    await send(app, "DELETE", `/api/deletions/${removed}`, undefined, cookie);

    for (const id of ["nope", restored, removed]) {
      const res = await restore(app, cookie, id);
      expect(res.status).toBe(404);
      expect(await codeOf(res)).toBe("not_found");
    }
  });

  test("answers 401 when signed out", async () => {
    const { app, cookie } = await signedIn();
    const id = await remove(app, cookie, `/api/decks/${(await createDeck(app, cookie, "A")).id}`);

    expect((await restore(app, undefined, id)).status).toBe(401);
  });
});

describe("DELETE /api/deletions/:id", () => {
  test("removes the Deletion at once with 204: it can't be restored or listed", async () => {
    const { app, cookie } = await signedIn();
    const maths = await createFolder(app, cookie, "Maths");
    await createDeck(app, cookie, "Calculus", maths.id);
    const id = await remove(app, cookie, `/api/folders/${maths.id}`);

    const res = await send(app, "DELETE", `/api/deletions/${id}`, undefined, cookie);

    expect(res.status).toBe(204);
    expect(await listed(app, cookie)).toEqual([]);
    expect((await restore(app, cookie, id)).status).toBe(404);
  });

  test("answers 404 not_found for an unknown Deletion, or one removed already", async () => {
    const { app, cookie } = await signedIn();
    const id = await remove(app, cookie, `/api/decks/${(await createDeck(app, cookie, "A")).id}`);
    await send(app, "DELETE", `/api/deletions/${id}`, undefined, cookie);

    for (const unknown of ["nope", id]) {
      const res = await send(app, "DELETE", `/api/deletions/${unknown}`, undefined, cookie);
      expect(res.status).toBe(404);
      expect(await codeOf(res)).toBe("not_found");
    }
  });

  test("answers 401 when signed out", async () => {
    const { app, cookie } = await signedIn();
    const id = await remove(app, cookie, `/api/decks/${(await createDeck(app, cookie, "A")).id}`);

    expect((await send(app, "DELETE", `/api/deletions/${id}`, undefined)).status).toBe(401);
  });
});
