import { describe, expect, test } from "bun:test";
import { isSlug } from "./agent/naming";
import { type Answer, REPO, workflowHarness, writes } from "./workflow-harness";

// The slug-preview workflow (ADR-0011), read from .github/workflows the way
// GitHub reads it. Each step's script runs here under bash, as Actions runs
// it, against a fake `gh` that answers from fixtures and records every call,
// so a test reads exactly what the workflow asked GitHub to do. The rest is
// checked on the parsed workflow: triggers, permissions, the jobs' order.

const { workflow, job, runStep } = workflowHarness("slug-preview.yml");

const SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);
const DEPLOYMENTS = `GET repos/${REPO}/deployments?environment=slug-preview&per_page=100`;
const statuses = (id: number) => `GET repos/${REPO}/deployments/${id}/statuses?per_page=1`;
const versions = (pkg: string) =>
  `GET users/dkomeza/packages/container/${pkg}/versions?per_page=100`;

const inputs = (env: Partial<Record<"SLUG" | "BRANCH" | "TTL_HOURS" | "DOWN", string>> = {}) =>
  runStep("check", "inputs", {
    SLUG: "blue",
    BRANCH: "proto/blue",
    TTL_HOURS: "72",
    DOWN: "false",
    ...env,
  });

/** A `slug-preview` Deployment as REST lists it. */
const deployment = (
  id: number,
  slug: string,
  ref: string,
  createdAt: string,
  payloadAs: "object" | "string" = "object",
) => {
  const payload = { slug, ref, sha: SHA, ttlHours: 72 };
  return {
    id,
    sha: SHA,
    created_at: createdAt,
    payload: payloadAs === "object" ? payload : JSON.stringify(payload),
  };
};
const status = (state: string) => [{ state }];

describe("the inputs", () => {
  const slugs = [
    "ab",
    "blue",
    "proto-blue-2",
    "a".repeat(40),
    "pr5",
    "a",
    "a".repeat(41),
    "Blue",
    "1blue",
    "-blue",
    "blue-",
    "a--b",
    "blue_green",
    "blue.green",
    "blue green",
    "pr-5",
    "www",
    "api",
    "app",
    "admin",
    "auth",
    "mail",
    "status",
    "preview",
    "previews",
    "prod",
    "production",
    "staging",
    "banki",
    "runner",
  ];

  for (const slug of slugs) {
    test(`take slug ${JSON.stringify(slug)} exactly when the pull agent does`, async () => {
      const result = await inputs({ SLUG: slug });

      expect(result.exitCode === 0).toBe(isSlug(slug));
      if (!isSlug(slug)) expect(result.out).toContain(`slug \`${slug}\``);
    });
  }

  test("say why a slug is refused", async () => {
    expect((await inputs({ SLUG: "www" })).out).toContain("slug `www` is reserved");
    expect((await inputs({ SLUG: "pr-5" })).out).toContain("may not start with pr-");
    expect((await inputs({ SLUG: "Blue" })).out).toContain("isn't a Slug");
  });

  test("refuse an empty slug, and control characters in any input", async () => {
    expect((await inputs({ SLUG: "" })).exitCode).toBe(1);
    expect((await inputs({ SLUG: "blue\n::warning::x" })).out).toContain("control characters");
    expect((await inputs({ BRANCH: "proto/blue\nx" })).exitCode).toBe(1);
  });

  for (const ttl of ["0", "337", "1000", "99999999999999999999", "-1", "2.5", "seventy", ""]) {
    test(`refuse ttl_hours ${JSON.stringify(ttl)}`, async () => {
      const result = await inputs({ TTL_HOURS: ttl });

      expect(result.exitCode).toBe(1);
      expect(result.out).toContain("ttl_hours must be a whole number of hours from 1 to 336");
    });
  }

  for (const ttl of ["1", "72", "336", "072"]) {
    test(`take ttl_hours ${ttl}`, async () => {
      expect((await inputs({ TTL_HOURS: ttl })).exitCode).toBe(0);
    });
  }

  test("refuse a Dependabot branch", async () => {
    const result = await inputs({ BRANCH: "dependabot/npm_and_yarn/oxlint-1.0.0" });

    expect(result.exitCode).toBe(1);
    expect(result.out).toContain("is Dependabot's, which gets no Slug Preview");
  });

  test("refuse a missing or invalid branch name", async () => {
    expect((await inputs({ BRANCH: "" })).out).toContain("a branch is needed");
    for (const branch of ["a..b", "-x", "a b", "x.lock", "a~1", "a:b"]) {
      const result = await inputs({ BRANCH: branch });

      expect(result.exitCode).toBe(1);
      expect(result.out).toContain("isn't a valid branch name");
    }
  });

  test("need only a valid slug to take one down", async () => {
    expect((await inputs({ DOWN: "true", BRANCH: "", TTL_HOURS: "0" })).exitCode).toBe(0);
    expect((await inputs({ DOWN: "true", SLUG: "www" })).exitCode).toBe(1);
  });

  test("call GitHub for nothing", async () => {
    expect((await inputs()).calls).toEqual([]);
  });
});

