import { describe, expect, test } from "bun:test";
import { OPENROUTER_KEY_URL, type OpenRouterFetch, checkApiKey } from "./check-api-key";

const answering =
  (status: number): OpenRouterFetch =>
  async () =>
    new Response("{}", { status });

const failing: OpenRouterFetch = async () => {
  throw new TypeError("fetch failed");
};

/** Never answers, until the request is aborted. */
const hanging: OpenRouterFetch = (_, init) =>
  new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  });

describe("checkApiKey", () => {
  test("asks OpenRouter's /api/v1/key with the key as a bearer token", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetch: OpenRouterFetch = async (url, init) => {
      calls.push({ url, init });
      return new Response("{}", { status: 200 });
    };

    expect(await checkApiKey("sk-or-v1-abc", { fetch })).toBe("accepted");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(OPENROUTER_KEY_URL);
    expect(new Headers(calls[0]?.init.headers).get("authorization")).toBe("Bearer sk-or-v1-abc");
    expect(calls[0]?.init.method ?? "GET").toBe("GET");
  });

  test("is refused on a 401", async () => {
    expect(await checkApiKey("k", { fetch: answering(401) })).toBe("refused");
  });

  test.each([402, 403, 429, 500, 503])("can't reach OpenRouter on a %d", async (status) => {
    expect(await checkApiKey("k", { fetch: answering(status) })).toBe("unreachable");
  });

  test("can't reach OpenRouter on a network error", async () => {
    expect(await checkApiKey("k", { fetch: failing })).toBe("unreachable");
  });

  test("gives up after the timeout", async () => {
    expect(await checkApiKey("k", { fetch: hanging, timeoutMs: 20 })).toBe("unreachable");
  });
});
