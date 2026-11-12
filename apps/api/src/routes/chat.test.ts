import { Database as SQLite } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  ApiError,
  CardResponse,
  ChatChunk,
  DeckResponse,
  type GradeResponse,
  ImageUploadResponse,
} from "@banki/shared";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { openDatabase } from "../db/database";
import { CHAT_PROMPT } from "../grader/chat";
import type { OpenRouterFetch } from "../openrouter/check-api-key";
import { createCardRepository } from "../repositories/cards";
import { createDeckRepository } from "../repositories/decks";
import { captureLogs } from "../testing/logs";
import { type App, ORIGIN, bootApps, codeOf, send, setUp } from "../testing/app";

const { boot, dataDir } = bootApps();
const logs = captureLogs();

const API_KEY = "sk-or-v1-5c0ffee5c0ffee5c0ffee5c0ffee3f9a";
const CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

/** One server-sent event's line, as OpenRouter streams it. */
const event = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
const piece = (content: string) => event({ choices: [{ delta: { content } }] });
const FINISHED = event({ choices: [{ delta: {}, finish_reason: "stop" }] });

/** A streamed reply: `pieces`, then the Model finishing and `[DONE]`, unless `cut`. */
function streamed(pieces: string[], { cut = false }: { cut?: boolean } = {}) {
  const lines = [": OPENROUTER PROCESSING\n\n", ...pieces.map(piece)];
  if (!cut) lines.push(FINISHED, "data: [DONE]\n\n");
  return new Response(lines.join(""), { headers: { "content-type": "text/event-stream" } });
}

/** A chat completion request, as far as the tests read it. */
const ChatBody = z.looseObject({
  model: z.string(),
  stream: z.boolean(),
  messages: z.array(
    z.object({
      role: z.string(),
      content: z.union([
        z.string(),
        z.array(z.looseObject({ type: z.string(), text: z.string().optional() })),
      ]),
    }),
  ),
});

type Asked = { url: string; headers: Headers; body: z.infer<typeof ChatBody> };

/**
 * OpenRouter, stubbed: it accepts every key check, and answers each chat
 * completion with `answer()`, recording the requests it was sent.
 */
function openRouter(answer: () => Promise<Response> | Response = () => streamed(["Because."])) {
  const asked: Asked[] = [];
  const fetch: OpenRouterFetch = async (url, init) => {
    if (url === "https://openrouter.ai/api/v1/key") return Response.json({ data: {} });
    asked.push({
      url,
      headers: new Headers(init.headers),
      body: ChatBody.parse(JSON.parse(typeof init.body === "string" ? init.body : "")),
    });
    return answer();
  };
  return { fetch, asked };
}

