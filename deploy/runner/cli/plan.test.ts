import { describe, expect, test } from "bun:test";
import {
  claudeArgs,
  freshResult,
  issueBranchOf,
  logPath,
  mcpConfig,
  resumePrompt,
  stageEnv,
  stagePrompt,
  worktreeOf,
} from "./plan";

// What one headless Stage is run with: pure, so pinned here. stage.ts does it.

// A fake value, built at runtime so secret scanners don't flag it.
const LINEAR_TOKEN = ["lin", "oauth", "faketoken"].join("_");
const CLAUDE_TOKEN = ["sk", "ant", "oat01", "fake"].join("-");

describe("the per-run MCP config", () => {
  test("has the linear-banki http server alone, with the token as a literal Bearer header", () => {
    expect(mcpConfig(LINEAR_TOKEN)).toEqual({
      mcpServers: {
        "linear-banki": {
          type: "http",
          url: "https://mcp.linear.app/mcp",
          headers: { Authorization: `Bearer ${LINEAR_TOKEN}` },
        },
      },
    });
  });
});

describe("the claude invocation", () => {
  test("is headless, on Opus, streams JSON events, skips permissions, reads only the per-run MCP config, and may work in the worktrees", () => {
    expect(claudeArgs("the prompt", "/tmp/stage-x/mcp.json")).toEqual([
      "claude",
      "-p",
      "the prompt",
      "--model",
      "opus",
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
      "--strict-mcp-config",
      "--mcp-config",
      "/tmp/stage-x/mcp.json",
      "--add-dir",
      "/work/banki-worktrees",
    ]);
  });
});

describe("a paused Stage's invocation", () => {
  test("goes on in its own session, with the same per-run MCP config", () => {
    const args = claudeArgs("go on", "/tmp/stage-y/mcp.json", "sess-1");

    expect(args.slice(0, 5)).toEqual(["claude", "-p", "go on", "--resume", "sess-1"]);
    expect(args).toContain("/tmp/stage-y/mcp.json");
    expect(args).toContain("--dangerously-skip-permissions");
  });

  test("is told to go on where it left off", () => {
    const prompt = resumePrompt("implement", "BAN-9");

    expect(prompt).toStartWith("Go on with the implement Stage on BAN-9");
    expect(prompt).toContain("headless");
  });
});

describe("the Stage's prompt", () => {
  test("runs that Stage's prompt on the issue, headless", () => {
    const prompt = stagePrompt("review-round", "BAN-94");

    expect(prompt).toContain(".claude/skills/work-issue/stages/review-round.md");
    expect(prompt).toContain("BAN-94");
    expect(prompt).toContain("headless");
    expect(prompt).toContain(".claude/skills/work-issue/references/stages.md");
  });

  test("says where Playwright's Chromium comes from on the Runner", () => {
    expect(stagePrompt("implement", "BAN-1")).toContain("npx playwright install chromium");
  });
});

describe("the Stage's environment", () => {
  const identity = {
    name: "banki-runner[bot]",
    email: "9+banki-runner[bot]@users.noreply.github.com",
  };

  test("passes the Claude token, waits out its subagents, commits as the App's bot, and drops any API key", () => {
    const env = stageEnv(
      { PATH: "/usr/bin", HOME: "/work/home", ANTHROPIC_API_KEY: "outranks-the-token" },
      CLAUDE_TOKEN,
      identity,
    );

    expect(env).toEqual({
      PATH: "/usr/bin",
      HOME: "/work/home",
      CLAUDE_CODE_OAUTH_TOKEN: CLAUDE_TOKEN,
      CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: "0",
      GIT_AUTHOR_NAME: "banki-runner[bot]",
      GIT_AUTHOR_EMAIL: "9+banki-runner[bot]@users.noreply.github.com",
      GIT_COMMITTER_NAME: "banki-runner[bot]",
      GIT_COMMITTER_EMAIL: "9+banki-runner[bot]@users.noreply.github.com",
    });
    expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
  });

  test("leaves out variables that aren't set", () => {
    expect(
      Object.keys(stageEnv({ PATH: "/bin", UNSET: undefined }, CLAUDE_TOKEN, identity)),
    ).not.toContain("UNSET");
  });
});

describe("the Stage's log", () => {
  test("is under the issue, named by its start time and kind, with no colon in it", () => {
    expect(logPath("BAN-94", "implement", new Date("2026-10-23T01:02:03.456Z"))).toBe(
      "/work/logs/BAN-94/2026-10-23T01-02-03Z-implement.jsonl",
    );
  });
});

describe("the issue's branch", () => {
  test("is the one on origin under any prefix, whoever asks", () => {
    const onOrigin = ["main", "dkomeza/ban-11-decks", "dkomeza/ban-11-decks-proto-a"];
    expect(issueBranchOf("bankirunner/ban-11-decks", onOrigin)).toBe("dkomeza/ban-11-decks");
    expect(issueBranchOf("dkomeza/ban-11-decks", onOrigin)).toBe("dkomeza/ban-11-decks");
  });

  test("is Linear's own when origin has none, for the first push to create", () => {
    expect(issueBranchOf("bankirunner/ban-12-cards", ["main", "dkomeza/ban-11-decks"])).toBe(
      "bankirunner/ban-12-cards",
    );
  });

  test("is refused when origin has it under several prefixes", () => {
    expect(() =>
      issueBranchOf("bankirunner/ban-11-decks", [
        "dkomeza/ban-11-decks",
        "bankirunner/ban-11-decks",
      ]),
    ).toThrow(/several branches/);
  });
});

describe("the issue's worktree", () => {
  test("is its branch without its owner's prefix, beside the clone", () => {
    for (const owner of ["dkomeza", "bankirunner"]) {
      expect(worktreeOf(`${owner}/ban-94-runner-container-github-app-and-credentials`)).toBe(
        "/work/banki-worktrees/ban-94-runner-container-github-app-and-credentials",
      );
    }
  });

  test("is refused for a branch that would leave banki-worktrees/", () => {
    for (const branch of [
      "",
      "dkomeza/",
      "dkomeza/../banki",
      "../x",
      "dkomeza/a/../../b",
      "/etc",
      "a\nb",
    ]) {
      expect(() => worktreeOf(branch)).toThrow();
    }
  });
});

describe("the Stage's result", () => {
  const started = new Date("2026-10-23T01:00:00.000Z");

  test("is printed when the Stage wrote it", () => {
    expect(freshResult(new Date("2026-10-23T01:30:00.000Z"), started)).toBe(true);
  });

  test("isn't, when it is an older Stage's left behind", () => {
    expect(freshResult(new Date("2026-10-22T23:00:00.000Z"), started)).toBe(false);
    expect(freshResult(undefined, started)).toBe(false);
  });
});