const ref = (branch: string) => `GET repos/${REPO}/git/ref/heads/${branch}`;

describe("resolving the branch", () => {
  test("gives the head commit it builds", async () => {
    const result = await runStep(
      "check",
      "branch",
      { BRANCH: "proto/blue" },
      {
        [ref("proto/blue")]: { ref: "refs/heads/proto/blue", object: { type: "commit", sha: SHA } },
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toBe(`sha=${SHA}\n`);
  });

  test("fails on a branch that doesn't exist, saying so", async () => {
    const result = await runStep("check", "branch", { BRANCH: "proto/gone" });

    expect(result.exitCode).toBe(1);
    expect(result.out).toContain(`branch \`proto/gone\` doesn't exist in ${REPO}`);
    expect(result.output).toBe("");
  });

  test("escapes each part of the branch's name in the path", async () => {
    const result = await runStep("check", "branch", { BRANCH: "proto/a#b%c" });

    expect(result.calls.map((call) => call.path)).toEqual([
      `repos/${REPO}/git/ref/heads/proto/a%23b%25c`,
    ]);
  });
});

const held = (fixtures: Record<string, Answer>) =>
  runStep("claim", "held", { SLUG: "blue", BRANCH: "proto/blue" }, fixtures);

describe("claiming the Slug", () => {
  test("goes ahead when the Slug has never been deployed", async () => {
    const result = await held({
      [DEPLOYMENTS]: [deployment(1, "cyan", "other", "2026-10-20T10:00:00Z")],
    });

    expect(result.exitCode).toBe(0);
    expect(result.out).toContain("slug `blue` is free");
  });

  test("fails when another branch holds the Slug, naming it", async () => {
    const result = await held({
      [DEPLOYMENTS]: [deployment(2, "blue", "proto/other", "2026-10-20T10:00:00Z")],
      [statuses(2)]: status("success"),
    });

    expect(result.exitCode).toBe(1);
    expect(result.out).toContain("slug `blue` is held by branch `proto/other`");
  });

  test("holds while the other branch's Deployment is still waiting or failed", async () => {
    for (const state of ["queued", "in_progress", "failure"]) {
      const result = await held({
        [DEPLOYMENTS]: [deployment(2, "blue", "proto/other", "2026-10-20T10:00:00Z", "string")],
        [statuses(2)]: status(state),
      });

      expect(result.exitCode).toBe(1);
    }
  });

  test("goes ahead once the other branch's newest Deployment is inactive", async () => {
    const result = await held({
      [DEPLOYMENTS]: [deployment(2, "blue", "proto/other", "2026-10-20T10:00:00Z")],
      [statuses(2)]: status("inactive"),
    });

    expect(result.exitCode).toBe(0);
  });

  test("redeploys for the same branch, and reads only the newest Deployment", async () => {
    const result = await held({
      [DEPLOYMENTS]: [
        deployment(3, "blue", "proto/blue", "2026-10-20T11:00:00Z"),
        deployment(2, "blue", "proto/other", "2026-10-20T10:00:00Z"),
      ],
      [statuses(3)]: status("success"),
      [statuses(2)]: status("success"),
    });

    expect(result.exitCode).toBe(0);
    expect(result.out).toContain("redeploying it at its head");
    expect(result.calls.map((call) => call.path)).not.toContain(
      `repos/${REPO}/deployments/2/statuses?per_page=1`,
    );
  });

  test("writes nothing while checking", async () => {
    const result = await held({
      [DEPLOYMENTS]: [deployment(2, "blue", "proto/other", "2026-10-20T10:00:00Z")],
      [statuses(2)]: status("success"),
    });

    expect(writes(result.calls)).toEqual([]);
  });

  test("creates the Deployment of the head, queued, with its payload", async () => {
    const result = await runStep(
      "claim",
      "create",
      { SLUG: "blue", BRANCH: "proto/blue", SHA, TTL_HOURS: "072" },
      { [`POST repos/${REPO}/deployments`]: { id: 555 } },
    );

    expect(result.exitCode).toBe(0);
    expect(writes(result.calls)).toEqual([
      {
        method: "POST",
        path: `repos/${REPO}/deployments`,
        body: {
          ref: SHA,
          environment: "slug-preview",
          payload: { slug: "blue", ref: "proto/blue", sha: SHA, ttlHours: 72 },
          description: "Slug Preview blue",
          required_contexts: [],
          auto_merge: false,
          transient_environment: true,
          production_environment: false,
        },
      },
      {
        method: "POST",
        path: `repos/${REPO}/deployments/555/statuses`,
        body: {
          state: "queued",
          description: "waiting for images of aaaaaaa",
          auto_inactive: false,
        },
      },
    ]);
    expect(result.output).toBe("deployment=555\n");
  });

  test("fails when GitHub creates no Deployment", async () => {
    const result = await runStep("claim", "create", {
      SLUG: "blue",
      BRANCH: "proto/blue",
      SHA,
      TTL_HOURS: "72",
    });

    expect(result.exitCode).toBe(1);
    expect(writes(result.calls)).toHaveLength(1);
  });

  test("marks the Deployment a failure when the build fails", async () => {
    const result = await runStep("build-failed", "fail", { DEPLOYMENT: "555" });

    expect(writes(result.calls)).toEqual([
      {
        method: "POST",
        path: `repos/${REPO}/deployments/555/statuses`,
        body: { state: "failure", description: "build failed", auto_inactive: false },
      },
    ]);
  });
});

describe("taking a Slug down", () => {
  test("marks its newest Deployment that isn't inactive yet inactive, and no other", async () => {
    const result = await runStep(
      "down",
      "down",
      { SLUG: "blue" },
      {
        [DEPLOYMENTS]: [
          deployment(4, "cyan", "proto/cyan", "2026-10-20T12:00:00Z"),
          deployment(3, "blue", "proto/blue", "2026-10-20T11:00:00Z", "string"),
          deployment(2, "blue", "proto/blue", "2026-10-20T10:00:00Z"),
        ],
        [statuses(3)]: status("success"),
        [statuses(2)]: status("success"),
      },
    );

    expect(result.exitCode).toBe(0);
    expect(writes(result.calls)).toEqual([
      {
        method: "POST",
        path: `repos/${REPO}/deployments/3/statuses`,
        body: { state: "inactive", description: "taken down", auto_inactive: false },
      },
    ]);
  });

  test("does nothing when the Slug is down already", async () => {
    const result = await runStep(
      "down",
      "down",
      { SLUG: "blue" },
      {
        [DEPLOYMENTS]: [deployment(3, "blue", "proto/blue", "2026-10-20T11:00:00Z")],
        [statuses(3)]: status("inactive"),
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.out).toContain("has no Slug Preview to take down");
    expect(writes(result.calls)).toEqual([]);
  });
});

const foo = (id: number, createdAt: string) => deployment(id, "foo", "proto/foo", createdAt);
const version = (id: number, tags: string[]) => ({ id, metadata: { container: { tags } } });
const deleteOf = (pkg: string, id: number) =>
  `DELETE users/dkomeza/packages/container/${pkg}/versions/${id}`;
describe("the image sweep", () => {
  const down = {
    [DEPLOYMENTS]: [
      deployment(10, "blue", "proto/blue", "2026-10-20T10:00:00Z"),
      deployment(11, "cyan", "proto/cyan", "2026-10-20T10:00:00Z"),
      deployment(12, "proto-dusk", "proto/dusk", "2026-10-20T10:00:00Z", "string"),
      deployment(13, "echo", "proto/echo", "2026-10-20T09:00:00Z"),
      deployment(14, "echo", "proto/echo", "2026-10-20T11:00:00Z"),
    ],
    [statuses(10)]: status("inactive"),
    [statuses(11)]: status("success"),
    [statuses(12)]: status("inactive"),
    [statuses(13)]: status("success"),
    [statuses(14)]: status("inactive"),
  };

  test("deletes the versions of Slugs that are down or never deployed, and nothing else", async () => {
    const result = await runStep(
      "sweep",
      "sweep",
      {},
      {
        ...down,
        [versions("banki-api")]: [
          version(1, [`slug-blue-${SHA}`]),
          version(2, [`slug-cyan-${SHA}`]),
          version(3, [`slug-gone-${SHA}`]),
          version(4, [`pr-5-${SHA}`, `sha-${SHA}`]),
          version(5, [`slug-blue-${OTHER_SHA}`, "latest"]),
          version(6, []),
          version(7, [`slug-proto-dusk-${SHA}`]),
          version(8, [`slug-echo-${SHA}`, `slug-cyan-${OTHER_SHA}`]),
          version(9, [`slug-echo-${OTHER_SHA}`]),
        ],
        [versions("banki-web")]: [version(21, [`slug-blue-${SHA}`])],
      },
    );

    expect(result.exitCode).toBe(0);
    expect(writes(result.calls).map((call) => `${call.method} ${call.path}`)).toEqual([
      deleteOf("banki-api", 1),
      deleteOf("banki-api", 3),
      deleteOf("banki-api", 7),
      deleteOf("banki-api", 9),
      deleteOf("banki-web", 21),
    ]);
  });

  test("keeps the images of a Slug dispatched again while it swept, which its build reuses", async () => {
    const result = await runStep(
      "sweep",
      "sweep",
      {},
      {
        [DEPLOYMENTS]: {
          sequence: [
            [foo(30, "2026-10-20T10:00:00Z")],
            [foo(31, "2026-10-20T12:00:00Z"), foo(30, "2026-10-20T10:00:00Z")],
          ],
        },
        [statuses(30)]: status("inactive"),
        [statuses(31)]: status("queued"),
        [versions("banki-api")]: [version(1, [`slug-foo-${SHA}`])],
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.out).toContain("slug foo is up again, keeping version 1");
    expect(writes(result.calls)).toEqual([]);
  });

  test("reads the Slug's newest Deployment again right before deleting its images", async () => {
    const result = await runStep(
      "sweep",
      "sweep",
      {},
      {
        ...down,
        [versions("banki-api")]: [version(1, [`slug-blue-${SHA}`])],
      },
    );

    const paths = result.calls.map((call) => `${call.method} ${call.path}`);
    const lastRead = paths.lastIndexOf(DEPLOYMENTS);
    expect(paths.indexOf(DEPLOYMENTS)).toBeLessThan(lastRead);
    expect(paths.slice(lastRead + 1)).toEqual([
      statuses(10),
      `DELETE users/dkomeza/packages/container/banki-api/versions/1`,
    ]);
  });

  test("lists the versions before it reads the Deployments, so an image pushed meanwhile is kept", async () => {
    const result = await runStep("sweep", "sweep", {}, { ...down });

    const paths = result.calls.map((call) => `${call.method} ${call.path}`);
    expect(paths.indexOf(versions("banki-web"))).toBeLessThan(paths.indexOf(DEPLOYMENTS));
  });

  test("tolerates GHCR keeping a package's last version, and a version already deleted", async () => {
    const result = await runStep(
      "sweep",
      "sweep",
      {},
      {
        ...down,
        [versions("banki-api")]: [
          version(1, [`slug-blue-${SHA}`]),
          version(3, [`slug-gone-${SHA}`]),
        ],
        [deleteOf("banki-api", 1)]: {
          stderr: "gh: You cannot delete the last tagged version of a package. (HTTP 400)\n",
          exit: 1,
        },
        [deleteOf("banki-api", 3)]: { stderr: "gh: Not Found (HTTP 404)\n", exit: 1 },
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.out).toContain("kept version 1");
    expect(result.out).toContain("version 3 is already deleted");
  });

  test("fails on any other error deleting a version", async () => {
    const result = await runStep(
      "sweep",
      "sweep",
      {},
      {
        ...down,
        [versions("banki-api")]: [version(1, [`slug-blue-${SHA}`])],
        [deleteOf("banki-api", 1)]: { stderr: "gh: Server Error (HTTP 500)\n", exit: 1 },
      },
    );

    expect(result.exitCode).toBe(1);
  });

  test("skips a package that doesn't exist yet", async () => {
    const result = await runStep("sweep", "sweep", {}, { ...down });

    expect(result.exitCode).toBe(0);
    expect(result.out).toContain("banki-api: no package, nothing to delete");
    expect(writes(result.calls)).toEqual([]);
  });
});

describe("the workflow", () => {
  test("is dispatched with branch, slug, ttl_hours (72 by default) and down, and runs daily", () => {
    const dispatch = workflow.on.workflow_dispatch;

    expect(dispatch).toMatchObject({
      inputs: {
        branch: { type: "string", required: false },
        slug: { type: "string", required: true },
        ttl_hours: { type: "number", default: 72 },
        down: { type: "boolean", default: false },
      },
    });
    expect(workflow.on.schedule).toEqual([{ cron: expect.any(String) }]);
  });

  test("runs only the sweep on its schedule: every other job needs the dispatch's check", () => {
    const needs = (name: string): string[] => [job(name).needs ?? []].flat();
    const reaches = (name: string, target: string): boolean =>
      needs(name).some((needed) => needed === target || reaches(needed, target));

    expect(job("check").if).toBe("github.event_name == 'workflow_dispatch'");
    for (const name of Object.keys(workflow.jobs).filter((other) => other !== "check")) {
      expect(reaches(name, "check")).toBe(true);
    }
    expect(job("sweep").if).toContain("github.event_name == 'schedule'");
    expect(job("sweep").if).toContain("needs.down.result == 'success'");
  });

  test("never runs two dispatches of one Slug at the same time", () => {
    expect(workflow.concurrency.group).toContain("format('slug-preview-{0}', inputs.slug)");
    expect(workflow.concurrency["cancel-in-progress"]).toBe(false);
  });

  test("checks and claims before it builds, and builds only after both", () => {
    expect(job("claim").needs).toBe("check");
    expect(job("build").needs).toEqual(["check", "claim"]);
    expect(job("build-failed").if).toContain("needs.build.result != 'success'");
  });

  test("checks the branch out only to build it, with a token that can't touch Deployments", () => {
    const checkouts = Object.entries(workflow.jobs).filter(([, candidate]) =>
      candidate.steps.some((step) => step.uses?.startsWith("actions/checkout@") === true),
    );

    expect(checkouts.map(([name]) => name)).toEqual(["build"]);
    const build = job("build");
    expect(build.permissions).toEqual({ contents: "read", packages: "write" });
    expect(build.steps[0]?.with).toEqual({
      ref: "${{ needs.check.outputs.sha }}",
      "persist-credentials": false,
    });
    // No step runs anything from the checkout: Docker builds it, in BuildKit.
    for (const step of build.steps) {
      expect(step.run ?? "").not.toMatch(/\.\/|bun |npm |node |make |bash |sh /);
    }
    expect(workflow.permissions).toEqual({});
  });

  test("pushes both images tagged only slug-<slug>-<sha>", () => {
    const build = job("build");
    const push = build.steps.find((step) => step.uses?.startsWith("docker/build-push-action@"));

    expect(build.env?.TAG).toBe("slug-${{ inputs.slug }}-${{ needs.check.outputs.sha }}");
    expect(push?.with?.tags).toBe("${{ steps.image.outputs.name }}:${{ env.TAG }}");
    expect(push?.with?.platforms).toBe("linux/amd64");
  });

  test("never puts an expression into a script, where an input could become code", () => {
    for (const candidate of Object.values(workflow.jobs)) {
      for (const step of candidate.steps) expect(step.run ?? "").not.toContain("${{");
    }
  });
});
