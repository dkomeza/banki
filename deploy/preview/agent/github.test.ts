import { describe, expect, test } from "bun:test";
import { decodePayload, prOfPayload } from "./github";

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
