import { describe, expect, spyOn, test } from "bun:test";
import { decodePayload, parseSlugDeployment, prOfPayload } from "./github";
import { planSlugs } from "./slug-planner";

// GraphQL's `Deployment.payload` for a Deployment created with
// `payload: { pr: 25 }`, exactly as GitHub returns it: the JSON object,
// encoded as a JSON string, encoded again.
const GRAPHQL_PAYLOAD = JSON.parse(String.raw`"\"{\\\"pr\\\":25}\""`) as unknown;

describe("prOfPayload", () => {
  test("GraphQL's payload, JSON-encoded twice", () => {
    expect(GRAPHQL_PAYLOAD).toBe(String.raw`"{\"pr\":25}"`);
    expect(prOfPayload(GRAPHQL_PAYLOAD)).toBe(25);
  });

  test("a payload encoded once, or already an object", () => {
    expect(prOfPayload('{"pr":25}')).toBe(25);
    expect(prOfPayload({ pr: 25 })).toBe(25);
  });

  test("anything without a positive integer `pr` isn't the agent's", () => {
    for (const payload of [
      null,
      "",
      "{}",
      "not json",
      '{"pr":"25"}',
      '{"pr":0}',
      '{"pr":2.5}',
      JSON.stringify(JSON.stringify(JSON.stringify(JSON.stringify({ pr: 25 })))),
    ]) {
      expect(prOfPayload(payload)).toBeUndefined();
    }
  });
});

describe("decodePayload", () => {
  test("decodes a slug-preview payload however many times GraphQL encoded it, up to three", () => {
    const payload = { slug: "blue", ref: "proto/blue", sha: "a".repeat(40), ttlHours: 72 };

    expect(decodePayload(payload)).toEqual(payload);
    expect(decodePayload(JSON.stringify(payload))).toEqual(payload);
    expect(decodePayload(JSON.stringify(JSON.stringify(payload)))).toEqual(payload);
  });

  test("gives undefined for what isn't JSON, or is still a string after three decodes", () => {
    expect(decodePayload("not json")).toBeUndefined();
    expect(
      decodePayload(JSON.stringify(JSON.stringify(JSON.stringify(JSON.stringify("x"))))),
    ).toBeUndefined();
  });
});

describe("parseSlugDeployment", () => {
  const node = {
    databaseId: 9,
    commitOid: "a".repeat(40),
    createdAt: "2026-10-20T11:00:00Z",
    payload: JSON.stringify(JSON.stringify({ slug: "blue" })),
    latestStatus: { state: "QUEUED", description: "waiting" },
  };

  test("reads a slug-preview node with its payload decoded", () => {
    expect(parseSlugDeployment(node)).toEqual({
      id: 9,
      sha: "a".repeat(40),
      createdAt: new Date("2026-10-20T11:00:00Z"),
      status: "queued",
      description: "waiting",
      payload: { slug: "blue" },
    });
  });

  test("gives a malformed node with an ID no payload, so the planner marks it invalid", () => {
    const broken = parseSlugDeployment({ ...node, createdAt: 5, latestStatus: { state: 7 } });

    expect(broken).toMatchObject({ id: 9, payload: undefined, status: undefined });
    expect(
      planSlugs({
        projects: [],
        deployments: broken === undefined ? [] : [broken],
        images: [],
        resources: [],
        siteId: 7,
        limits: { cap: 9 },
        now: new Date(),
      }),
    ).toEqual([{ pool: "slug", kind: "mark-invalid", deploymentId: 9 }]);
  });

  test("skips a node with no ID instead of failing the whole read", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(parseSlugDeployment({ ...node, databaseId: null })).toBeUndefined();
      expect(parseSlugDeployment("garbage")).toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  });
});
