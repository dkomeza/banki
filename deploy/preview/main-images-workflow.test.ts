import { describe, expect, test } from "bun:test";
import { type Answer, REPO, workflowHarness, writes } from "./workflow-harness";

// The main-images workflow (ADR-0017), read from .github/workflows the way
// GitHub reads it. Each step's script runs here under bash against a fake
// `gh` and a fake `docker` that answer from fixtures and record every call.
// The rest is checked on the parsed workflow: triggers, permissions,
// concurrency, the jobs' order and what the builds push.

const { workflow, job, step, runStep } = workflowHarness("main-images.yml");

const SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);
const digest = (char: string) => `sha256:${char.repeat(64)}`;
const API_AMD64 = digest("1");
const API_ARM64 = digest("2");
const WEB_AMD64 = digest("3");
const WEB_ARM64 = digest("4");
const API_INDEX = digest("5");
const WEB_INDEX = digest("6");

const image = (app: string) => `ghcr.io/dkomeza/banki-${app}`;
const inspect = (ref: string) => `docker buildx imagetools inspect ${ref}`;
const inspectJson = (ref: string) => `${inspect(ref)} --format {{json .Manifest}}`;
/** A multi-arch index as `imagetools inspect --format '{{json .Manifest}}'` prints it. */
const index = (indexDigest: string, platforms: [string, string][]) => ({
  mediaType: "application/vnd.oci.image.index.v1+json",
  digest: indexDigest,
  size: 500,
  manifests: platforms.map(([platformDigest, arch]) => ({
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    digest: platformDigest,
    size: 400,
    platform: { architecture: arch, os: "linux" },
  })),
});

