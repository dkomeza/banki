import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";

// The Docker HEALTHCHECK runs this script, and only its exit code reaches
// Docker, so these run it in a child process against a stand-in API.

const entry = join(import.meta.dir, "healthcheck.ts");
const stubs: Array<ReturnType<typeof Bun.serve>> = [];

afterEach(async () => {
  await Promise.all(stubs.splice(0).map((stub) => stub.stop(true)));
});

/** A stand-in API that answers every request with `status`, recording the paths it was asked for. */
const stubApi = (status: number) => {
  const paths: string[] = [];
  const stub = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (req) => {
      paths.push(new URL(req.url).pathname);
      return new Response(null, { status });
    },
  });
  stubs.push(stub);
  if (stub.port === undefined) throw new Error("no port");
  return { port: stub.port, paths };
};

const runHealthcheck = async (env: Record<string, string>) => {
  const check = Bun.spawn(["bun", entry], {
    env: { PATH: process.env.PATH, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: await check.exited,
    stderr: await new Response(check.stderr).text(),
  };
};

describe("the healthcheck script", () => {
  test("exits 0 when /api/health on PORT answers 2xx", async () => {
    const api = stubApi(200);

    expect((await runHealthcheck({ PORT: String(api.port) })).exitCode).toBe(0);
    expect(api.paths).toEqual(["/api/health"]);
  });

  test("exits 1 when /api/health answers non-2xx", async () => {
    const api = stubApi(503);

    const result = await runHealthcheck({ PORT: String(api.port) });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("503");
  });

  test("exits 1 when nothing is listening", async () => {
    const api = stubApi(200);
    const { port } = api;
    await stubs.pop()?.stop(true);

    expect((await runHealthcheck({ PORT: String(port) })).exitCode).toBe(1);
  });
});
