import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The README's merge-guard command (§ Runner, "GitHub: the merge guard")
// reads the live `main` ruleset and writes it back with three review settings
// changed. Its jq program is taken from the README as it is and run on the
// ruleset as GitHub returned it: nothing else may change, or a rule added
// later would be dropped without a word. Skipped without jq.

const hasJq = Bun.which("jq") !== null;
const README = readFileSync(join(import.meta.dir, "..", "..", "README.md"), "utf8");

function program(): string {
  const section = README.slice(README.indexOf("### GitHub: the merge guard"));
  const found = /\| jq '([\s\S]*?)'\)"/.exec(section)?.[1];
  if (found === undefined) throw new Error("README: no jq program in the merge guard's command");
  return found;
}

/** The `main` ruleset as `gh api repos/dkomeza/banki/rulesets/25304272` returned it on 2026-10-23. */
const LIVE = {
  id: 25304272,
  name: "main",
  target: "branch",
  source_type: "Repository",
  source: "dkomeza/banki",
  enforcement: "active",
  conditions: { ref_name: { exclude: [], include: ["~DEFAULT_BRANCH"] } },
  rules: [
    { type: "deletion" },
    { type: "non_fast_forward" },
    {
      type: "pull_request",
      parameters: {
        required_approving_review_count: 0,
        dismiss_stale_reviews_on_push: false,
        required_reviewers: [],
        require_code_owner_review: false,
        require_last_push_approval: false,
        required_review_thread_resolution: true,
        require_extra_approval_for_unattributed_changes: true,
        allowed_merge_methods: ["squash"],
      },
    },
    {
      type: "required_status_checks",
      parameters: {
        strict_required_status_checks_policy: false,
        do_not_enforce_on_create: false,
        required_status_checks: [
          { context: "claude-review", integration_id: 15368 },
          { context: "test", integration_id: 15368 },
          { context: "check", integration_id: 15368 },
        ],
      },
    },
  ],
  node_id: "RRS_lACqUmVwb3NpdG9yec5MH-LOzgGCHNA",
  created_at: "2026-10-17T15:42:31.877+02:00",
  updated_at: "2026-10-22T20:33:32.317+02:00",
  bypass_actors: [{ actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "pull_request" }],
  current_user_can_bypass: "pull_requests_only",
};

async function jq(input: unknown) {
  const proc = Bun.spawn(["jq", program()], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  await proc.stdin.write(JSON.stringify(input));
  await proc.stdin.end();
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe.skipIf(!hasJq)("the README's merge-guard command", () => {
  test("changes the three review settings, and keeps everything else that can be written", async () => {
    const result = await jq(LIVE);

    expect(result.exitCode).toBe(0);
    const [deletion, nonFastForward, pullRequest, checks] = LIVE.rules;
    expect(JSON.parse(result.stdout)).toEqual({
      name: LIVE.name,
      target: LIVE.target,
      enforcement: LIVE.enforcement,
      conditions: LIVE.conditions,
      bypass_actors: LIVE.bypass_actors,
      rules: [
        deletion,
        nonFastForward,
        {
          ...pullRequest,
          parameters: {
            ...pullRequest?.parameters,
            required_approving_review_count: 1,
            dismiss_stale_reviews_on_push: true,
            require_last_push_approval: true,
          },
        },
        checks,
      ],
    });
  });

  test("keeps a rule it has never heard of", async () => {
    const added = { type: "required_linear_history" };

    const result = await jq({ ...LIVE, rules: [...LIVE.rules, added] });

    expect(JSON.parse(result.stdout).rules).toContainEqual(added);
  });

  test("stops, printing nothing to write back, when there is no pull_request rule", async () => {
    const result = await jq({
      ...LIVE,
      rules: LIVE.rules.filter((rule) => rule.type !== "pull_request"),
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("no pull_request rule");
  });
});
