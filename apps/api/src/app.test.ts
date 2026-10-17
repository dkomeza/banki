import { describe, expect, test } from "bun:test";
import { HealthResponse } from "@banki/shared";
import { app } from "./app";

describe("GET /api/health", () => {
  test("answers 200 with a body matching the shared HealthResponse schema", async () => {
    const res = await app.request("/api/health");

    expect(res.status).toBe(200);
    expect(HealthResponse.parse(await res.json())).toEqual({ status: "ok" });
  });

  test("is only served under the /api base path", async () => {
    const res = await app.request("/health");

    expect(res.status).toBe(404);
  });
});
