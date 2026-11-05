import { Database as SQLite } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { CardResponse, DeckResponse, GradeResponse, ImageUploadResponse } from "@banki/shared";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { openDatabase } from "../db/database";
import type { OpenRouterFetch } from "../openrouter/check-api-key";
import { createCardRepository } from "../repositories/cards";
import { createDeckRepository } from "../repositories/decks";
import { captureLogs } from "../testing/logs";
import { type App, ORIGIN, bootApps, codeOf, send, setUp } from "../testing/app";

const { boot, dataDir } = bootApps();
const logs = captureLogs();

const API_KEY = "sk-or-v1-5c0ffee5c0ffee5c0ffee5c0ffee3f9a";
const CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const KEY_A = Buffer.alloc(32, 0xa).toString("base64url");
const KEY_B = Buffer.alloc(32, 0xb).toString("base64url");

/** The Grader's answer, as OpenRouter's chat completion carries it. */
const completion = (answer: unknown) =>
  Response.json({
    id: "gen-1",
    choices: [{ message: { role: "assistant", content: JSON.stringify(answer) } }],
  });

const GOOD = { rating: "good", feedback: "Right.", missing: [], mistakes: [] };

/** A chat completion request, as far as the tests read it. */
const ChatBody = z.looseObject({
  messages: z.tuple([
    z.object({ role: z.literal("system"), content: z.string() }),
    z.object({
      role: z.literal("user"),
      content: z.array(z.looseObject({ type: z.string(), text: z.string().optional() })),
    }),
  ]),
});

type Chat = { url: string; headers: Headers; body: z.infer<typeof ChatBody> };

/**
 * OpenRouter, stubbed: it accepts every key check, and answers each chat
 * completion with `answer()`, recording the requests it was sent.
 */
function openRouter(answer: () => Promise<Response> | Response = () => completion(GOOD)) {
  const chats: Chat[] = [];
  const fetch: OpenRouterFetch = async (url, init) => {
    if (url === "https://openrouter.ai/api/v1/key") return Response.json({ data: {} });
    chats.push({
      url,
      headers: new Headers(init.headers),
      body: ChatBody.parse(JSON.parse(typeof init.body === "string" ? init.body : "")),
    });
    return answer();
  };
  return { fetch, chats };
}

/** A fresh app, signed in, with an API key stored unless `apiKey` is false. */
async function signedIn(
  stub = openRouter(),
  { apiKey = true, encryptionKey }: { apiKey?: boolean; encryptionKey?: string } = {},
) {
  const booted = boot({ encryptionKey }, { openRouterFetch: stub.fetch });
  const cookie = await setUp(booted);
  if (apiKey) {
    const res = await send(booted.app, "PUT", "/api/settings/api-key", { apiKey: API_KEY }, cookie);
    expect(res.status).toBe(200);
  }
  return { ...booted, cookie, stub };
}

async function createDeck(app: App, cookie: string, name = "Calculus") {
  const res = await send(app, "POST", "/api/decks", { name }, cookie);
  return DeckResponse.parse(await res.json());
}

async function createCard(
  app: App,
  cookie: string,
  deckId: string,
  card: { front: string; back: string; gradingNotes?: string | null },
) {
  const res = await send(app, "POST", `/api/decks/${deckId}/cards`, card, cookie);
  expect(res.status).toBe(201);
  return CardResponse.parse(await res.json());
}

/** A Deck with one Card in it, its Front "d/dx x^2" and its Back "2x". */
async function aCard(app: App, cookie: string) {
  const deck = await createDeck(app, cookie);
  const card = await createCard(app, cookie, deck.id, { front: "d/dx x^2", back: "2x" });
  return { deck, card };
}

const gradeCard = (app: App, cookie: string, cardId: string, answer: unknown) =>
  send(app, "POST", `/api/cards/${cardId}/grade`, { answer }, cookie);

/** Every row of every table, to show a request changed nothing. */
function everything() {
  const sqlite = new SQLite(join(dataDir(), "banki.db"), { readonly: true });
  try {
    const tables = sqlite
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all();
    return Object.fromEntries(
      tables.map(({ name }) => [name, sqlite.query(`SELECT * FROM "${name}"`).all()]),
    );
  } finally {
    sqlite.close();
  }
}

