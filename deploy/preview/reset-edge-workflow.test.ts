import { describe, expect, test } from "bun:test";
import { type Answer, REPO, workflowHarness, writes } from "./workflow-harness";

// The reset-edge workflow, read from .github/workflows the way GitHub reads
// it. Its one script runs here under bash against a fake `gh` that answers
// from fixtures and records every call. The rest is checked on the parsed
// workflow: the trigger and the permissions.

const { workflow, job, runStep } = workflowHarness("reset-edge.yml");

const SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);
const API = `sha256:${"1".repeat(64)}`;
const WEB = `sha256:${"2".repeat(64)}`;
const OTHER = { api: `sha256:${"3".repeat(64)}`, web: `sha256:${"4".repeat(64)}` };

const EDGE = `GET repos/${REPO}/deployments?environment=edge&per_page=100`;
const edgeDeployment = (
  id: number,
  sha: string,
  createdAt: string,
  payload: unknown = { sha, api: API, web: WEB },
) => ({ id, sha, ref: sha, created_at: createdAt, payload });

const reset = (fixtures: Record<string, Answer>, env: Record<string, string> = {}) =>
  runStep(
    "reset",
    "create",
    { GITHUB_REF: "refs/heads/main", ...env },
    { [`POST repos/${REPO}/deployments`]: { id: 888 }, ...fixtures },
  );

const created = (sha = SHA, digests = { api: API, web: WEB }) => [
  {
    method: "POST",
    path: `repos/${REPO}/deployments`,
    body: {
      ref: sha,
      environment: "edge",
      payload: { sha, ...digests, reset: true },
      description: `Edge reset ${sha.slice(0, 7)}`,
      required_contexts: [],
      auto_merge: false,
      transient_environment: false,
      production_environment: false,
    },
  },
  {
    method: "POST",
    path: `repos/${REPO}/deployments/888/statuses`,
    body: { state: "queued", description: "waiting for the agent", auto_inactive: false },
  },
];

describe("the reset Deployment", () => {
  test("copies the newest Edge Deployment's commit and images, with the reset mark, queued", async () => {
    const result = await reset({ [EDGE]: [edgeDeployment(5, SHA, "2026-10-20T10:00:00Z")] });

    expect(result.exitCode).toBe(0);
    expect(writes(result.calls)).toEqual(created());
    expect(result.output).toBe("deployment=888\n");
  });

  test("copies the newest by created_at and then ID, whatever its status", async () => {
    const result = await reset({
      [EDGE]: [
        edgeDeployment(9, SHA, "2026-10-20T09:00:00Z"),
        edgeDeployment(6, OTHER_SHA, "2026-10-20T11:00:00Z", { sha: OTHER_SHA, ...OTHER }),
        edgeDeployment(7, SHA, "2026-10-20T11:00:00Z"),
      ],
    });

    expect(result.exitCode).toBe(0);
    expect(writes(result.calls)).toEqual(created());
    // No status is read: a failed or queued newest is reset to all the same.
    expect(result.calls.filter((call) => call.method === "GET")).toHaveLength(1);
  });

  test("drops anything else in the copied payload, an earlier reset mark included", async () => {
    const result = await reset({
      [EDGE]: [
        edgeDeployment(5, SHA, "2026-10-20T10:00:00Z", {
          sha: SHA,
          api: API,
          web: WEB,
          reset: true,
          extra: "x",
        }),
      ],
    });

    expect(result.exitCode).toBe(0);
    expect(writes(result.calls)).toEqual(created());
  });

  test("reads a payload GitHub gives back as a JSON string", async () => {
    const payload = JSON.stringify({ sha: SHA, api: API, web: WEB });
    const result = await reset({
      [EDGE]: [edgeDeployment(5, SHA, "2026-10-20T10:00:00Z", payload)],
    });

    expect(result.exitCode).toBe(0);
    expect(writes(result.calls)).toEqual(created());
  });

  test("fails with a message, creating nothing, when Edge has no Deployment", async () => {
    const result = await reset({ [EDGE]: [] });

    expect(result.exitCode).toBe(1);
    expect(result.out).toContain("Edge has no Deployment to reset to");
    expect(writes(result.calls)).toEqual([]);
  });

  test("fails with a message, creating nothing, when the newest payload isn't a valid { sha, api, web }", async () => {
    for (const payload of [
      null,
      "garbage",
      {},
      { sha: OTHER_SHA, api: API, web: WEB },
      { sha: SHA, api: API },
      { sha: SHA, api: "sha256:abc", web: WEB },
      { sha: SHA, api: API, web: `sha256:${"G".repeat(64)}` },
      { sha: SHA, api: ` ${API}`, web: WEB },
    ]) {
      const result = await reset({
        [EDGE]: [
          edgeDeployment(4, SHA, "2026-10-20T09:00:00Z"),
          edgeDeployment(5, SHA, "2026-10-20T10:00:00Z", payload),
        ],
      });

      expect(result.exitCode).toBe(1);
      expect(result.out).toContain(
        "Edge's newest Deployment, 5, has no valid { sha, api, web } payload",
      );
      expect(writes(result.calls)).toEqual([]);
    }
  });

  test("fails, creating nothing, when dispatched from another branch", async () => {
    const result = await reset(
      { [EDGE]: [edgeDeployment(5, SHA, "2026-10-20T10:00:00Z")] },
      { GITHUB_REF: "refs/heads/feature" },
    );

    expect(result.exitCode).toBe(1);
    expect(result.out).toContain("dispatch it from main");
    expect(result.calls).toEqual([]);
  });

  test("fails when GitHub doesn't create the Deployment", async () => {
    const result = await reset({
      [EDGE]: [edgeDeployment(5, SHA, "2026-10-20T10:00:00Z")],
      [`POST repos/${REPO}/deployments`]: { message: "nope" },
    });

    expect(result.exitCode).toBe(1);
    expect(result.out).toContain("GitHub didn't create the Deployment");
    expect(result.output).toBe("");
  });
});

describe("the workflow", () => {
  test("runs only on a dispatch, with no inputs", () => {
    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
    expect(workflow.on.workflow_dispatch).toBeNull();
  });

  test("gives its one job only the permissions it needs", () => {
    expect(workflow.permissions).toEqual({});
    expect(Object.keys(workflow.jobs)).toEqual(["reset"]);
    expect(job("reset").permissions).toEqual({ contents: "read", deployments: "write" });
  });

  test("never puts an expression into a script", () => {
    for (const candidate of Object.values(workflow.jobs)) {
      for (const each of candidate.steps) expect(each.run ?? "").not.toContain("${{");
    }
  });
});
