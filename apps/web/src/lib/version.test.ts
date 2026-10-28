import { QueryClient } from "@tanstack/react-query";
import { describe, expect, test, vi } from "vitest";
import { createApiClient } from "./api";
import { ApiRequestError } from "./query";
import { healthQueryOptions, versionLabel } from "./version";

const SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

describe("versionLabel", () => {
  test("shows a Release as its number, linking to its notes", () => {
    expect(versionLabel({ version: "0.3.0", commit: SHA, release: true })).toEqual({
      text: "0.3.0",
      href: "https://github.com/dkomeza/banki/releases/tag/v0.3.0",
    });
  });

  test("shows any other build with a commit with its short commit, linking to the commit", () => {
    expect(versionLabel({ version: "0.3.0", commit: SHA, release: false })).toEqual({
      text: "0.3.0+a1b2c3d",
      href: `https://github.com/dkomeza/banki/commit/${SHA}`,
    });
  });

  test("shows a build with no commit as +dev, linking nowhere", () => {
    expect(versionLabel({ version: "0.3.0", commit: "dev", release: false })).toEqual({
      text: "0.3.0+dev",
      href: undefined,
    });
  });

  test("shows a self-built Release as a Release: RELEASE decides, not the build", () => {
    expect(versionLabel({ version: "0.3.0", commit: "dev", release: true }).text).toBe("0.3.0");
  });
});

/** A fake API answering `/api/health` with `response`. */
const fakeApi = (response: () => Response) => {
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    expect(new URL(url, "http://banki.test").pathname).toBe("/api/health");
    return response();
  });
  return createApiClient(fetch);
};

describe("healthQueryOptions", () => {
  test("reads the build from /api/health", async () => {
    const health = { status: "ok", database: "ok", version: "0.3.0", commit: SHA, release: false };
    const client = fakeApi(() => Response.json(health));

    expect(await new QueryClient().fetchQuery(healthQueryOptions(client))).toEqual(health);
  });

  test("fails when /api/health does", async () => {
    const client = fakeApi(() => new Response(null, { status: 503 }));

    await expect(new QueryClient().fetchQuery(healthQueryOptions(client))).rejects.toEqual(
      new ApiRequestError(503),
    );
  });
});
