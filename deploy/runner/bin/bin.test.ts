import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The wrappers on the runner's and the Dashboard's PATH, run for real against a fake Broker on a
// Unix socket. Skipped without curl, which they reach the socket with.

const hasCurl = Bun.which("curl") !== null;
const dir = mkdtempSync(join(tmpdir(), "bkr-bin-"));
const socket = join(dir, "broker.sock");
const BIN = import.meta.dir;

// A fake value, built at runtime so secret scanners don't flag it.
const TOKEN = ["ghs", "faketoken", "from", "broker"].join("_");

let server: ReturnType<typeof Bun.serve> | undefined;
let answer: { status: number; body: string } = { status: 200, body: TOKEN };
beforeAll(() => {
  if (!hasCurl) return;
  server = Bun.serve({
    unix: socket,
    fetch: (request) =>
      new URL(request.url).pathname === "/github/token"
        ? new Response(answer.body, { status: answer.status })
        : new Response("no", { status: 404 }),
  });
});
afterAll(async () => {
  await server?.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

/** A stand-in for the real gh: prints its token and arguments, and exits 3. */
const fakeGh = join(dir, "real-gh");
writeFileSync(fakeGh, '#!/bin/sh\nprintf "%s|%s" "$GH_TOKEN" "$*"\nexit 3\n', { mode: 0o755 });

async function sh(argv: string[], env: Record<string, string> = {}, stdin = "") {
  const proc = Bun.spawn(argv, {
    env: { PATH: process.env.PATH ?? "", BANKI_BROKER_SOCKET: socket, ...env },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.stdin.write(stdin);
  await proc.stdin.end();
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("the scripts", () => {
  test.each(["gh", "git-credential-banki", "runner", "dashboard"])(
    "%s passes sh -n",
    async (name) => {
      expect((await sh(["sh", "-n", join(BIN, name)])).exitCode).toBe(0);
    },
  );

  test.skipIf(Bun.which("shellcheck") === null)("pass shellcheck", async () => {
    const result = await sh([
      "shellcheck",
      ...["gh", "git-credential-banki", "runner", "dashboard"].map((n) => join(BIN, n)),
    ]);
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(0);
  });
});

describe.skipIf(!hasCurl)("the gh wrapper", () => {
  test("runs the real gh with a token from the broker, passing its arguments and exit code", async () => {
    answer = { status: 200, body: TOKEN };

    const result = await sh([join(BIN, "gh"), "pr", "view", "--json", "number"], {
      BANKI_REAL_GH: fakeGh,
    });

    expect(result.stdout).toBe(`${TOKEN}|pr view --json number`);
    expect(result.exitCode).toBe(3);
  });

  test("fails, saying why, when the broker has no token to give", async () => {
    answer = { status: 502, body: '{"error":"GET /github/token failed: HTTP 401"}' };

    const result = await sh([join(BIN, "gh"), "pr", "list"], { BANKI_REAL_GH: fakeGh });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("the broker gave no GitHub token");
    expect(result.stderr).toContain("HTTP 401");
  });

  test("fails when the broker isn't there", async () => {
    const result = await sh([join(BIN, "gh"), "pr", "list"], {
      BANKI_REAL_GH: fakeGh,
      BANKI_BROKER_SOCKET: join(dir, "missing.sock"),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("the broker gave no GitHub token");
  });
});

describe.skipIf(!hasCurl || Bun.which("git") === null)("the git credential helper", () => {
  test("gives git the broker's token for github.com", async () => {
    answer = { status: 200, body: TOKEN };

    const result = await sh(
      [
        "git",
        "-c",
        `credential.https://github.com.helper=${join(BIN, "git-credential-banki")}`,
        "credential",
        "fill",
      ],
      { GIT_TERMINAL_PROMPT: "0", HOME: dir },
      "protocol=https\nhost=github.com\npath=dkomeza/banki.git\n\n",
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("username=x-access-token\n");
    expect(result.stdout).toContain(`password=${TOKEN}\n`);
  });

  test("stores and erases nothing", async () => {
    for (const action of ["store", "erase"]) {
      const result = await sh(
        [join(BIN, "git-credential-banki"), action],
        {},
        "host=github.com\n\n",
      );
      expect(result).toEqual({ stdout: "", stderr: "", exitCode: 0 });
    }
  });

  test("gives git nothing when the broker fails, so the push fails", async () => {
    answer = { status: 502, body: '{"error":"down"}' };

    const result = await sh([join(BIN, "git-credential-banki"), "get"], {}, "host=github.com\n\n");

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
  });
});

describe("the runner wrapper", () => {
  test("runs the CLI from the clone, in the clone, with its arguments", async () => {
    const clone = join(dir, "clone");
    mkdirSync(join(clone, "deploy/runner/cli"), { recursive: true });
    writeFileSync(
      join(clone, "deploy/runner/cli/main.ts"),
      'console.log(process.cwd(), process.argv.slice(2).join(" "));',
    );

    const result = await sh([join(BIN, "runner"), "stage", "implement", "BAN-1"], {
      BANKI_RUNNER_CLONE: clone,
    });

    expect(result.stdout.trim()).toMatch(/clone stage implement BAN-1$/);
    expect(result.exitCode).toBe(0);
  });

  test("says so when there is no clone yet", async () => {
    const result = await sh([join(BIN, "runner"), "stage"], {
      BANKI_RUNNER_CLONE: join(dir, "nowhere"),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("the first tick makes the clone of main");
  });
});

describe("the dashboard wrapper", () => {
  test("runs the Dashboard from the clone, in the clone", async () => {
    const clone = join(dir, "dashboard-clone");
    mkdirSync(join(clone, "deploy/runner/dashboard"), { recursive: true });
    writeFileSync(
      join(clone, "deploy/runner/dashboard/main.ts"),
      "console.log(process.cwd(), process.argv[1]);",
    );

    const result = await sh([join(BIN, "dashboard")], { BANKI_RUNNER_CLONE: clone });

    expect(result.stdout.trim()).toMatch(
      /dashboard-clone .*dashboard-clone\/deploy\/runner\/dashboard\/main\.ts$/,
    );
    expect(result.exitCode).toBe(0);
  });

  test.skipIf(Bun.which("git") === null)(
    "tells the Dashboard the clone's HEAD, read before bun loads any of it",
    async () => {
      const clone = join(dir, "dashboard-git");
      mkdirSync(join(clone, "deploy/runner/dashboard"), { recursive: true });
      writeFileSync(
        join(clone, "deploy/runner/dashboard/main.ts"),
        "console.log(process.env.BANKI_DASHBOARD_HEAD);",
      );
      const git = (...args: string[]) =>
        sh(["git", "-C", clone, "-c", "user.name=t", "-c", "user.email=t@t", ...args], {
          HOME: dir,
        });
      await git("init", "--quiet");
      await git("commit", "--quiet", "--allow-empty", "-m", "x");
      const head = (await git("rev-parse", "HEAD")).stdout.trim();

      const result = await sh([join(BIN, "dashboard")], { BANKI_RUNNER_CLONE: clone, HOME: dir });

      expect(head).toMatch(/^[0-9a-f]{40}$/);
      expect(result.stdout.trim()).toBe(head);
    },
  );

  test("says so, and waits a while before Docker starts it again, when there is no clone yet", async () => {
    const result = await sh([join(BIN, "dashboard")], {
      BANKI_RUNNER_CLONE: join(dir, "nowhere"),
      BANKI_DASHBOARD_WAIT_S: "0",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("the runner's first tick makes the clone of main");
  });
});
