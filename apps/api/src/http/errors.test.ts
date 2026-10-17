import { describe, expect, test } from "bun:test";
import { ApiError } from "@banki/shared";
import { Hono } from "hono";
import { captureLogs } from "../testing/logs";
import { internalError } from "./errors";

const records = captureLogs();

describe("an unhandled error", () => {
  const thrown = new Error("SQLITE_CORRUPT: /data/banki.db is malformed");
  const app = new Hono()
    .get("/api/boom", () => {
      throw thrown;
    })
    .onError(internalError);

  test("answers a JSON 500 internal_error that reveals nothing about it", async () => {
    const res = await app.request("/api/boom");

    expect(res.status).toBe(500);
    const text = await res.text();
    expect(ApiError.parse(JSON.parse(text))).toEqual({
      error: { code: "internal_error", message: "Internal server error" },
    });
    expect(text).not.toContain("SQLITE");
  });

  test("is logged at error with the error attached", async () => {
    await app.request("/api/boom");

    const logged = records.filter((record) => record.level === "error");
    expect(logged).toHaveLength(1);
    expect(logged[0]?.category).toEqual(["banki", "http"]);
    expect(logged[0]?.properties).toMatchObject({
      method: "GET",
      path: "/api/boom",
      error: thrown,
    });
  });
});
