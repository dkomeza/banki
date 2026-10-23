import { describe, expect, test } from "bun:test";
import { asObject, asString } from "../lib/parse";
import { LinearTokens } from "./linear-tokens";
import { handler, type Services } from "./server";

// The broker's routes, with fake GitHub and Linear behind them.

// Fake values, built at runtime so secret scanners don't flag them.
const GITHUB_TOKEN = ["ghs", "faketoken"].join("_");
const CLIENT_SECRET = ["fake", "client", "secret"].join("-");

function setup(overrides: Partial<Services> = {}) {
  const logs: string[] = [];
  let minted = 0;
  const linear = new LinearTokens({
    mint: async () => `linear-token-${++minted}`,
    revoke: async () => undefined,
    newId: () => `0000000${minted}-aaaa`,
  });
  const handle = handler({
    githubToken: async () => GITHUB_TOKEN,
    identity: async () => ({ name: "banki-runner[bot]", email: "1+banki-runner[bot]@x" }),
    linear,
    secrets: () => [CLIENT_SECRET, GITHUB_TOKEN, ...linear.values()],
    log: (line) => logs.push(line),
    ...overrides,
  });
  const call = (method: string, path: string) =>
    handle(new Request(`http://broker${path}`, { method }));
  return { call, logs, linear };
}

describe("the broker", () => {
  test("hands out the GitHub token as plain text", async () => {
    const { call } = setup();

    const res = await call("GET", "/github/token");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(GITHUB_TOKEN);
  });

  test("says who to commit as", async () => {
    const { call } = setup();

    expect(await (await call("GET", "/github/identity")).json()).toEqual({
      name: "banki-runner[bot]",
      email: "1+banki-runner[bot]@x",
    });
  });

  test("issues a Linear token per request, and logs its ID but never the token", async () => {
    const { call, logs } = setup();

    const res = await call("POST", "/linear/tokens");
    const body = asObject(await res.json(), "body");

    expect(asString(body.token, "token")).toBe("linear-token-1");
    expect(asString(body.id, "id")).toBe("00000001-aaaa");
    expect(logs.join("\n")).toContain("00000001-aaaa");
    expect(logs.join("\n")).not.toContain("linear-token-1");
  });

  test("revokes a Linear token by its ID, once", async () => {
    const { call, linear } = setup();
    await call("POST", "/linear/tokens");

    expect((await call("DELETE", "/linear/tokens/00000001-aaaa")).status).toBe(204);
    expect(linear.live()).toBe(0);
    expect((await call("DELETE", "/linear/tokens/00000001-aaaa")).status).toBe(404);
  });

  test("answers 404 for anything else", async () => {
    const { call } = setup();

    expect((await call("POST", "/github/token")).status).toBe(404);
    expect((await call("GET", "/")).status).toBe(404);
    expect((await call("DELETE", "/linear/tokens/../x")).status).toBe(404);
  });

  test("a failure answers 502, and neither the answer nor the log holds a secret or a token", async () => {
    const leaky = new Error(`upstream echoed ${CLIENT_SECRET} and ${GITHUB_TOKEN}`);
    const { call, logs } = setup({ identity: () => Promise.reject(leaky) });

    const res = await call("GET", "/github/identity");
    const error = asString(asObject(await res.json(), "body").error, "error");

    expect(res.status).toBe(502);
    expect(error).toBe("GET /github/identity failed: upstream echoed [redacted] and [redacted]");
    expect(logs).toEqual([error]);
  });
});
