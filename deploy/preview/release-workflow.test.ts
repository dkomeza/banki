import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isRecord } from "./agent/parse";
import { type Answer, REPO, workflowHarness, writes } from "./workflow-harness";

// The release workflow (ADR-0017), read from .github/workflows the way GitHub
// reads it. Each step's script runs here under bash against a fake `gh` and a
// fake `docker` that answer from fixtures and record every call. The rest is
// checked on the parsed workflow and release-please's config.

const { workflow, job, step, runStep } = workflowHarness("release.yml");

const SHA = "a".repeat(40);
const NEWER_SHA = "b".repeat(40);
const TAG = "v0.3.0";
const digest = (char: string) => `sha256:${char.repeat(64)}`;
const API = digest("1");
const WEB = digest("2");
const OTHER = digest("9");

const image = (app: string) => `ghcr.io/dkomeza/banki-${app}`;
const inspectJson = (ref: string) =>
  `docker buildx imagetools inspect ${ref} --format {{json .Manifest}}`;
const manifest = (indexDigest: string) => ({
  mediaType: "application/vnd.oci.image.index.v1+json",
  digest: indexDigest,
});

const env = { SHA, TAG, POLL_SECONDS: "0", WAIT_SECONDS: "3600" };

const edgeDeployments = `GET repos/${REPO}/deployments?environment=edge&sha=${SHA}&per_page=100`;
const productionDeployments = `GET repos/${REPO}/deployments?environment=production&per_page=100`;
const statuses = (id: number) => `GET repos/${REPO}/deployments/${id}/statuses?per_page=100`;
const deployment = (
  id: number,
  createdAt: string,
  payload: unknown = { sha: SHA, api: API, web: WEB },
  sha = SHA,
) => ({ id, sha, created_at: createdAt, payload, description: `Edge ${sha.slice(0, 7)}` });
/** A Deployment's statuses, given oldest first; GitHub lists the newest first. */
const history = (...states: string[]) =>
  states
    .map((state, index) => ({ id: index + 1, state, created_at: `2026-10-28T10:0${index}:00Z` }))
    .toReversed();

const waitForEdge = (fixtures: Record<string, Answer>, extra: Record<string, string> = {}) =>
  runStep("promote", "edge", { ...env, ...extra }, fixtures);

