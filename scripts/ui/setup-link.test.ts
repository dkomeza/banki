import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { setupLinkFromLog } from "./setup-link.ts";

const record = (message: string, properties: Record<string, unknown>) =>
  JSON.stringify({
    "@timestamp": "2026-10-19T10:00:00.000Z",
    level: "WARN",
    message,
    logger: "banki.setup.announcement",
    properties,
  });

const announcement = (token: string) =>
  record(`Banki isn't set up yet. To set it up, open http://localhost:5174/setup?token=${token}`, {
    setupUrl: `http://localhost:5174/setup?token=${token}`,
    setupToken: token,
  });

describe("setupLinkFromLog", () => {
  test("finds the Setup token and link the API logged", () => {
    const log = [
      record("API starting /tmp/data", { dataDir: "/tmp/data" }),
      announcement("tok-1"),
      record("Listening 5175", { port: 5175 }),
    ].join("\n");
    assert.deepEqual(setupLinkFromLog(log), {
      token: "tok-1",
      url: "http://localhost:5174/setup?token=tok-1",
    });
  });

  test("takes the latest one, since a restart replaces the token", () => {
    const log = [announcement("old"), "[bun] restarting", announcement("new"), ""].join("\n");
    assert.equal(setupLinkFromLog(log)?.token, "new");
  });

  test("skips lines that aren't JSON log records", () => {
    const log = ["$ bun --watch src/server.ts", "{not json", announcement("tok"), "  "].join("\n");
    assert.equal(setupLinkFromLog(log)?.token, "tok");
  });

  test("is undefined when no Setup token was logged", () => {
    assert.equal(setupLinkFromLog(""), undefined);
    assert.equal(setupLinkFromLog(record("Listening 5175", { port: 5175 })), undefined);
    assert.equal(setupLinkFromLog(record("odd", { setupToken: 42 })), undefined);
    assert.equal(setupLinkFromLog("[1,2,3]\nnull"), undefined);
  });
});