/** The text part of a chat request's user message. */
const userText = (chat: Chat | undefined) => chat?.body.messages[1].content[0]?.text ?? "";

/** The parts of a chat request's user message after its text. */
const attachments = (chat: Chat | undefined) => chat?.body.messages[1].content.slice(1);

const ascii = (text: string) => Array.from(new TextEncoder().encode(text));
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const GIF = new Uint8Array([...ascii("GIF89a"), 1, 0, 1, 0]);

async function uploadImage(app: App, cookie: string, bytes: Uint8Array) {
  const res = await app.request("/api/images", {
    method: "POST",
    headers: { "content-type": "application/octet-stream", origin: ORIGIN, cookie },
    body: bytes,
  });
  return ImageUploadResponse.parse(await res.json()).reference;
}

function inDatabase<T>(read: (db: ReturnType<typeof openDatabase>["db"]) => T): T {
  const opened = openDatabase(dataDir());
  try {
    return read(opened.db);
  } finally {
    opened.close();
  }
}

/** Another User's Card, made straight in the database; answers its ID. */
function othersCard() {
  return inDatabase((db) => {
    db.run(
      sql`INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('other', 'n', 'o@x.y', 1, 0, 0)`,
    );
    const deck = createDeckRepository(db).create("other", {
      name: "Theirs",
      description: null,
      folderId: null,
    });
    if (typeof deck === "string") throw new Error(`Their deck: ${deck}`);
    const card = createCardRepository(db).create("other", deck.id, { front: "f", back: "b" });
    if (typeof card === "string") throw new Error(`Their card: ${card}`);
    return card.id;
  });
}

