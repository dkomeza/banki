import { describe, expect, test } from "vitest";
import { createApiClient } from "./api";
import { checkHealth, healthStatusLine } from "./health";

const clock = (...readings: number[]) => {
  const remaining = [...readings];
  return () => {
    const reading = remaining.shift();
    if (reading === undefined) throw new Error("clock read more often than expected");
    return reading;
  };
};

// hc is created with a relative base URL, as the browser resolves it against the page.
const BASE = "http://banki.test";

const respondWith =
  (response: () => Response | Promise<Response>, requests: Request[] = []): typeof fetch =>
  async (input, init) => {
    requests.push(new Request(new URL(input instanceof Request ? input.url : input, BASE), init));
    return response();
  };

describe("checkHealth", () => {
  test("asks the API's health endpoint", async () => {
    const requests: Request[] = [];
    const client = createApiClient(
      respondWith(() => Response.json({ status: "ok", database: "ok" }), requests),
    );

    await checkHealth(client, clock(0, 1));

    expect(requests.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      "GET /api/health",
    ]);
  });

  test("returns the body with the round trip rounded to whole milliseconds", async () => {
    const client = createApiClient(
      respondWith(() => Response.json({ status: "ok", database: "ok" })),
    );

    await expect(checkHealth(client, clock(100.2, 112.7))).resolves.toEqual({
      status: "ok",
      database: "ok",
      latencyMs: 13,
    });
  });

  test("rejects when the API answers with a non-2xx status", async () => {
    const client = createApiClient(
      respondWith(() => Response.json({ error: "down" }, { status: 503 })),
    );

    await expect(checkHealth(client, clock(0, 1))).rejects.toThrow(/503/);
  });

  test("rejects when the API can't be reached", async () => {
    const client = createApiClient(
      respondWith(() => Promise.reject(new TypeError("Failed to fetch"))),
    );

    await expect(checkHealth(client, clock(0, 1))).rejects.toThrow("Failed to fetch");
  });
});

describe("healthStatusLine", () => {
  test("says the API is being checked while the query is pending", () => {
    expect(healthStatusLine({ status: "pending" })).toBe("Checking API…");
  });

  test("says the API is up, with the latency, on success", () => {
    expect(
      healthStatusLine({
        status: "success",
        data: { status: "ok", database: "ok", latencyMs: 12 },
      }),
    ).toBe("API is up · 12 ms");
  });

  test("says the API is unreachable on any error", () => {
    expect(healthStatusLine({ status: "error" })).toBe("API is unreachable");
  });
});
