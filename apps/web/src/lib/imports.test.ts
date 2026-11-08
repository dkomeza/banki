import { QueryClient } from "@tanstack/react-query";
import { describe, expect, test, vi } from "vitest";
import { createApiClient } from "./api";
import { CANT_REACH } from "./decks";
import { confirmImport, importQueryOptions, uploadImport } from "./imports";

/** A client answering every request with `res()`, recording each request. */
const answering = (res: () => Response) => {
  const sent: { url: string; init: RequestInit | undefined }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: input instanceof Request ? input.url : input.toString(), init });
    return res();
  });
  return { client: createApiClient(fetch), sent };
};

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const REPORT = {
  id: "i",
  deckId: "d",
  fileName: "f.json",
  source: "json",
  total: 1,
  invalid: [],
  createdAt: "2026-10-26T12:00:00.000Z",
  status: "confirmed",
  confirmedAt: "2026-10-26T12:01:00.000Z",
  imported: 1,
  leftOut: 0,
  duplicates: [],
  macros: [],
  images: [],
  imageCount: 0,
};

describe("uploadImport", () => {
  test("sends pasted text or a file as the body, saying which, and answers the Import's ID", async () => {
    const { client, sent } = answering(() => json({ id: "i" }, 201));
    expect(await uploadImport("d", { kind: "paste", text: "{}" }, client)).toEqual({
      ok: true,
      id: "i",
    });
    const file = new File(["PK"], "deck.zip");
    await uploadImport("d", { kind: "file", file }, client);
    expect(sent[0]?.url).toMatch(/\/api\/decks\/d\/imports\?kind=paste$/);
    expect(sent[0]?.init?.body).toBe("{}");
    expect(sent[1]?.url).toMatch(/kind=file&name=deck\.zip$/);
    expect(sent[1]?.init?.body).toBe(file);
  });

  test("answers a refused file's problems, and a message when it can't reach Banki", async () => {
    const refused = answering(() =>
      json(
        {
          error: { code: "import_refused", message: "x" },
          problems: [{ text: "file: Not valid JSON" }],
        },
        422,
      ),
    );
    expect(await uploadImport("d", { kind: "paste", text: "```" }, refused.client)).toEqual({
      ok: false,
      problems: [{ text: "file: Not valid JSON" }],
    });
    const offline = createApiClient(async () => {
      throw new TypeError("offline");
    });
    expect(await uploadImport("d", { kind: "paste", text: "{}" }, offline)).toEqual({
      ok: false,
      message: CANT_REACH,
    });
  });
});

describe("confirmImport", () => {
  test("sends the ticked Cards and puts the report in the cache", async () => {
    const queryClient = new QueryClient();
    const { client, sent } = answering(() => json(REPORT, 200));
    const card = { number: 1, front: "a", back: "b", tags: [], gradingNotes: null };
    expect(await confirmImport(queryClient, "i", "d", [card], client)).toEqual({ ok: true });
    const body = sent[0]?.init?.body;
    expect(typeof body === "string" ? JSON.parse(body) : body).toEqual({ cards: [card] });
    expect(queryClient.getQueryData(importQueryOptions("i").queryKey)).toMatchObject({
      status: "confirmed",
    });
  });

  test("answers the API's message when it is refused", async () => {
    const { client } = answering(() =>
      json({ error: { code: "deck_gone", message: "The deck was deleted" } }, 409),
    );
    expect(await confirmImport(new QueryClient(), "i", "d", [], client)).toEqual({
      ok: false,
      message: "The deck was deleted",
    });
  });
});
