import { describe, expect, test } from "bun:test";
import { CARD_FILE_JSON_SCHEMA, CARD_FILE_SCHEMA_PATH } from "@banki/shared";
import { bootApps, codeOf, get, setUp } from "../testing/app";

const { boot } = bootApps();

describe("GET /api/schemas/card-file-v1.json", () => {
  test("answers the Card file's JSON Schema without signing in", async () => {
    const res = await get(boot().app, CARD_FILE_SCHEMA_PATH);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/schema+json");
    expect(await res.json()).toEqual(CARD_FILE_JSON_SCHEMA);
  });

  test("answers it before Setup and when signed in alike", async () => {
    const booted = boot();
    const before = await (await get(booted.app, CARD_FILE_SCHEMA_PATH)).text();
    const cookie = await setUp(booted);

    const res = await get(booted.app, CARD_FILE_SCHEMA_PATH, cookie);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(before);
  });

  test("leaves the other methods on it to the sign-in check", async () => {
    const res = await boot().app.request(CARD_FILE_SCHEMA_PATH, { method: "POST" });

    expect(res.status).toBe(401);
    expect(await codeOf(res)).toBe("unauthorized");
  });
});
