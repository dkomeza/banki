import { describe, expect, test } from "bun:test";
import { ApiError, DeckListResponse, DeckResponse } from "@banki/shared";
import { type App, bootApps, get, ORIGIN, setUp } from "../testing/app";

const { boot } = bootApps();

/** A fresh app that Setup is done on, and the signed-in cookie Setup set. */
async function signedIn() {
  const booted = boot();
  const cookie = await setUp(booted);
  return { app: booted.app, cookie };
}

const send = (app: App, method: string, path: string, body: unknown, cookie?: string) =>
  app.request(path, {
    method,
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      ...(cookie === undefined ? {} : { cookie }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const codeOf = async (res: Response) => ApiError.parse(await res.json()).error.code;

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

    expect(res.status).toBe(204);
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
