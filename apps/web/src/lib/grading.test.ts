import { MODELS, modelById } from "@banki/shared";
import { describe, expect, test, vi } from "vitest";
import { createApiClient } from "./api";
import {
  apiKeyProblem,
  apiKeyValue,
  matchModels,
  modelSaveErrorText,
  ratingsOf,
  removeApiKey,
  saveApiKey,
} from "./grading";

const SETTINGS = {
  timezone: "Europe/Warsaw",
  dayStartHour: 4,
  model: "anthropic/claude-haiku-5.5",
  apiKey: { state: "set", lastFour: "3f9a" },
  autoClose: "brackets",
} as const;

/** A fake API answering every request with `status` and `body`, recording what it was sent. */
function fakeApi(status: number, body: unknown) {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const request = new Request(new URL(url, "http://banki.test"), init);
    calls.push({
      method: request.method,
      path: new URL(request.url).pathname,
      body: request.method === "DELETE" ? undefined : await request.json(),
    });
    return Response.json(body, { status });
  });
  return { client: createApiClient(fetch), calls };
}

const refusal = (code: string) => ({ error: { code, message: "…" } });

describe("apiKeyValue", () => {
  test("shows only the last four characters of a stored key", () => {
    expect(apiKeyValue({ state: "set", lastFour: "3f9a" })).toBe("sk-or-…3f9a");
  });

  test("says when there is none", () => {
    expect(apiKeyValue({ state: "unset" })).toBe("Not set");
  });

  test("asks for an unreadable key again", () => {
    expect(apiKeyValue({ state: "unreadable" })).toBe("Can't be read. Enter it again.");
  });
});

describe("apiKeyProblem", () => {
  test.each(["", "   ", "\n"])("refuses %j, which trims to nothing", (typed) => {
    expect(apiKeyProblem(typed)).toBe("Enter the API key.");
  });

  test("refuses more than 200 characters after trimming", () => {
    expect(apiKeyProblem("k".repeat(201))).toMatch(/longer than 200 characters/);
    expect(apiKeyProblem(` ${"k".repeat(200)} `)).toBeUndefined();
  });

  test("takes any other key, with no format check", () => {
    expect(apiKeyProblem("not-even-an-sk-or-key")).toBeUndefined();
  });
});

describe("saveApiKey", () => {
  test("sends the trimmed key and answers the Settings, stamped when it went out", async () => {
    const { client, calls } = fakeApi(200, SETTINGS);
    const before = performance.now();

    const outcome = await saveApiKey("  sk-or-v1-abc3f9a\n", client);

    expect(calls).toEqual([
      { method: "PUT", path: "/api/settings/api-key", body: { apiKey: "sk-or-v1-abc3f9a" } },
    ]);
    expect(outcome).toEqual({
      ok: true,
      read: { settings: SETTINGS, issuedAt: expect.any(Number) },
    });
    if (outcome.ok) expect(outcome.read.issuedAt).toBeGreaterThanOrEqual(before);
  });

  test("says OpenRouter didn't accept a refused key", async () => {
    const { client } = fakeApi(422, refusal("api_key_refused"));

    expect(await saveApiKey("k", client)).toEqual({
      ok: false,
      message: "OpenRouter didn't accept this key.",
    });
  });

  test("asks to try again when OpenRouter can't be reached", async () => {
    const { client } = fakeApi(502, refusal("openrouter_unreachable"));

    expect(await saveApiKey("k", client)).toEqual({
      ok: false,
      message: "Couldn't reach OpenRouter. Try again.",
    });
  });

  test("says Banki couldn't save it on any other failure", async () => {
    const { client } = fakeApi(500, refusal("internal_error"));

    expect(await saveApiKey("k", client)).toEqual({
      ok: false,
      message: "Banki couldn't save the API key. Try again.",
    });
  });

  test("says Banki can't be reached on a network error", async () => {
    const client = createApiClient(async () => {
      throw new TypeError("Failed to fetch");
    });

    expect(await saveApiKey("k", client)).toEqual({
      ok: false,
      message: "Can't reach Banki. Check your connection and try again.",
    });
  });
});

describe("removeApiKey", () => {
  test("deletes the key and answers the Settings", async () => {
    const unset = { ...SETTINGS, apiKey: { state: "unset" } };
    const { client, calls } = fakeApi(200, unset);

    const outcome = await removeApiKey(client);

    expect(calls).toEqual([{ method: "DELETE", path: "/api/settings/api-key", body: undefined }]);
    expect(outcome).toMatchObject({ ok: true, read: { settings: unset } });
  });

  test("says when it couldn't", async () => {
    const { client } = fakeApi(500, refusal("internal_error"));

    expect(await removeApiKey(client)).toEqual({
      ok: false,
      message: "Banki couldn't remove the API key. Try again.",
    });
  });
});

describe("ratingsOf", () => {
  test("gives each Model's ratings in words for screen readers", () => {
    expect(MODELS.map((model) => ratingsOf(model).map((rating) => rating.words))).toEqual([
      ["Handwriting: good", "Speed: fast", "Cost: low"],
      ["Handwriting: good", "Speed: fast", "Cost: low"],
      ["Handwriting: untested", "Speed: moderate", "Cost: low"],
      ["Handwriting: very good", "Speed: moderate", "Cost: high"],
    ]);
  });

  test("marks handwriting Untested for GLM, dots for the rest, and cost in dollars", () => {
    const glm = ratingsOf(modelById("z-ai/glm-5.3-flash"));
    const gemini = ratingsOf(modelById("google/gemini-3.8-flash"));

    expect(glm.map(({ marks, filled }) => [marks, filled])).toEqual([
      ["untested", 0],
      ["dots", 2],
      ["dollars", 1],
    ]);
    expect(gemini.map(({ marks, filled }) => [marks, filled])).toEqual([
      ["dots", 3],
      ["dots", 2],
      ["dollars", 3],
    ]);
  });
});

describe("matchModels", () => {
  test("narrows by name or maker, keeping the list's order", () => {
    expect(matchModels(MODELS, "").map((model) => model.name)).toEqual(
      MODELS.map((model) => model.name),
    );
    expect(matchModels(MODELS, "google").map((model) => model.name)).toEqual(["Gemini 3.8 Flash"]);
    expect(matchModels(MODELS, " FLASH ").map((model) => model.name)).toEqual([
      "GLM-5.3 Flash",
      "Gemini 3.8 Flash",
    ]);
    expect(matchModels(MODELS, "mistral")).toEqual([]);
  });
});

describe("modelSaveErrorText", () => {
  test("says which Model is kept", () => {
    expect(
      modelSaveErrorText(modelById("google/gemini-3.8-flash"), modelById("openai/gpt-6-luna")),
    ).toBe("The change to Gemini 3.8 Flash didn't save, so the Model is still GPT-6 Luna.");
  });
});