describe("POST /api/cards/:cardId/grade", () => {
  test("answers the Grader's GradeResponse for a live Card, and stores nothing", async () => {
    const { app, cookie, stub } = await signedIn();
    const { card } = await aCard(app, cookie);
    const before = everything();

    const res = await gradeCard(app, cookie, card.id, "2x");

    expect(res.status).toBe(200);
    expect(GradeResponse.parse(await res.json())).toEqual(GradeResponse.parse(GOOD));
    expect(stub.chats).toHaveLength(1);
    expect(everything()).toEqual(before);
  });

  test("maps each Highlight to a range of the stored Back or of the answer as given", async () => {
    const stub = openRouter(() =>
      completion({
        rating: "hard",
        feedback: "Line 2: lost the minus sign.",
        missing: [
          { line: 2, quote: "\\mathbb{R}" },
          { line: 9, quote: "gone" },
        ],
        mistakes: [{ line: 2, quote: "x + 1", note: "should be $-x + 1$" }],
      }),
    );
    const { app, cookie } = await signedIn(stub);
    const deck = await createDeck(app, cookie);
    await send(
      app,
      "PATCH",
      `/api/decks/${deck.id}`,
      { macros: [{ name: "\\R", definition: "\\mathbb{R}" }] },
      cookie,
    );
    const back = "f(x) = -x + 1\nfor all $x \\in \\R$";
    const card = await createCard(app, cookie, deck.id, { front: "What is f?", back });
    const answer = "x + 1\nf(x) = x + 1";

    const res = await gradeCard(app, cookie, card.id, answer);

    const graded = GradeResponse.parse(await res.json());
    expect(graded.rating).toBe("hard");
    expect(graded.missing.map(({ from, to }) => back.slice(from, to))).toEqual(["\\R"]);
    expect(graded.mistakes).toEqual([{ from: 13, to: 18, note: "should be $-x + 1$" }]);
    expect(answer.slice(13, 18)).toBe("x + 1");
  });

  test("answers 404 not_found for a deleted Card, one in a deleted Deck, another User's, or none", async () => {
    const { app, cookie, stub } = await signedIn();
    const deck = await createDeck(app, cookie);
    const deleted = await createCard(app, cookie, deck.id, { front: "a", back: "b" });
    await send(app, "DELETE", `/api/cards/${deleted.id}`, undefined, cookie);
    const other = await createDeck(app, cookie, "Other");
    const inDeletedDeck = await createCard(app, cookie, other.id, { front: "a", back: "b" });
    await send(app, "DELETE", `/api/decks/${other.id}`, undefined, cookie);
    const theirs = othersCard();

    for (const id of [deleted.id, inDeletedDeck.id, theirs, "nope"]) {
      const res = await gradeCard(app, cookie, id, "2x");
      expect(res.status).toBe(404);
      expect(await codeOf(res)).toBe("not_found");
    }
    expect(stub.chats).toHaveLength(0);
  });

  test("answers 400 invalid_request for a blank answer or one over 20,000 characters, without asking OpenRouter", async () => {
    const { app, cookie, stub } = await signedIn();
    const { card } = await aCard(app, cookie);

    for (const answer of ["", "  \n\t", "x".repeat(20_001), 42, undefined]) {
      const res = await gradeCard(app, cookie, card.id, answer);
      expect(res.status).toBe(400);
      expect(await codeOf(res)).toBe("invalid_request");
    }
    expect(stub.chats).toHaveLength(0);
    expect((await gradeCard(app, cookie, card.id, "x".repeat(20_000))).status).toBe(200);
  });

  test("answers 409 no_api_key when no API key is stored, without asking OpenRouter", async () => {
    const { app, cookie, stub } = await signedIn(openRouter(), { apiKey: false });
    const { card } = await aCard(app, cookie);

    const res = await gradeCard(app, cookie, card.id, "2x");

    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("no_api_key");
    expect(stub.chats).toHaveLength(0);
  });

  test("answers 409 no_api_key when the stored API key can't be read", async () => {
    const first = await signedIn(openRouter(), { encryptionKey: KEY_A });
    const { card } = await aCard(first.app, first.cookie);
    const stub = openRouter();
    const { app } = boot({ encryptionKey: KEY_B }, { openRouterFetch: stub.fetch });

    const res = await gradeCard(app, first.cookie, card.id, "2x");

    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("no_api_key");
    expect(stub.chats).toHaveLength(0);
  });

  test("answers 401 unauthorized when signed out", async () => {
    const { app, cookie } = await signedIn();
    const { card } = await aCard(app, cookie);

    const res = await gradeCard(app, "", card.id, "2x");

    expect(res.status).toBe(401);
  });

  describe("when OpenRouter fails", () => {
    const failures: [string, () => Promise<Response> | Response, number | null][] = [
      [
        "an error status",
        () => Response.json({ error: { message: "No credit" } }, { status: 402 }),
        402,
      ],
      [
        "a network error",
        () => {
          throw new TypeError("fetch failed");
        },
        null,
      ],
      [
        "the timeout",
        () => {
          throw new DOMException("The operation timed out.", "TimeoutError");
        },
        null,
      ],
      [
        "a response that isn't JSON",
        () => Response.json({ choices: [{ message: { content: "not json at all" } }] }),
        200,
      ],
      [
        "a response that doesn't fit the schema",
        () => completion({ rating: "perfect", feedback: "x", missing: [], mistakes: [] }),
        200,
      ],
      ["a body with no choices", () => Response.json({ error: { code: 502 } }), 200],
    ];

    for (const [what, answer, status] of failures) {
      test(`answers 502 grading_failed on ${what}, logging the status and the Model only`, async () => {
        const { app, cookie } = await signedIn(openRouter(answer));
        await send(app, "PATCH", "/api/settings", { model: "google/gemini-3.8-flash" }, cookie);
        const deck = await createDeck(app, cookie);
        const card = await createCard(app, cookie, deck.id, {
          front: "secret front",
          back: "secret back",
          gradingNotes: "secret notes",
        });

        const res = await gradeCard(app, cookie, card.id, "secret answer");

        expect(res.status).toBe(502);
        expect(await codeOf(res)).toBe("grading_failed");
        const failure = logs.find((record) => record.category.join(".") === "banki.grader");
        expect(failure?.level).toBe("warning");
        expect(failure?.properties).toMatchObject({ status, model: "google/gemini-3.8-flash" });
        const logged = JSON.stringify(logs.map((record) => [record.message, record.properties]));
        for (const secret of [
          "secret front",
          "secret back",
          "secret notes",
          "secret answer",
          API_KEY,
        ]) {
          expect(logged).not.toContain(secret);
        }
      });
    }
  });

  test("asks the User's Model, at temperature 0, for strict structured output from providers that honour it", async () => {
    const { app, cookie, stub } = await signedIn();
    await send(app, "PATCH", "/api/settings", { model: "openai/gpt-6-luna" }, cookie);
    const { card } = await aCard(app, cookie);

    await gradeCard(app, cookie, card.id, "2x");

    const chat = stub.chats[0];
    expect(chat?.url).toBe(CHAT_URL);
    expect(chat?.headers.get("authorization")).toBe(`Bearer ${API_KEY}`);
    expect(chat?.body).toMatchObject({
      model: "openai/gpt-6-luna",
      stream: false,
      temperature: 0,
      response_format: { type: "json_schema", json_schema: { strict: true } },
      provider: { require_parameters: true },
    });
    expect(chat?.body.messages[0].content).toContain("ignore");
  });

  test("sends the Front, Back, Grading notes and answer, with the Deck's effective Macros expanded", async () => {
    const { app, cookie, stub } = await signedIn();
    await send(
      app,
      "PATCH",
      "/api/settings",
      {
        macros: [
          { name: "\\R", definition: "\\mathbb{R}" },
          { name: "\\eps", definition: "\\epsilon" },
        ],
      },
      cookie,
    );
    const deck = await createDeck(app, cookie);
    await send(
      app,
      "PATCH",
      `/api/decks/${deck.id}`,
      { macros: [{ name: "\\eps", definition: "\\varepsilon" }] },
      cookie,
    );
    const card = await createCard(app, cookie, deck.id, {
      front: "Define $\\eps$-continuity on $\\R$",
      back: "For every $\\eps > 0$\nthere is $\\delta$",
      gradingNotes: "must mention $\\delta$ and $\\R$",
    });

    await gradeCard(app, cookie, card.id, "for all $\\eps$ in $\\R$");

    const text = userText(stub.chats[0]);
    expect(text).toContain("<front>\nDefine $\\varepsilon$-continuity on $\\mathbb{R}$\n</front>");
    expect(text).toContain(
      "<back>\n1| For every $\\varepsilon > 0$\n2| there is $\\delta$\n</back>",
    );
    expect(text).toContain(
      "<grading_notes>\nmust mention $\\delta$ and $\\mathbb{R}$\n</grading_notes>",
    );
    expect(text).toContain(
      "<written_answer>\n1| for all $\\varepsilon$ in $\\mathbb{R}$\n</written_answer>",
    );
  });

  test("leaves the Grading notes out of a Card that has none", async () => {
    const { app, cookie, stub } = await signedIn();
    const { card } = await aCard(app, cookie);

    await gradeCard(app, cookie, card.id, "2x");

    expect(userText(stub.chats[0])).not.toContain("grading_notes");
  });

  test("sends Images as numbered data URLs, and a GIF or a missing one as a placeholder", async () => {
    const { app, cookie, stub } = await signedIn();
    const png = await uploadImage(app, cookie, PNG);
    const gif = await uploadImage(app, cookie, GIF);
    const deck = await createDeck(app, cookie);
    const card = await createCard(app, cookie, deck.id, {
      front: `What is this? ![](${png})`,
      back: `A square ![](${gif}) ![](images/gone.png)\nas before: ![](${png})`,
    });

    await gradeCard(app, cookie, card.id, "a square");

    const text = userText(stub.chats[0]);
    expect(text).toContain("<front>\nWhat is this? [Image 1]\n</front>");
    expect(text).toContain(
      "1| A square [an image that couldn't be sent] [an image that couldn't be sent]\n2| as before: [Image 1]",
    );
    expect(attachments(stub.chats[0])).toEqual([
      { type: "text", text: "Image 1:" },
      {
        type: "image_url",
        image_url: { url: `data:image/png;base64,${Buffer.from(PNG).toString("base64")}` },
      },
    ]);
  });
});