describe("waiting for Edge", () => {
  test("goes on once a Deployment of the commit succeeded, with its digests", async () => {
    const result = await waitForEdge({
      [edgeDeployments]: [deployment(7, "2026-10-28T10:00:00Z")],
      [statuses(7)]: history("queued", "in_progress", "success"),
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toBe(`api=${API}\nweb=${WEB}\n`);
    expect(writes(result.calls)).toEqual([]);
  });

  test("counts a success anywhere in a Deployment's history, inactive since", async () => {
    const result = await waitForEdge({
      [edgeDeployments]: [deployment(7, "2026-10-28T10:00:00Z")],
      [statuses(7)]: history("queued", "success", "inactive"),
    });

    expect(result.exitCode).toBe(0);
  });

  test("takes the newest successful Deployment's digests, past an older failure", async () => {
    const result = await waitForEdge({
      [edgeDeployments]: [
        deployment(7, "2026-10-28T10:00:00Z", { sha: SHA, api: OTHER, web: OTHER }),
        deployment(8, "2026-10-28T11:00:00Z"),
        deployment(6, "2026-10-28T09:00:00Z"),
      ],
      [statuses(6)]: history("queued", "failure"),
      [statuses(7)]: history("queued", "success", "inactive"),
      [statuses(8)]: history("queued", "success"),
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toBe(`api=${API}\nweb=${WEB}\n`);
  });

  test("waits while there is no Deployment yet, and while it is pending", async () => {
    const result = await waitForEdge({
      [edgeDeployments]: { sequence: [[], [deployment(7, "2026-10-28T10:00:00Z")]] },
      [statuses(7)]: { sequence: [history("queued"), history("queued", "in_progress", "success")] },
    });

    expect(result.exitCode).toBe(0);
    expect(result.out).toContain(`Waiting for Edge to run ${SHA}`);
    expect(result.calls.filter((call) => call.path.includes("environment=edge"))).toHaveLength(3);
  });

  test("fails when Edge failed on the commit", async () => {
    for (const failed of ["failure", "error"]) {
      const result = await waitForEdge({
        [edgeDeployments]: [deployment(7, "2026-10-28T10:00:00Z")],
        [statuses(7)]: history("queued", "in_progress", failed),
      });

      expect(result.exitCode).toBe(1);
      expect(result.out).toContain(`Edge failed to deploy ${SHA}`);
      expect(result.output).toBe("");
    }
  });

  test("fails when a newer merge superseded the Deployment before Edge ran it", async () => {
    const result = await waitForEdge({
      [edgeDeployments]: [deployment(7, "2026-10-28T10:00:00Z")],
      [statuses(7)]: history("queued", "inactive"),
    });

    expect(result.exitCode).toBe(1);
    expect(result.out).toContain("was superseded before Edge ran it");
  });

  test("fails once the wait runs out", async () => {
    const result = await waitForEdge(
      {
        [edgeDeployments]: [deployment(7, "2026-10-28T10:00:00Z")],
        [statuses(7)]: history("queued"),
      },
      { WAIT_SECONDS: "0" },
    );

    expect(result.exitCode).toBe(1);
    expect(result.out).toContain(`Edge hasn't run ${SHA} after 0 minutes`);
  });

  test("fails on a payload of another commit, or without digests", async () => {
    for (const payload of [
      { sha: NEWER_SHA, api: API, web: WEB },
      { sha: SHA, api: API },
      "not json",
    ]) {
      const result = await waitForEdge({
        [edgeDeployments]: [deployment(7, "2026-10-28T10:00:00Z", payload)],
        [statuses(7)]: history("success"),
      });

      expect(result.exitCode).toBe(1);
      expect(result.output).toBe("");
    }
  });

  test("reads a payload GitHub returns as a string", async () => {
    const result = await waitForEdge({
      [edgeDeployments]: [
        deployment(7, "2026-10-28T10:00:00Z", JSON.stringify({ sha: SHA, api: API, web: WEB })),
      ],
      [statuses(7)]: history("success"),
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toBe(`api=${API}\nweb=${WEB}\n`);
  });

  test("fails without a commit or a version tag from release-please", async () => {
    const bad: Record<string, string>[] = [{ SHA: "" }, { TAG: "" }, { TAG: "banki-v0.3.0" }];
    for (const each of bad) {
      const result = await waitForEdge({}, each);

      expect(result.exitCode).toBe(1);
      expect(result.calls).toEqual([]);
    }
  });
});

const creates = (docker: string[][]) => docker.filter((args) => args.includes("create"));

describe("tagging the images", () => {
  const built = {
    [inspectJson(`${image("api")}:sha-${SHA}`)]: manifest(API),
    [inspectJson(`${image("web")}:sha-${SHA}`)]: manifest(WEB),
  };
  const tagged = {
    [inspectJson(`${image("api")}:${TAG}`)]: { sequence: [{}, manifest(API)] },
    [inspectJson(`${image("web")}:${TAG}`)]: { sequence: [{}, manifest(WEB)] },
  };
  const tag = (fixtures: Record<string, Answer>) =>
    runStep("promote", "tag", { ...env, API, WEB }, fixtures);

  test("tags exactly the digests Edge ran as the version, and reads the tags back", async () => {
    const result = await tag({ ...built, ...tagged });

    expect(result.exitCode).toBe(0);
    expect(creates(result.docker)).toEqual([
      [
        "buildx",
        "imagetools",
        "create",
        "--tag",
        `${image("api")}:${TAG}`,
        `${image("api")}@${API}`,
      ],
      [
        "buildx",
        "imagetools",
        "create",
        "--tag",
        `${image("web")}:${TAG}`,
        `${image("web")}@${WEB}`,
      ],
    ]);
  });

  test("tags nothing when a digest isn't the commit's sha-<sha> manifest", async () => {
    const result = await tag({
      ...built,
      [inspectJson(`${image("web")}:sha-${SHA}`)]: manifest(OTHER),
      ...tagged,
    });

    expect(result.exitCode).toBe(1);
    expect(result.out).toContain(`but ${image("web")}:sha-${SHA} is ${OTHER}`);
    expect(creates(result.docker)).toEqual([]);
  });

  test("tags nothing when the commit's manifest is missing", async () => {
    const result = await tag({ [inspectJson(`${image("api")}:sha-${SHA}`)]: manifest(API) });

    expect(result.exitCode).toBe(1);
    expect(creates(result.docker)).toEqual([]);
  });

  test("never moves a version tag that is already on other images", async () => {
    const result = await tag({
      ...built,
      [inspectJson(`${image("api")}:${TAG}`)]: manifest(OTHER),
    });

    expect(result.exitCode).toBe(1);
    expect(result.out).toContain(`${image("api")}:${TAG} is already ${OTHER}`);
    expect(creates(result.docker)).toEqual([]);
  });

  test("re-tags on a re-run when the tag is already on the same images", async () => {
    const result = await tag({
      ...built,
      [inspectJson(`${image("api")}:${TAG}`)]: manifest(API),
      [inspectJson(`${image("web")}:${TAG}`)]: manifest(WEB),
    });

    expect(result.exitCode).toBe(0);
    expect(creates(result.docker)).toHaveLength(2);
  });

  test("fails when a tag reads back as another digest", async () => {
    const result = await tag({
      ...built,
      [inspectJson(`${image("api")}:${TAG}`)]: { sequence: [{}, manifest(OTHER)] },
    });

    expect(result.exitCode).toBe(1);
    expect(result.out).toContain(`${image("api")}:${TAG} is ${OTHER}, not ${API}`);
  });
});

const deploy = (fixtures: Record<string, Answer>) =>
  runStep("promote", "production", { ...env, API, WEB }, fixtures);
const production = (id: number, sha: string, createdAt: string, api = API) => ({
  id,
  sha,
  created_at: createdAt,
  payload: { sha, api, web: WEB },
});

describe("deploying Production", () => {
  const created = {
    [productionDeployments]: [],
    [`POST repos/${REPO}/deployments`]: { id: 42 },
  };

  test("creates a production Deployment of the release commit with Edge's digests, queued", async () => {
    const result = await deploy(created);

    expect(result.exitCode).toBe(0);
    expect(writes(result.calls)).toEqual([
      {
        method: "POST",
        path: `repos/${REPO}/deployments`,
        body: {
          ref: SHA,
          environment: "production",
          payload: { sha: SHA, api: API, web: WEB },
          description: `Production ${TAG}`,
          required_contexts: [],
          auto_merge: false,
          transient_environment: false,
          production_environment: true,
        },
      },
      {
        method: "POST",
        path: `repos/${REPO}/deployments/42/statuses`,
        body: { state: "queued", description: "waiting for the agent", auto_inactive: false },
      },
    ]);
    expect(result.output).toBe("id=42\n");
  });

  test("deploys over an older Release's Deployment", async () => {
    const result = await deploy({
      ...created,
      [productionDeployments]: [production(30, NEWER_SHA, "2026-10-20T10:00:00Z")],
      [`GET repos/${REPO}/compare/${SHA}...${NEWER_SHA}`]: { status: "behind" },
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toBe("id=42\n");
  });

  test("never takes Production back to an older commit", async () => {
    const result = await deploy({
      ...created,
      [productionDeployments]: [production(30, NEWER_SHA, "2026-10-29T10:00:00Z")],
      [`GET repos/${REPO}/compare/${SHA}...${NEWER_SHA}`]: { status: "ahead" },
    });

    expect(result.exitCode).toBe(1);
    expect(writes(result.calls)).toEqual([]);
  });

  test("fails when it can't compare the commits", async () => {
    const result = await deploy({
      ...created,
      [productionDeployments]: [production(30, NEWER_SHA, "2026-10-29T10:00:00Z")],
    });

    expect(result.exitCode).toBe(1);
    expect(writes(result.calls)).toEqual([]);
  });

  test("reuses a re-run's Deployment that already succeeded", async () => {
    const result = await deploy({
      ...created,
      [productionDeployments]: [production(41, SHA, "2026-10-28T10:00:00Z")],
      [`GET repos/${REPO}/deployments/41/statuses?per_page=1`]: [{ id: 3, state: "success" }],
    });

    expect(result.exitCode).toBe(0);
    expect(writes(result.calls)).toEqual([]);
    expect(result.output).toBe("id=41\n");
  });

  test("deploys again on a re-run whose Deployment failed", async () => {
    const result = await deploy({
      ...created,
      [productionDeployments]: [production(41, SHA, "2026-10-28T10:00:00Z")],
      [`GET repos/${REPO}/deployments/41/statuses?per_page=1`]: [{ id: 3, state: "failure" }],
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toBe("id=42\n");
  });

  test("fails when GitHub creates no Deployment", async () => {
    const result = await deploy({});

    expect(result.exitCode).toBe(1);
    expect(result.output).toBe("");
  });
});

const waitForProduction = (fixtures: Record<string, Answer>, extra: Record<string, string> = {}) =>
  runStep("promote", "deployed", { ...env, ID: "42", ...extra }, fixtures);

describe("waiting for Production", () => {
  test("goes on once Production reports success", async () => {
    const result = await waitForProduction({
      [statuses(42)]: {
        sequence: [history("queued"), history("queued", "in_progress", "success")],
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.out).toContain("Waiting for Production");
  });

  test("fails when Production failed or the Deployment went inactive", async () => {
    for (const ended of ["failure", "error", "inactive"]) {
      const result = await waitForProduction({
        [statuses(42)]: history("queued", "in_progress", ended),
      });

      expect(result.exitCode).toBe(1);
      expect(result.out).toContain(`ended ${ended}`);
    }
  });

  test("fails once the wait runs out", async () => {
    const result = await waitForProduction(
      { [statuses(42)]: history("queued") },
      { WAIT_SECONDS: "0" },
    );

    expect(result.exitCode).toBe(1);
    expect(result.out).toContain(`Production hasn't run ${TAG}`);
  });

  test("fails without a Deployment", async () => {
    const result = await waitForProduction({}, { ID: "" });

    expect(result.exitCode).toBe(1);
    expect(result.calls).toEqual([]);
  });
});

describe("moving latest", () => {
  test("tags both images by digest as latest, and reads it back", async () => {
    const result = await runStep(
      "promote",
      "latest",
      { ...env, API, WEB },
      {
        [inspectJson(`${image("api")}:latest`)]: manifest(API),
        [inspectJson(`${image("web")}:latest`)]: manifest(WEB),
      },
    );

    expect(result.exitCode).toBe(0);
    expect(creates(result.docker)).toEqual([
      [
        "buildx",
        "imagetools",
        "create",
        "--tag",
        `${image("api")}:latest`,
        `${image("api")}@${API}`,
      ],
      [
        "buildx",
        "imagetools",
        "create",
        "--tag",
        `${image("web")}:latest`,
        `${image("web")}@${WEB}`,
      ],
    ]);
  });

  test("fails when latest reads back as another digest", async () => {
    const result = await runStep(
      "promote",
      "latest",
      { ...env, API, WEB },
      { [inspectJson(`${image("api")}:latest`)]: manifest(OTHER) },
    );

    expect(result.exitCode).toBe(1);
  });
});

const NOTES =
  "## [0.3.0](https://github.com/dkomeza/banki/compare/v0.2.0...v0.3.0)\n\n### Features";
const releaseByTag = (tag: string) => `GET repos/${REPO}/releases/tags/${tag}`;

describe("marking the Release shipped", () => {
  test("leaves a Release alone that was never marked", async () => {
    const result = await runStep("promote", "shipped", env, {
      [releaseByTag(TAG)]: { id: 5, body: NOTES },
    });

    expect(result.exitCode).toBe(0);
    expect(writes(result.calls)).toEqual([]);
  });

  test("takes an earlier attempt's mark off, and makes it GitHub's Latest", async () => {
    const result = await runStep("promote", "shipped", env, {
      [releaseByTag(TAG)]: {
        id: 5,
        body: `**Not shipped:** Edge failed on this commit, and the next Release carries the fix.\n\n${NOTES}`,
      },
    });

    expect(result.exitCode).toBe(0);
    expect(writes(result.calls)).toEqual([
      {
        method: "PATCH",
        path: `repos/${REPO}/releases/5`,
        body: { body: NOTES, make_latest: "true" },
      },
    ]);
  });
});

const unship = (edge: string, fixtures: Record<string, Answer>) =>
  runStep("promote", "unshipped", { ...env, EDGE: edge }, fixtures);

describe("marking the Release not shipped", () => {
  const edgeLine =
    "**Not shipped:** Edge failed on this commit, and the next Release carries the fix.";
  const productionLine =
    "**Not shipped:** Production failed to deploy it, and the next Release carries the fix.";
  const shippedBefore = {
    [productionDeployments]: [
      { id: 40, created_at: "2026-10-27T10:00:00Z", description: "Production v0.2.1" },
      { id: 30, created_at: "2026-10-20T10:00:00Z", description: "Production v0.2.0" },
      { id: 41, created_at: "2026-10-28T10:00:00Z", description: `Production ${TAG}` },
    ],
    [statuses(40)]: history("queued", "in_progress", "failure"),
    [statuses(30)]: history("queued", "success", "inactive"),
    [statuses(41)]: history("queued", "in_progress", "failure"),
    [releaseByTag("v0.2.0")]: { id: 3 },
  };
  test("says Edge failed, and gives GitHub's Latest back to the last Release Production ran", async () => {
    const result = await unship("failure", {
      [releaseByTag(TAG)]: { id: 5, body: NOTES },
      ...shippedBefore,
    });

    expect(result.exitCode).toBe(0);
    expect(writes(result.calls)).toEqual([
      {
        method: "PATCH",
        path: `repos/${REPO}/releases/5`,
        body: { body: `${edgeLine}\n\n${NOTES}`, make_latest: "false" },
      },
      { method: "PATCH", path: `repos/${REPO}/releases/3`, body: { make_latest: "true" } },
    ]);
  });

  test("says Production failed when Edge didn't", async () => {
    const result = await unship("success", {
      [releaseByTag(TAG)]: { id: 5, body: NOTES },
      ...shippedBefore,
    });

    expect(result.exitCode).toBe(0);
    expect(writes(result.calls)[0]?.body).toEqual({
      body: `${productionLine}\n\n${NOTES}`,
      make_latest: "false",
    });
  });

  test("replaces an earlier attempt's mark rather than stacking another", async () => {
    const result = await unship("success", {
      [releaseByTag(TAG)]: { id: 5, body: `${edgeLine}\n\n${NOTES}` },
      ...shippedBefore,
    });

    expect(writes(result.calls)[0]?.body).toEqual({
      body: `${productionLine}\n\n${NOTES}`,
      make_latest: "false",
    });
  });

  test("moves GitHub's Latest nowhere before Production has run any Release", async () => {
    const result = await unship("failure", {
      [releaseByTag(TAG)]: { id: 5, body: NOTES },
      [productionDeployments]: [],
    });

    expect(result.exitCode).toBe(0);
    expect(writes(result.calls)).toHaveLength(1);
    expect(result.out).toContain("Production has run no Release yet");
  });
});

describe("the workflow", () => {
  test("runs on every push to main", () => {
    expect(workflow.on).toEqual({ push: { branches: ["main"] } });
  });

  test("gives each job only the permissions it needs", () => {
    expect(workflow.permissions).toEqual({});
    expect(job("release-please").permissions).toEqual({
      contents: "write",
      issues: "write",
      "pull-requests": "write",
    });
    expect(job("promote").permissions).toEqual({
      contents: "write",
      deployments: "write",
      packages: "write",
    });
  });

  test("promotes only when release-please created a Release, in the same run, one at a time", () => {
    expect(job("promote").needs).toBe("release-please");
    expect(job("promote").if).toBe("needs.release-please.outputs.created == 'true'");
    expect(job("release-please").outputs).toEqual({
      created: "${{ steps.release.outputs.release_created }}",
      tag: "${{ steps.release.outputs.tag_name }}",
      sha: "${{ steps.release.outputs.sha }}",
    });
    expect(job("promote").concurrency).toEqual({
      group: "release-promotion",
      "cancel-in-progress": false,
    });
    expect(job("promote").env).toMatchObject({
      SHA: "${{ needs.release-please.outputs.sha }}",
      TAG: "${{ needs.release-please.outputs.tag }}",
      WAIT_SECONDS: "3600",
    });
  });

  test("runs release-please with GITHUB_TOKEN and the repo's config", () => {
    const release = step("release-please", "release");
    expect(release.uses).toMatch(/^googleapis\/release-please-action@[0-9a-f]{40}$/);
    expect(release.with).toEqual({
      "config-file": "release-please-config.json",
      "manifest-file": ".release-please-manifest.json",
    });
  });

  test("waits, tags, deploys, waits and moves latest, in that order", () => {
    const ids = job("promote").steps.flatMap((each) => (each.id === undefined ? [] : [each.id]));
    expect(ids).toEqual([
      "edge",
      "tag",
      "production",
      "deployed",
      "latest",
      "shipped",
      "unshipped",
    ]);
  });

  test("marks the Release not shipped only when Edge or Production failed", () => {
    expect(step("promote", "unshipped").if).toBe(
      "failure() && (steps.edge.outcome == 'failure' || steps.deployed.outcome == 'failure')",
    );
    expect(step("promote", "shipped").if).toBeUndefined();
  });

  test("pins every action by SHA", () => {
    const source = readFileSync(
      join(import.meta.dir, "..", "..", ".github", "workflows", "release.yml"),
      "utf8",
    );
    const uses = [...source.matchAll(/uses: (\S+)/g)].map((match) => match[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const action of uses) expect(action).toMatch(/@[0-9a-f]{40}$/);
  });

  test("never puts an expression into a script", () => {
    for (const candidate of Object.values(workflow.jobs)) {
      for (const each of candidate.steps) expect(each.run ?? "").not.toContain("${{");
    }
  });
});

describe("release-please's config", () => {
  const root = join(import.meta.dir, "..", "..");
  const readJson = (path: string): unknown => JSON.parse(readFileSync(join(root, path), "utf8"));
  const packages = [
    "package.json",
    "apps/api/package.json",
    "apps/web/package.json",
    "packages/shared/package.json",
  ];

  test("releases the whole repo as one version, tagged vX.Y.Z, from 0.0.0", () => {
    expect(readJson(".release-please-manifest.json")).toEqual({ ".": "0.0.0" });
    for (const path of packages) expect(readJson(path)).toMatchObject({ version: "0.0.0" });
    expect(readJson("release-please-config.json")).toMatchObject({
      "include-component-in-tag": false,
      "include-v-in-tag": true,
      "bump-minor-pre-major": true,
      packages: {
        ".": {
          "release-type": "node",
          "extra-files": packages.slice(1).map((path) => ({
            type: "json",
            path,
            jsonpath: "$.version",
          })),
        },
      },
    });
  });

  test("shows only Features and Fixes in the notes", () => {
    const config = readJson("release-please-config.json");
    const sections = isRecord(config) ? config["changelog-sections"] : undefined;
    const shown = Array.isArray(sections)
      ? sections.filter((section) => isRecord(section) && section.hidden !== true)
      : [];
    expect(shown).toEqual([
      { type: "feat", section: "Features" },
      { type: "fix", section: "Fixes" },
    ]);
  });

  test("starts after the prototype, at the walking skeleton's parent", () => {
    expect(readJson("release-please-config.json")).toMatchObject({
      "bootstrap-sha": "daeb32bb0e6b2ce93b1e546888983768b7ed12ee",
    });
  });
});
