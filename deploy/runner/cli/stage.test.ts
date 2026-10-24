import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asObject, asString } from "../lib/parse";
import { executeStage, runStage, type StageDeps } from "./stage";

// One Stage run with a stand-in Broker, Linear lookup and `claude`, and
// signals sent to `runner` at each step: whatever step it is in, the Linear
// token is revoked, the MCP config is gone, and it ends 128 + the signal's
// number.

const root = mkdtempSync(join(tmpdir(), "banki-stage-test-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

// A fake value, built at runtime so secret scanners don't flag it.
const LINEAR_TOKEN = ["lin", "fake", "stage", "token"].join("_");

/** A stand-in `claude`: prints two events and writes the Stage's result, or waits to be stopped. */
function fakeClaude(name: string, body: string): string {
  const path = join(root, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

const QUICK = fakeClaude(
  "claude-quick",
  [
    `echo '{"type":"system","subtype":"init","model":"m","session_id":"s","mcp_servers":[]}'`,
    `mkdir -p "$RESULT_DIR" && echo '{"outcome":"done"}' > "$RESULT_DIR/stage-result.json"`,
    `echo '{"type":"result","subtype":"success","num_turns":1}'`,
  ].join("\n"),
);
const SLOW = fakeClaude(
  "claude-slow",
  `trap 'echo "{\\"type\\":\\"system\\",\\"subtype\\":\\"stopped\\"}"; exit 130' INT TERM\necho '{"type":"system","subtype":"init"}'\nsleep 10 >/dev/null 2>&1 & wait`,
);

/** A promise, and the function that settles it. */
function gate<T>() {
  const { promise, resolve } = Promise.withResolvers<T>();
  return { promise, open: resolve };
}

function setup(overrides: Partial<StageDeps> = {}) {
  const dir = mkdtempSync(join(root, "run-"));
  const paths = {
    clone: join(dir, "banki"),
    worktrees: join(dir, "banki-worktrees"),
    logs: join(dir, "logs"),
    tmp: join(dir, "tmp"),
  };
  for (const path of Object.values(paths)) mkdirSync(path);
  process.env.RESULT_DIR = join(paths.worktrees, "ban-1-x", ".ui");
  const ended: string[] = [];
  const out: string[] = [];
  const deps: StageDeps = {
    broker: {
      identity: async () => ({ name: "banki-runner[bot]", email: "1+banki-runner[bot]@x" }),
      linearToken: async () => ({ id: "token-id", token: LINEAR_TOKEN }),
      endLinearToken: async (id) => {
        ended.push(id);
      },
    },
    issueBranch: async () => "dkomeza/ban-1-x",
    claudeToken: () => "claude-token",
    claude: QUICK,
    ...paths,
    out: (line) => out.push(line),
    err: (line) => out.push(line),
    ...overrides,
  };
  /** The MCP configs' directories left behind. */
  const configs = () => readdirSync(paths.tmp);
  return { deps, ended, out, configs, paths };
}

/** Lets pending promises and timers run. */
const tick = (ms = 20) => Bun.sleep(ms);

/** Whether a process with this pid is still there. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** `promise`, or a rejection once `ms` have gone by without it settling. */
function within<T>(ms: number, promise: Promise<T>): Promise<T> {
  let timer: Timer | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`still running after ${ms} ms`)), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

describe("a Stage", () => {
  test("runs claude, logs its events, prints its result, and revokes the token", async () => {
    const { deps, ended, out, configs, paths } = setup();

    const exitCode = await runStage("implement", "BAN-1", deps);

    expect(exitCode).toBe(0);
    expect(ended).toEqual(["token-id"]);
    expect(configs()).toEqual([]);
    const [log = ""] = readdirSync(join(paths.logs, "BAN-1"));
    const events = readFileSync(join(paths.logs, "BAN-1", log), "utf8")
      .trim()
      .split("\n");
    expect(
      events.map((line) => asString(asObject(JSON.parse(line), "event").type, "type")),
    ).toEqual(["runner", "system", "result", "runner"]);
    expect(out.join("\n")).toContain("The Stage's result");
    expect(out.join("\n")).toContain('{"outcome":"done"}');
  });

  test("stopped while the Broker mints its Linear token, revokes it once it comes, and ends 130", async () => {
    const minted = gate<{ id: string; token: string }>();
    const { deps, ended, configs } = setup();
    deps.broker.linearToken = () => minted.promise;

    const run = runStage("implement", "BAN-1", deps);
    await tick();
    process.emit("SIGINT", "SIGINT");
    minted.open({ id: "late-id", token: LINEAR_TOKEN });

    expect(await run).toBe(130);
    expect(ended).toEqual(["late-id"]);
    expect(configs()).toEqual([]);
  });

  test("stopped while waiting on the Broker for its identity, asks for no token, and ends 143", async () => {
    const { deps, ended } = setup();
    let asked = false;
    deps.broker.identity = (signal) =>
      new Promise((_, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    deps.broker.linearToken = async () => {
      asked = true;
      return { id: "x", token: LINEAR_TOKEN };
    };

    const run = runStage("design", "BAN-1", deps);
    await tick();
    process.emit("SIGTERM", "SIGTERM");

    expect(await run).toBe(143);
    expect(asked).toBe(false);
    expect(ended).toEqual([]);
  });

  test("stopped while reading the issue from Linear, revokes the token, and ends 129", async () => {
    const { deps, ended, configs } = setup({
      issueBranch: (_token, _issue, signal) =>
        new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    });

    const run = runStage("review-round", "BAN-1", deps);
    await tick();
    process.emit("SIGHUP", "SIGHUP");

    expect(await run).toBe(129);
    expect(ended).toEqual(["token-id"]);
    expect(configs()).toEqual([]);
  });

  test("stopped while claude runs, passes the signal on to it, then cleans up and ends 130", async () => {
    const { deps, ended, configs, out } = setup({ claude: SLOW });

    const run = runStage("acceptance-fix", "BAN-1", deps);
    for (let i = 0; i < 100 && !out.some((line) => line.includes("start:")); i++) await tick();
    expect(configs()).toHaveLength(1);
    process.emit("SIGINT", "SIGINT");

    expect(await run).toBe(130);
    expect(out.join("\n")).toContain("system: stopped");
    expect(ended).toEqual(["token-id"]);
    expect(configs()).toEqual([]);
  });

  test("leaves no signal handler behind once it ends", async () => {
    const before = process.listenerCount("SIGINT");
    const { deps } = setup();

    await runStage("implement", "BAN-1", deps);

    expect(process.listenerCount("SIGINT")).toBe(before);
  });

  test("hands its supervisor the log and the result it wrote", async () => {
    const { deps, paths } = setup();
    const log = join(paths.logs, "BAN-1", "chosen.jsonl");

    const run = await executeStage("implement", "BAN-1", deps, { log });

    expect(run).toEqual({
      exitCode: 0,
      log,
      timedOut: false,
      tokens: [LINEAR_TOKEN],
      result: { outcome: "done" },
    });
    expect(existsSync(log)).toBe(true);
  });

  test("goes on in a paused Stage's session, with a go-on prompt", async () => {
    const ARGS = fakeClaude(
      "claude-args",
      `mkdir -p "$RESULT_DIR" && printf '%s\n' "$@" > "$RESULT_DIR/args"`,
    );
    const { deps, paths } = setup({ claude: ARGS });

    await executeStage("implement", "BAN-1", deps, { resume: "sess-9" });

    const args = readFileSync(join(paths.worktrees, "ban-1-x", ".ui", "args"), "utf8").split("\n");
    expect(args[0]).toBe("-p");
    expect(args[1]).toStartWith("Go on with the implement Stage on BAN-1");
    expect(args.slice(2, 4)).toEqual(["--resume", "sess-9"]);
  });

  test("stopped at its time limit gets SIGTERM, then SIGKILL if it hangs on, and says it timed out", async () => {
    const STUBBORN = fakeClaude(
      "claude-stubborn",
      `exec bun -e 'process.on("SIGTERM", () => {}); console.log(JSON.stringify({ type: "system", subtype: "init" })); setInterval(() => {}, 1000)'`,
    );
    const { deps, ended, out } = setup({ claude: STUBBORN });

    const run = await executeStage("implement", "BAN-1", deps, {
      timeLimitMs: 1500,
      killAfterMs: 200,
    });

    expect(run.timedOut).toBe(true);
    expect(run.exitCode).not.toBe(0);
    expect(out.join("\n")).toContain("SIGTERM");
    expect(out.join("\n")).toContain("SIGKILL");
    expect(ended).toEqual(["token-id"]);
  });

  // A child of `claude`'s that ignores SIGTERM and keeps its output open
  // would hold the Stage, and its supervisor's slot, forever.
  test("stopped at its time limit takes claude's children down with it, and returns promptly", async () => {
    const PARENT = fakeClaude(
      "claude-parent",
      `trap '' TERM\necho '{"type":"system","subtype":"init"}'\nsleep 30\necho '{"type":"system","subtype":"late"}'`,
    );
    const { deps, ended, out } = setup({ claude: PARENT });

    // Time enough for the stand-in to set its trap, then a short grace.
    const run = await within(
      4_000,
      executeStage("implement", "BAN-1", deps, { timeLimitMs: 1_000, killAfterMs: 100 }),
    );

    expect(run.timedOut).toBe(true);
    expect(out.join("\n")).toContain("SIGKILL");
    expect(out.join("\n")).not.toContain("late");
    expect(ended).toEqual(["token-id"]);
  });

  test("stopped while claude runs, passes the signal on to its children too", async () => {
    const PARENT = fakeClaude(
      "claude-parent-int",
      `echo '{"type":"system","subtype":"init"}'\nsleep 30`,
    );
    const { deps, ended, out } = setup({ claude: PARENT });

    const run = within(3_000, runStage("acceptance-fix", "BAN-1", deps));
    for (let i = 0; i < 100 && !out.some((line) => line.includes("system: init")); i++)
      await tick();
    process.emit("SIGINT", "SIGINT");

    expect(await run).toBe(130);
    expect(ended).toEqual(["token-id"]);
  });

  test("stops waiting on output a process outside claude's group still holds, a grace after claude ends", async () => {
    const ESCAPED = fakeClaude(
      "claude-escaped",
      `exec bun -e 'const c = Bun.spawn(["sleep", "30"], { stdio: ["ignore", "inherit", "inherit"], detached: true }); console.error("escaped " + c.pid); c.unref(); process.on("SIGTERM", () => {}); console.log(JSON.stringify({ type: "system", subtype: "init" })); setInterval(() => {}, 1000)'`,
    );
    const { deps, ended, out } = setup({ claude: ESCAPED });

    try {
      const run = await within(
        4_000,
        executeStage("implement", "BAN-1", deps, {
          timeLimitMs: 1_500,
          killAfterMs: 100,
          drainMs: 100,
        }),
      );

      expect(run.timedOut).toBe(true);
      expect(ended).toEqual(["token-id"]);
    } finally {
      const pid = /escaped (\d+)/.exec(out.join("\n"))?.[1];
      if (pid !== undefined && alive(Number(pid))) process.kill(Number(pid), "SIGKILL");
    }
  });

  test("once claude ends at its time limit, a child of its group that outlived it is killed", async () => {
    const LINGERING = fakeClaude(
      "claude-lingering",
      [
        `trap 'exit 143' TERM`,
        `echo '{"type":"system","subtype":"init"}'`,
        `( trap '' TERM; exec sleep 30 ) &`,
        `echo "child $!" >&2`,
        `wait`,
      ].join("\n"),
    );
    const { deps, out } = setup({ claude: LINGERING });
    let pid: number | undefined;

    try {
      const run = await within(
        4_000,
        executeStage("implement", "BAN-1", deps, {
          timeLimitMs: 1_000,
          killAfterMs: 60_000,
          drainMs: 100,
        }),
      );
      pid = Number(/child (\d+)/.exec(out.join("\n"))?.[1]);

      expect(run.timedOut).toBe(true);
      expect(pid).toBeGreaterThan(0);
      for (let i = 0; i < 50 && alive(pid); i++) await tick();
      expect(alive(pid)).toBe(false);
    } finally {
      if (pid !== undefined && pid > 0 && alive(pid)) process.kill(pid, "SIGKILL");
    }
  });

  test("a failure that isn't a signal still revokes the token, and is thrown", async () => {
    const { deps, ended } = setup({
      issueBranch: () => Promise.reject(new Error("Linear has no issue BAN-1")),
    });

    const outcome = await runStage("implement", "BAN-1", deps).catch((error: unknown) =>
      String(error),
    );

    expect(outcome).toContain("Linear has no issue BAN-1");
    expect(ended).toEqual(["token-id"]);
    expect(existsSync(deps.tmp)).toBe(true);
  });
});