describe("merging the platform images", () => {
  const built = {
    "digests/api-amd64": API_AMD64,
    "digests/api-arm64": API_ARM64,
    "digests/web-amd64": WEB_AMD64,
    "digests/web-arm64": WEB_ARM64,
  };
  const manifests = {
    [inspectJson(`${image("api")}:sha-${SHA}`)]: index(API_INDEX, [
      [API_AMD64, "amd64"],
      [API_ARM64, "arm64"],
    ]),
    [inspectJson(`${image("web")}:sha-${SHA}`)]: index(WEB_INDEX, [
      [WEB_ARM64, "arm64"],
      [WEB_AMD64, "amd64"],
    ]),
  };
  const merge = (fixtures: Record<string, Answer>, files: Record<string, string> = built) =>
    runStep("merge", "merge", { SHA, DIGESTS: "digests" }, fixtures, files);

  test("joins each image's two platforms into one manifest tagged main and sha-<sha>", async () => {
    const result = await merge(manifests);

    expect(result.exitCode).toBe(0);
    const creates = result.docker.filter((args) => args.includes("create"));
    expect(creates).toEqual([
      [
        "buildx",
        "imagetools",
        "create",
        "--tag",
        `${image("api")}:main`,
        "--tag",
        `${image("api")}:sha-${SHA}`,
        `${image("api")}@${API_AMD64}`,
        `${image("api")}@${API_ARM64}`,
      ],
      [
        "buildx",
        "imagetools",
        "create",
        "--tag",
        `${image("web")}:main`,
        "--tag",
        `${image("web")}:sha-${SHA}`,
        `${image("web")}@${WEB_AMD64}`,
        `${image("web")}@${WEB_ARM64}`,
      ],
    ]);
  });

  test("gives the index digests the Deployment records", async () => {
    const result = await merge(manifests);

    expect(result.output).toBe(`api=${API_INDEX}\nweb=${WEB_INDEX}\n`);
  });

  test("keeps a manifest a run before pushed, and still gives its digest", async () => {
    const result = await merge(
      {
        ...manifests,
        [inspect(`${image("api")}:sha-${SHA}`)]: { stdout: "" },
        [inspect(`${image("web")}:sha-${SHA}`)]: { stdout: "" },
      },
      {
        "digests/api-amd64": "",
        "digests/api-arm64": "",
        "digests/web-amd64": "",
        "digests/web-arm64": "",
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.docker.filter((args) => args.includes("create"))).toEqual([]);
    expect(result.output).toBe(`api=${API_INDEX}\nweb=${WEB_INDEX}\n`);
  });

  test("fails when a platform image is missing, creating nothing for it", async () => {
    const result = await merge(manifests, { ...built, "digests/web-arm64": "" });

    expect(result.exitCode).toBe(1);
    expect(result.out).toContain(`no linux/arm64 image of web was built for ${SHA}`);
    expect(result.docker.filter((args) => args.includes(`${image("web")}:main`))).toEqual([]);
  });

  test("fails when the manifest doesn't hold both platforms", async () => {
    const result = await merge({
      ...manifests,
      [inspectJson(`${image("api")}:sha-${SHA}`)]: index(API_INDEX, [[API_AMD64, "amd64"]]),
    });

    expect(result.exitCode).toBe(1);
    expect(result.out).toContain("not linux/amd64 and linux/arm64");
    expect(result.output).toBe("");
  });
});

const EDGE = `GET repos/${REPO}/deployments?environment=edge&per_page=100`;
const compare = (base: string, head: string) => `GET repos/${REPO}/compare/${base}...${head}`;
const edgeDeployment = (id: number, sha: string, createdAt: string) => ({
  id,
  sha,
  created_at: createdAt,
  payload: { sha, api: API_INDEX, web: WEB_INDEX },
});

describe("the Edge Deployment", () => {
  const create = (fixtures: Record<string, Answer>, env: Record<string, string> = {}) =>
    runStep(
      "edge",
      "create",
      { SHA, API: API_INDEX, WEB: WEB_INDEX, ...env },
      { [`POST repos/${REPO}/deployments`]: { id: 777 }, ...fixtures },
    );
  const created = [
    {
      method: "POST",
      path: `repos/${REPO}/deployments`,
      body: {
        ref: SHA,
        environment: "edge",
        payload: { sha: SHA, api: API_INDEX, web: WEB_INDEX },
        description: "Edge aaaaaaa",
        required_contexts: [],
        auto_merge: false,
        transient_environment: false,
        production_environment: false,
      },
    },
    {
      method: "POST",
      path: `repos/${REPO}/deployments/777/statuses`,
      body: { state: "queued", description: "waiting for the agent", auto_inactive: false },
    },
  ];

  test("is created for the commit with the index digests, queued, when Edge has none", async () => {
    const result = await create({ [EDGE]: [] });

    expect(result.exitCode).toBe(0);
    expect(writes(result.calls)).toEqual(created);
    expect(result.output).toBe("deployment=777\n");
  });

  test("is created again for the same commit, which redeploys Edge", async () => {
    const result = await create({ [EDGE]: [edgeDeployment(5, SHA, "2026-10-20T10:00:00Z")] });

    expect(result.exitCode).toBe(0);
    expect(writes(result.calls)).toEqual(created);
  });

  test("is created when the newest Deployment's commit is an ancestor", async () => {
    const result = await create({
      [EDGE]: [edgeDeployment(5, OTHER_SHA, "2026-10-20T10:00:00Z")],
      [compare(SHA, OTHER_SHA)]: { status: "behind" },
    });

    expect(result.exitCode).toBe(0);
    expect(writes(result.calls)).toEqual(created);
  });

  test("is never created when the newest Deployment's commit is a descendant", async () => {
    const result = await create({
      [EDGE]: [
        edgeDeployment(4, SHA, "2026-10-20T09:00:00Z"),
        edgeDeployment(5, OTHER_SHA, "2026-10-20T10:00:00Z"),
      ],
      [compare(SHA, OTHER_SHA)]: { status: "ahead" },
    });

    expect(result.exitCode).toBe(0);
    expect(result.out).toContain(`a descendant of ${SHA}: this build finished out of order`);
    expect(writes(result.calls)).toEqual([]);
  });

  test("compares with the newest Deployment only", async () => {
    const result = await create({
      [EDGE]: [
        edgeDeployment(6, OTHER_SHA, "2026-10-20T09:00:00Z"),
        edgeDeployment(7, SHA, "2026-10-20T11:00:00Z"),
      ],
    });

    expect(result.exitCode).toBe(0);
    expect(result.calls.map((call) => call.path)).not.toContain(
      `repos/${REPO}/compare/${SHA}...${OTHER_SHA}`,
    );
    expect(writes(result.calls)).toEqual(created);
  });

  test("fails, creating nothing, when the commits can't be compared", async () => {
    const result = await create({ [EDGE]: [edgeDeployment(5, OTHER_SHA, "2026-10-20T10:00:00Z")] });

    expect(result.exitCode).not.toBe(0);
    expect(writes(result.calls)).toEqual([]);
  });

  test("fails, creating nothing, without both index digests", async () => {
    const result = await create({ [EDGE]: [] }, { WEB: "" });

    expect(result.exitCode).toBe(1);
    expect(result.calls).toEqual([]);
  });
});

const versionsOf = (pkg: string) =>
  `GET users/dkomeza/packages/container/${pkg}/versions?per_page=100`;
const deleteOf = (pkg: string, id: number) =>
  `DELETE users/dkomeza/packages/container/${pkg}/versions/${id}`;
const version = (id: number, name: string, tags: string[], createdAt: string) => ({
  id,
  name,
  created_at: createdAt,
  metadata: { container: { tags } },
});
const nameOf = (id: number) => `sha256:${String(id).padStart(64, "0")}`;
/** A main build: its index and its two platform manifests, created on `day`. */
const mainBuild = (
  id: number,
  day: number,
  tags: string[] = [`sha-${String(id).repeat(40).slice(0, 40)}`],
) => {
  const createdAt = `2026-10-${String(day).padStart(2, "0")}T10:00:00Z`;
  return [
    version(id, nameOf(id), tags, createdAt),
    version(id + 1000, nameOf(id + 1000), [], createdAt),
    version(id + 2000, nameOf(id + 2000), [], createdAt),
  ];
};
const buildIndex = (pkg: string, id: number) => ({
  [inspectJson(`ghcr.io/dkomeza/${pkg}@${nameOf(id)}`)]: index(nameOf(id), [
    [nameOf(id + 1000), "amd64"],
    [nameOf(id + 2000), "arm64"],
  ]),
});
const deletesOfBuild = (pkg: string, id: number) => [
  deleteOf(pkg, id + 1000),
  deleteOf(pkg, id + 2000),
  deleteOf(pkg, id),
];

const sweep = (fixtures: Record<string, Answer>) => runStep("sweep", "sweep", {}, fixtures);

describe("the sweep", () => {
  // Builds 1 to 13 on days 1 to 13; build 2 is tagged main.
  const builds = Array.from({ length: 13 }, (_, i) =>
    mainBuild(i + 1, i + 1, i + 1 === 2 ? ["main", `sha-${SHA}`] : undefined),
  ).flat();
  const others = [
    version(500, nameOf(500), ["v0.0.1"], "2026-09-01T10:00:00Z"),
    version(501, nameOf(501), ["v0.1.0", "latest", `sha-${OTHER_SHA}`], "2026-09-01T10:00:00Z"),
    version(502, nameOf(502), ["pr-5", `pr-5-${SHA}`], "2026-09-01T10:00:00Z"),
    version(503, nameOf(503), [`pr-6-${SHA}`, `sha-${SHA}`], "2026-09-01T10:00:00Z"),
    version(504, nameOf(504), [`slug-blue-${SHA}`], "2026-09-01T10:00:00Z"),
    version(505, nameOf(505), [], "2026-09-01T10:00:00Z"),
  ];
  test("keeps the ten newest main builds and the one tagged main, and deletes the rest with their platform manifests", async () => {
    const result = await sweep({
      [versionsOf("banki-api")]: [...others, ...builds],
      ...buildIndex("banki-api", 1),
      ...buildIndex("banki-api", 3),
    });

    expect(result.exitCode).toBe(0);
    expect(writes(result.calls).map((call) => `${call.method} ${call.path}`)).toEqual([
      ...deletesOfBuild("banki-api", 3),
      ...deletesOfBuild("banki-api", 1),
    ]);
  });

  test("never touches a version with any other tag, or an untagged one", async () => {
    const result = await sweep({
      [versionsOf("banki-web")]: [...others, ...builds],
      ...buildIndex("banki-web", 1),
      ...buildIndex("banki-web", 3),
    });

    const deleted = writes(result.calls).map((call) => call.path);
    for (const id of [500, 501, 502, 503, 504, 505]) {
      expect(deleted).not.toContain(`users/dkomeza/packages/container/banki-web/versions/${id}`);
    }
  });

  test("deletes nothing while there are ten main builds or fewer", async () => {
    const result = await sweep({
      [versionsOf("banki-api")]: [...others, ...builds.slice(9)],
    });

    expect(result.exitCode).toBe(0);
    expect(writes(result.calls)).toEqual([]);
    expect(result.docker).toEqual([]);
  });

  test("deletes the index even when a platform manifest isn't listed", async () => {
    const result = await sweep({
      [versionsOf("banki-api")]: builds.filter((listed) => listed.id !== 1001),
      ...buildIndex("banki-api", 1),
      ...buildIndex("banki-api", 3),
    });

    expect(result.exitCode).toBe(0);
    expect(writes(result.calls).map((call) => `${call.method} ${call.path}`)).toEqual([
      ...deletesOfBuild("banki-api", 3),
      deleteOf("banki-api", 2001),
      deleteOf("banki-api", 1),
    ]);
  });

  test("tolerates GHCR keeping a version, and a version already deleted", async () => {
    const result = await sweep({
      [versionsOf("banki-api")]: builds,
      ...buildIndex("banki-api", 1),
      ...buildIndex("banki-api", 3),
      [deleteOf("banki-api", 3)]: {
        stderr: "gh: You cannot delete the last tagged version of a package. (HTTP 400)\n",
        exit: 1,
      },
      [deleteOf("banki-api", 1001)]: {
        stderr:
          "gh: Publicly visible package versions with more than 5000 downloads cannot be deleted. Contact GitHub support for further assistance. (HTTP 400)\n",
        exit: 1,
      },
      [deleteOf("banki-api", 1)]: { stderr: "gh: Not Found (HTTP 404)\n", exit: 1 },
    });

    expect(result.exitCode).toBe(0);
    expect(result.out).toContain("kept version 3");
    expect(result.out).toContain("kept version 1001");
    expect(result.out).toContain("version 1 is already deleted");
  });

  test("fails on any other error deleting a version", async () => {
    for (const stderr of [
      "gh: Server Error (HTTP 500)\n",
      "gh: Package version is invalid. (HTTP 400)\n",
    ]) {
      const result = await sweep({
        [versionsOf("banki-api")]: builds,
        ...buildIndex("banki-api", 1),
        ...buildIndex("banki-api", 3),
        [deleteOf("banki-api", 1003)]: { stderr, exit: 1 },
      });

      expect(result.exitCode).toBe(1);
    }
  });

  test("fails when a build's index can't be read, before deleting any of it", async () => {
    const result = await sweep({
      [versionsOf("banki-api")]: builds,
      ...buildIndex("banki-api", 1),
    });

    expect(result.exitCode).not.toBe(0);
    expect(writes(result.calls)).toEqual([]);
  });

  test("skips a package that doesn't exist yet", async () => {
    const result = await sweep({});

    expect(result.exitCode).toBe(0);
    expect(result.out).toContain("banki-api: no package, nothing to delete");
    expect(result.out).toContain("banki-web: no package, nothing to delete");
  });
});

describe("the workflow", () => {
  test("builds on every push to main, and sweeps daily and on a dispatch", () => {
    expect(workflow.on.push).toEqual({ branches: ["main"] });
    expect(workflow.on.schedule).toEqual([{ cron: expect.any(String) }]);
    expect("workflow_dispatch" in workflow.on).toBe(true);
    for (const name of ["build", "sweep"]) expect(job(name).if).toBeDefined();
    expect(job("build").if).toBe("github.event_name == 'push'");
    expect(job("sweep").if).toBe("github.event_name != 'push'");
    expect(job("sweep").needs).toBeUndefined();
  });

  test("never cancels a run, and runs one per commit", () => {
    expect(workflow.concurrency.group).toContain("format('main-images-{0}', github.sha)");
    expect(workflow.concurrency["cancel-in-progress"]).toBe(false);
  });

  test("gives each job only the permissions it needs", () => {
    expect(workflow.permissions).toEqual({});
    expect(job("build").permissions).toEqual({ contents: "read", packages: "write" });
    expect(job("merge").permissions).toEqual({ packages: "write" });
    expect(job("edge").permissions).toEqual({ contents: "read", deployments: "write" });
    expect(job("sweep").permissions).toEqual({ packages: "write" });
  });

  test("builds each platform natively, then merges, then creates the Deployment", () => {
    expect(job("build").strategy?.matrix).toEqual({
      app: ["api", "web"],
      arch: ["amd64", "arm64"],
      include: [
        { arch: "amd64", runner: "ubuntu-latest" },
        { arch: "arm64", runner: "ubuntu-24.04-arm" },
      ],
    });
    expect(job("build")["runs-on"]).toBe("${{ matrix.runner }}");
    expect(job("merge").needs).toBe("build");
    expect(job("edge").needs).toBe("merge");
    expect(job("edge").env).toMatchObject({
      API: "${{ needs.merge.outputs.api }}",
      WEB: "${{ needs.merge.outputs.web }}",
    });
  });

  test("pushes each platform image by digest, untagged and plain, from its own cache", () => {
    const push = job("build").steps.find((candidate) =>
      candidate.uses?.startsWith("docker/build-push-action@"),
    );

    expect(push?.if).toBe("steps.pushed.outputs.exists != 'true'");
    expect(push?.with).toMatchObject({
      platforms: "linux/${{ matrix.arch }}",
      outputs:
        "type=image,name=${{ steps.image.outputs.name }},push-by-digest=true,name-canonical=true,push=true",
      provenance: false,
      sbom: false,
      "build-args": "${{ matrix.app == 'api' && format('COMMIT={0}', github.sha) || '' }}",
    });
    expect(push?.with?.tags).toBeUndefined();
    const scope = "banki-${{ matrix.app }}${{ matrix.arch == 'arm64' && '-arm64' || '' }}";
    expect(push?.with?.["cache-from"]).toBe(`type=gha,scope=${scope}`);
    expect(push?.with?.["cache-to"]).toBe(`type=gha,mode=max,scope=${scope}`);
  });

  test("skips a build whose commit is already pushed", async () => {
    const env = { IMAGE: image("api"), SHA };
    const pushed = await runStep("build", "pushed", env, {
      [inspect(`${image("api")}:sha-${SHA}`)]: { stdout: "" },
    });
    const fresh = await runStep("build", "pushed", env);

    expect(pushed.output).toBe("exists=true\n");
    expect(fresh.output).toBe("");
    expect(step("build", "pushed").env).toEqual({ IMAGE: "${{ steps.image.outputs.name }}" });
  });

  test("never puts an expression into a script", () => {
    for (const candidate of Object.values(workflow.jobs)) {
      for (const each of candidate.steps) expect(each.run ?? "").not.toContain("${{");
    }
  });
});
