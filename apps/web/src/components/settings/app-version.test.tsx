import type { HealthResponse } from "@banki/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { createApiClient } from "@/lib/api";
import { healthQueryOptions } from "@/lib/version";
import { AppVersion, VersionLine } from "./app-version";

const SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const health = (build: Pick<HealthResponse, "commit" | "release">): HealthResponse => ({
  status: "ok",
  database: "ok",
  version: "0.3.0",
  ...build,
});

/** The line's markup with its tags dropped, for reading what it says. */
const text = (markup: string) => markup.replaceAll(/<[^>]+>/g, "");

describe("VersionLine", () => {
  test("links a Release to its notes, in a new tab, with an external-link icon", () => {
    const out = renderToStaticMarkup(
      <VersionLine health={health({ commit: SHA, release: true })} />,
    );

    expect(text(out)).toBe("Banki 0.3.0(opens in a new tab)");
    expect(out).toContain('href="https://github.com/dkomeza/banki/releases/tag/v0.3.0"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain("lucide-external-link");
  });

  test("links any other build with a commit to the commit, in a new tab", () => {
    const out = renderToStaticMarkup(
      <VersionLine health={health({ commit: SHA, release: false })} />,
    );

    expect(text(out)).toBe("Banki 0.3.0+a1b2c3d(opens in a new tab)");
    expect(out).toContain(`href="https://github.com/dkomeza/banki/commit/${SHA}"`);
    expect(out).toContain('target="_blank"');
    expect(out).toContain("lucide-external-link");
  });

  test("keeps the link muted, not in the accent every other link gets", () => {
    const out = renderToStaticMarkup(
      <VersionLine health={health({ commit: SHA, release: false })} />,
    );

    expect(out).toMatch(/<a [^>]*class="[^"]*\btext-muted-foreground\b/);
  });

  test("shows a build with no commit as +dev, in plain text", () => {
    const out = renderToStaticMarkup(
      <VersionLine health={health({ commit: "dev", release: false })} />,
    );

    expect(text(out)).toBe("Banki 0.3.0+dev");
    expect(out).not.toContain("<a");
    expect(out).not.toContain("lucide-external-link");
  });
});

/** The Settings line as the page renders it, with `queryClient` holding its query. */
const render = (queryClient: QueryClient) =>
  renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AppVersion />
    </QueryClientProvider>,
  );

describe("AppVersion", () => {
  test("shows nothing while /api/health hasn't answered", () => {
    expect(render(new QueryClient())).toBe("");
  });

  test("shows nothing when /api/health fails", async () => {
    const queryClient = new QueryClient();
    const failing = createApiClient(async () => new Response(null, { status: 503 }));
    await queryClient.prefetchQuery({ ...healthQueryOptions(failing), retry: false });

    expect(queryClient.getQueryState(healthQueryOptions().queryKey)?.status).toBe("error");
    expect(render(queryClient)).toBe("");
  });

  test("shows the line once /api/health has answered", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(
      healthQueryOptions().queryKey,
      health({ commit: "dev", release: false }),
    );

    expect(text(render(queryClient))).toBe("Banki 0.3.0+dev");
  });
});
