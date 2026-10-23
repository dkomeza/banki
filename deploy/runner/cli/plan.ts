import { join } from "node:path";
import type { StageKind } from "./args";

// What one headless Stage is run with (ADR-0012): the per-run MCP config that
// reaches Linear as the Runner app, the `claude` invocation and its
// environment, and where its log and result are. Pure, so it is unit-tested;
// stage.ts does it.

export const CLONE = "/work/banki";
export const WORKTREES = "/work/banki-worktrees";
export const LOGS = "/work/logs";

/** The one MCP server a Stage gets: Linear's, as the Runner app, with this Stage's token. */
export function mcpConfig(linearToken: string) {
  return {
    mcpServers: {
      "linear-banki": {
        type: "http",
        url: "https://mcp.linear.app/mcp",
        headers: { Authorization: `Bearer ${linearToken}` },
      },
    },
  };
}

export function claudeArgs(prompt: string, mcpConfigPath: string): string[] {
  return [
    "claude",
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    // The container is the boundary (ADR-0012): a gap in an allowlist would
    // fail a Stage in the middle of the night.
    "--dangerously-skip-permissions",
    // No MCP server but the per-run one, whatever the clone's settings say.
    "--strict-mcp-config",
    "--mcp-config",
    mcpConfigPath,
    // What .claude/settings.json grants as `additionalDirectories`, which
    // `claude` ignores in a workspace nobody has trusted interactively, as
    // the Runner's clone never is.
    "--add-dir",
    WORKTREES,
  ];
}

export function stagePrompt(kind: StageKind, issue: string): string {
  return [
    `Run the ${kind} Stage on ${issue}, headless: read .claude/skills/work-issue/stages/${kind}.md and follow it to its end for ${issue}.`,
    "You are on the Runner, unattended, and no one will answer in this session: where a Stage asks the Maintainer, it stops on them as .claude/skills/work-issue/references/stages.md says for a headless Stage.",
    "This directory is the Runner's clone of main, and the worktrees go beside it, in ../banki-worktrees/.",
    "Playwright's Chromium isn't in the image: in a worktree, run `npx playwright install chromium` after `bun install` and before the `ui` script or playwright-cli (a no-op once it is there).",
  ].join("\n\n");
}

export type Identity = { name: string; email: string };

/**
 * The Stage's environment: the Runner's own, with the Claude token, and the
 * App's bot as the author and committer. Never ANTHROPIC_API_KEY, which would
 * outrank the token.
 */
export function stageEnv(
  base: Record<string, string | undefined>,
  claudeToken: string,
  identity: Identity,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(base)) {
    if (value !== undefined && name !== "ANTHROPIC_API_KEY") env[name] = value;
  }
  return {
    ...env,
    CLAUDE_CODE_OAUTH_TOKEN: claudeToken,
    GIT_AUTHOR_NAME: identity.name,
    GIT_AUTHOR_EMAIL: identity.email,
    GIT_COMMITTER_NAME: identity.name,
    GIT_COMMITTER_EMAIL: identity.email,
  };
}

/** The Stage's full stream-json log: /work/logs/BAN-N/<start time>-<kind>.jsonl. */
export function logPath(issue: string, kind: StageKind, startedAt: Date): string {
  const time = startedAt
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replaceAll(":", "-");
  return join(LOGS, issue, `${time}-${kind}.jsonl`);
}

/**
 * The issue's worktree (`references/stages.md` § Paths): its branch without
 * the `dkomeza/` prefix, in banki-worktrees/ beside the clone. A branch that
 * would lead anywhere else is refused.
 */
export function worktreeOf(branch: string): string {
  const name = branch.replace(/^dkomeza\//, "");
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.startsWith(".")) {
    throw new Error(`The issue's branch ${JSON.stringify(branch)} has no worktree name`);
  }
  return join(WORKTREES, name);
}

/** Whether a result file written at `modified` is this Stage's, not one an earlier Stage left. */
export function freshResult(modified: Date | undefined, startedAt: Date): boolean {
  return modified !== undefined && modified.getTime() >= startedAt.getTime();
}