/** A fresh app, signed in, with an API key stored unless `apiKey` is false. */
async function signedIn(stub = openRouter(), { apiKey = true }: { apiKey?: boolean } = {}) {
  const booted = boot({}, { openRouterFetch: stub.fetch });
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

const GRADE: GradeResponse = {
  rating: "hard",
  feedback: "Close: the factor **2** is missing.",
  missing: [{ from: 0, to: 1 }],
  mistakes: [{ from: 0, to: 1, note: "Not $x$." }],
  model: "anthropic/claude-haiku-5.5",
};

/** A chat body: the Written answer "x", its grade, and one question. */
const chatBody = (overrides: Record<string, unknown> = {}) => ({
  answer: "x",
  grade: GRADE,
  messages: [{ role: "user", text: "Why is that wrong?" }],
  ...overrides,
});

const chat = (app: App, cookie: string, cardId: string, body: unknown = chatBody()) =>
  send(app, "POST", `/api/cards/${cardId}/chat`, body, cookie);

/** The route's answer, read to its end: the reply's pieces, and whether it ended. */
async function readReply(res: Response) {
  const lines = (await res.text()).split("\n").filter((line) => line !== "");
  const chunks = lines.map((line) => ChatChunk.parse(JSON.parse(line)));
  return {
    text: chunks.map((chunk) => ("text" in chunk ? chunk.text : "")).join(""),
    pieces: chunks.filter((chunk) => "text" in chunk).length,
    ended: chunks.some((chunk) => "end" in chunk),
  };
}

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

/** Another User's Card, made straight in the database; answers its ID. */
function othersCard() {
  const opened = openDatabase(dataDir());
  try {
    opened.db.run(
      sql`INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('other', 'n', 'o@x.y', 1, 0, 0)`,
    );
    const deck = createDeckRepository(opened.db).create("other", {
      name: "Theirs",
      description: null,
      folderId: null,
    });
    if (typeof deck === "string") throw new Error(`Their deck: ${deck}`);
    const card = createCardRepository(opened.db).create("other", deck.id, {
      front: "f",
      back: "b",
    });
    if (typeof card === "string") throw new Error(`Their card: ${card}`);
    return card.id;
  } finally {
    opened.close();
  }
}

/** The text part of the request's first user message: the Card and its grade. */
const contextOf = (asked: Asked | undefined) => {
  const content = asked?.body.messages[1]?.content;
  return Array.isArray(content) ? (content[0]?.text ?? "") : "";
};

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

describe("POST /api/cards/:cardId/chat", () => {
  test("streams the Grader's reply, piece by piece, to its end, and stores nothing", async () => {
    const stub = openRouter(() => streamed(["Because ", "$2x$ ", "is the derivative."]));
    const { app, cookie } = await signedIn(stub);
    const { card } = await aCard(app, cookie);
    const before = everything();

    const res = await chat(app, cookie, card.id);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    expect(await readReply(res)).toEqual({
      text: "Because $2x$ is the derivative.",
      pieces: 3,
      ended: true,
    });
    expect(stub.asked).toHaveLength(1);
    expect(everything()).toEqual(before);
  });

  test("asks the User's Model on their key for a stream: the prompt, the Card with its grade, the Feedback, then the chat", async () => {
    const { app, cookie, stub } = await signedIn();
    await send(app, "PATCH", "/api/settings", { model: "openai/gpt-6-luna" }, cookie);
    const { card } = await aCard(app, cookie);

    await chat(
      app,
      cookie,
      card.id,
      chatBody({
        messages: [
          { role: "user", text: "Why?" },
          { role: "grader", text: "The power rule." },
          { role: "user", text: "Show me." },
        ],
      }),
    );

    const asked = stub.asked[0];
    expect(asked?.url).toBe(CHAT_URL);
    expect(asked?.headers.get("authorization")).toBe(`Bearer ${API_KEY}`);
    expect(asked?.body).toMatchObject({ model: "openai/gpt-6-luna", stream: true });
    expect(asked?.body).not.toHaveProperty("response_format");
    expect(asked?.body.messages.map((m) => m.role)).toEqual([
      "system",
      "user",
      "assistant",
      "user",
      "assistant",
      "user",
    ]);
    expect(asked?.body.messages[0]?.content).toBe(CHAT_PROMPT);
    expect(asked?.body.messages.slice(2).map((m) => m.content)).toEqual([
      GRADE.feedback,
      "Why?",
      "The power rule.",
      "Show me.",
    ]);
    const context = contextOf(asked);
    expect(context).toContain("<front>\nd/dx x^2\n</front>");
    expect(context).toContain("<back>\n1| 2x\n</back>");
    expect(context).toContain("<written_answer>\n1| x\n</written_answer>");
    expect(context).toContain(
      '<grade>\nSuggested Rating: hard\nMistakes in the Written answer:\n- "x": Not $x$.\nMissing from the Written answer, in the Back:\n- "2"\n</grade>',
    );
  });

  test("reads the Card itself: Grading notes and the Deck's effective Macros expanded, the Images sent", async () => {
    const { app, cookie, stub } = await signedIn();
    await send(
      app,
      "PATCH",
      "/api/settings",
      { macros: [{ name: "\\R", definition: "\\mathbb{R}" }] },
      cookie,
    );
    const upload = await app.request("/api/images", {
      method: "POST",
      headers: { "content-type": "application/octet-stream", origin: ORIGIN, cookie },
      body: PNG,
    });
    const png = ImageUploadResponse.parse(await upload.json()).reference;
    const deck = await createDeck(app, cookie);
    await send(
      app,
      "PATCH",
      `/api/decks/${deck.id}`,
      { macros: [{ name: "\\eps", definition: "\\varepsilon" }] },
      cookie,
    );
    const card = await createCard(app, cookie, deck.id, {
      front: `Define $\\eps$ on $\\R$ ![](${png})`,
      back: "For every $\\eps > 0$",
      gradingNotes: "must mention $\\R$",
    });

    await chat(app, cookie, card.id, chatBody({ answer: "all $\\eps$" }));

    const context = contextOf(stub.asked[0]);
    expect(context).toContain(
      "<front>\nDefine $\\varepsilon$ on $\\mathbb{R}$ [Image 1]\n</front>",
    );
    expect(context).toContain("<back>\n1| For every $\\varepsilon > 0$\n</back>");
    expect(context).toContain("<grading_notes>\nmust mention $\\mathbb{R}$\n</grading_notes>");
    expect(context).toContain("<written_answer>\n1| all $\\varepsilon$\n</written_answer>");
    const parts = stub.asked[0]?.body.messages[1]?.content;
    expect(Array.isArray(parts) ? parts.slice(1) : []).toEqual([
      { type: "text", text: "Image 1:" },
      {
        type: "image_url",
        image_url: { url: `data:image/png;base64,${Buffer.from(PNG).toString("base64")}` },
      },
    ]);
  });

  test("never takes Grading notes or the Card's text from the client", async () => {
    const { app, cookie, stub } = await signedIn();
    const { card } = await aCard(app, cookie);

    const res = await chat(app, cookie, card.id, { ...chatBody(), gradingNotes: "injected" });

    expect(res.status).toBe(400);
    expect(stub.asked).toHaveLength(0);
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
      const res = await chat(app, cookie, id);
      expect(res.status).toBe(404);
      expect(await codeOf(res)).toBe("not_found");
    }
    expect(stub.asked).toHaveLength(0);
  });

  test("answers 400 invalid_request for a blank message, one over 20,000 characters, or a chat that doesn't end with the User's, without asking OpenRouter", async () => {
    const { app, cookie, stub } = await signedIn();
    const { card } = await aCard(app, cookie);

    for (const messages of [
      [{ role: "user", text: " \n\t" }],
      [{ role: "user", text: "x".repeat(20_001) }],
      [
        { role: "user", text: "Why?" },
        { role: "grader", text: "Because." },
      ],
      [],
    ]) {
      const res = await chat(app, cookie, card.id, chatBody({ messages }));
      expect(res.status).toBe(400);
      expect(await codeOf(res)).toBe("invalid_request");
    }
    for (const body of [chatBody({ answer: "" }), chatBody({ grade: { rating: "perfect" } })]) {
      expect((await chat(app, cookie, card.id, body)).status).toBe(400);
    }
    expect(stub.asked).toHaveLength(0);
    const res = await chat(
      app,
      cookie,
      card.id,
      chatBody({ messages: [{ role: "user", text: "x".repeat(20_000) }] }),
    );
    expect(res.status).toBe(200);
  });

  test("answers 409 no_api_key when no API key is stored, without asking OpenRouter", async () => {
    const { app, cookie, stub } = await signedIn(openRouter(), { apiKey: false });
    const { card } = await aCard(app, cookie);

    const res = await chat(app, cookie, card.id);

    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("no_api_key");
    expect(stub.asked).toHaveLength(0);
  });

  test("answers 401 unauthorized when signed out", async () => {
    const { app, cookie } = await signedIn();
    const { card } = await aCard(app, cookie);

    expect((await chat(app, "", card.id)).status).toBe(401);
  });

  test("a stream that breaks after the first word stops without its end", async () => {
    const { app, cookie } = await signedIn(
      openRouter(() => streamed(["Because ", "the"], { cut: true })),
    );
    const { card } = await aCard(app, cookie);

    const res = await chat(app, cookie, card.id);

    expect(res.status).toBe(200);
    expect(await readReply(res)).toEqual({ text: "Because the", pieces: 2, ended: false });
    const cut = logs.filter((record) => record.message.join("").includes("cut off"));
    expect(cut).toHaveLength(1);
  });

  test("an error OpenRouter sends in the stream, after the first word, cuts it off too", async () => {
    const { app, cookie } = await signedIn(
      openRouter(
        () =>
          new Response(
            piece("Because ") +
              event({ error: { code: 502 }, choices: [{ delta: {}, finish_reason: "error" }] }),
          ),
      ),
    );
    const { card } = await aCard(app, cookie);

    expect(await readReply(await chat(app, cookie, card.id))).toEqual({
      text: "Because ",
      pieces: 1,
      ended: false,
    });
  });

  describe("when OpenRouter fails before the first word", () => {
    const temporary: [string, () => Promise<Response> | Response, number | null, number][] = [
      ["a 500", () => Response.json({ error: { code: 500 } }, { status: 500 }), 500, 6],
      ["a 429", () => Response.json({ error: { code: 429 } }, { status: 429 }), 429, 6],
      [
        "a network error",
        () => {
          throw new TypeError("fetch failed");
        },
        null,
        6,
      ],
      [
        "the timeout",
        () => {
          throw new DOMException("The operation timed out.", "TimeoutError");
        },
        null,
        1,
      ],
      [
        "a 429 with a Retry-After over 8 s",
        () =>
          Response.json(
            { error: { code: 429 } },
            { status: 429, headers: { "retry-after": "30" } },
          ),
        429,
        1,
      ],
      ["a stream that breaks before a word", () => streamed([], { cut: true }), 200, 6],
      ["a stream that finishes with no words", () => streamed([]), 200, 6],
      ["a stream that isn't JSON", () => new Response("data: nope\n\n"), 200, 6],
    ];

    for (const [what, answer, status, attempts] of temporary) {
      test(`answers 502 grading_failed on ${what} after ${attempts} attempt(s), logging the status and the Model only`, async () => {
        const { app, cookie, stub } = await signedIn(openRouter(answer));
        await send(app, "PATCH", "/api/settings", { model: "google/gemini-3.8-flash" }, cookie);
        const deck = await createDeck(app, cookie);
        const card = await createCard(app, cookie, deck.id, {
          front: "secret front",
          back: "secret back",
          gradingNotes: "secret notes",
        });

        const res = await chat(
          app,
          cookie,
          card.id,
          chatBody({
            answer: "secret answer",
            messages: [{ role: "user", text: "secret question" }],
          }),
        );

        expect(res.status).toBe(502);
        expect(ApiError.parse(await res.json()).error).toEqual({
          code: "grading_failed",
          message: "Couldn't answer. Try again.",
        });
        expect(stub.asked).toHaveLength(attempts);
        const failures = logs.filter((record) => record.category.join(".") === "banki.grader");
        expect(failures).toHaveLength(attempts);
        expect(failures.map((record) => record.properties)).toEqual(
          failures.map((_, i) =>
            expect.objectContaining({ attempt: i + 1, status, model: "google/gemini-3.8-flash" }),
          ),
        );
        const logged = JSON.stringify(logs.map((record) => [record.message, record.properties]));
        for (const secret of [
          "secret front",
          "secret back",
          "secret notes",
          "secret answer",
          "secret question",
          API_KEY,
        ]) {
          expect(logged).not.toContain(secret);
        }
      });
    }

    test("streams the reply when a retry succeeds", async () => {
      let calls = 0;
      const { app, cookie, stub } = await signedIn(
        openRouter(() => {
          calls += 1;
          return calls < 3 ? new Response("", { status: 503 }) : streamed(["Yes."]);
        }),
      );
      const { card } = await aCard(app, cookie);

      const res = await chat(app, cookie, card.id);

      expect(res.status).toBe(200);
      expect((await readReply(res)).text).toBe("Yes.");
      expect(stub.asked).toHaveLength(3);
    });

    const permanent: [number, string, string][] = [
      [401, "api_key_refused", "OpenRouter didn't accept your API key. Check it in Settings."],
      [402, "no_credits", "Your OpenRouter account is out of credits. Add some, then try again."],
      [
        404,
        "model_unavailable",
        "OpenRouter can't run Gemini 3.8 Flash right now. Pick another Model in Settings.",
      ],
      [400, "grading_refused", "OpenRouter refused to answer this."],
      [413, "grading_refused", "OpenRouter refused to answer this."],
    ];

    for (const [status, code, message] of permanent) {
      test(`answers 502 ${code} on a ${status} at once, with no retry`, async () => {
        const { app, cookie, stub } = await signedIn(
          openRouter(() => Response.json({ error: { code: status } }, { status })),
        );
        await send(app, "PATCH", "/api/settings", { model: "google/gemini-3.8-flash" }, cookie);
        const { card } = await aCard(app, cookie);

        const res = await chat(app, cookie, card.id);

        expect(res.status).toBe(502);
        expect(ApiError.parse(await res.json()).error).toEqual({ code, message });
        expect(stub.asked).toHaveLength(1);
      });
    }

    test("stops retrying once the client aborts the request", async () => {
      const controller = new AbortController();
      const waits: number[] = [];
      let calls = 0;
      const booted = boot(
        {},
        {
          openRouterFetch: async (url) => {
            if (url === "https://openrouter.ai/api/v1/key") return Response.json({ data: {} });
            calls += 1;
            return new Response("", { status: 500 });
          },
          // The client gives up during the first wait, which ends with it.
          graderWait: (ms, signal) => {
            waits.push(ms);
            controller.abort();
            return signal?.aborted
              ? Promise.resolve()
              : new Promise((resolve) => signal?.addEventListener("abort", () => resolve()));
          },
        },
      );
      const cookie = await setUp(booted);
      await send(booted.app, "PUT", "/api/settings/api-key", { apiKey: API_KEY }, cookie);
      const { card } = await aCard(booted.app, cookie);

      await Promise.resolve(
        booted.app.request(`/api/cards/${card.id}/chat`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: ORIGIN, cookie },
          body: JSON.stringify(chatBody()),
          signal: controller.signal,
        }),
      ).catch(() => undefined);

      expect(calls).toBe(1);
      expect(waits).toHaveLength(1);
    });
  });

  test("stops OpenRouter's stream once the client stops reading", async () => {
    let cancelled = false;
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(piece("Because ")));
      },
      cancel() {
        cancelled = true;
      },
    });
    const { app, cookie } = await signedIn(openRouter(() => new Response(upstream)));
    const { card } = await aCard(app, cookie);

    const res = await chat(app, cookie, card.id);
    const reader = res.body?.getReader();
    const first = await reader?.read();
    await reader?.cancel();

    expect(new TextDecoder().decode(first?.value)).toBe('{"text":"Because "}\n');
    expect(cancelled).toBe(true);
  });
});
