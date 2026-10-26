import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SEED_NOW } from "../../apps/api/src/seed/seed-ids.ts";
import { apiEnv, webEnv } from "./stack-env.ts";

const ports = { dataDir: "/wt/.ui/data-1-a", apiPort: 5175, webPort: 5174 };

describe("apiEnv", () => {
  test("points the API at the stack's own data directory, port and origin", () => {
    const env = apiEnv({ PATH: "/bin" }, ports);
    assert.equal(env["DATA_DIR"], "/wt/.ui/data-1-a");
    assert.equal(env["PORT"], "5175");
    assert.equal(env["ORIGIN"], "http://localhost:5174");
    assert.equal(env["PATH"], "/bin");
  });

  test("logs JSON lines, so the Setup token can be read back", () => {
    const env = apiEnv({ LOG_FORMAT: "pretty", LOG_LEVEL: "error" }, ports);
    assert.equal(env["LOG_FORMAT"], "json");
    assert.equal(env["LOG_LEVEL"], "info");
  });

  test("seeds at the fixed seed time, whatever the caller's shell says", () => {
    const env = apiEnv({ BANKI_SEED_NOW: "2020-01-01T00:00:00.000Z" }, ports);
    assert.equal(env["BANKI_SEED_NOW"], SEED_NOW);
  });

  test("overrides a DATA_DIR, PORT or ORIGIN from the caller's shell", () => {
    const env = apiEnv(
      { DATA_DIR: ".data", PORT: "3000", ORIGIN: "http://localhost:5173", AUTH_SECRET: "x" },
      ports,
    );
    assert.equal(env["DATA_DIR"], "/wt/.ui/data-1-a");
    assert.equal(env["PORT"], "5175");
    assert.equal(env["ORIGIN"], "http://localhost:5174");
    assert.equal(env["AUTH_SECRET"], undefined);
  });
});

describe("webEnv", () => {
  test("proxies /api to the stack's API", () => {
    const env = webEnv({ API_URL: "http://localhost:3000", WEB_PORT: "5173" }, ports);
    assert.equal(env["API_URL"], "http://localhost:5175");
    assert.equal(env["WEB_PORT"], "5174");
  });
});
