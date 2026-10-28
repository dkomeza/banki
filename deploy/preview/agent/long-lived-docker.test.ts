import { describe, expect, test } from "bun:test";
import { longLivedEnv, longLivedFrom, snapshotInvocation } from "./long-lived-docker";

// `docker ps` prints one line per container in the agent's format: the
// project, the Long-lived labels, its service, whether it is a one-off and
// its state; `docker volume ls` prints each volume's name and the Deployment
// whose first boot made it.

const SHA = "a".repeat(40);
const API = `sha256:${"1".repeat(64)}`;
const WEB = `sha256:${"2".repeat(64)}`;
const AT = "2026-10-20T11:00:00.000Z";

const container = (project: string, service: string, state: string, oneoff = "False") =>
  [project, SHA, AT, API, WEB, service, oneoff, state].join("\t");

describe("longLivedFrom", () => {
  test("Edge running, from its containers and its labelled volume", () => {
    const found = longLivedFrom({
      containers: [
        container("banki-edge", "api", "running"),
        container("banki-edge", "web", "running"),
      ].join("\n"),
      volumes: "banki-edge-data\t41\n",
    });

    expect(found.edge).toEqual({
      project: {
        sha: SHA,
        deployedAt: new Date(AT),
        digests: { api: API, web: WEB },
        api: "running",
        web: "running",
      },
      volume: { exists: true, deploymentId: 41 },
    });
    expect(found.production).toEqual({ project: undefined, volume: { exists: false } });
  });

  test("a stopped installation, and a one-off container that isn't a service", () => {
    const found = longLivedFrom({
      containers: [
        container("banki-production", "api", "exited"),
        container("banki-production", "api", "running", "True"),
      ].join("\n"),
      volumes: "banki-production-data\t\n",
    });

    expect(found.production).toEqual({
      project: expect.objectContaining({ api: "stopped", web: "missing" }),
      volume: { exists: true, deploymentId: undefined },
    });
  });

  test("only exactly its project's containers and its volume's name", () => {
    const found = longLivedFrom({
      containers: [
        container("banki-edge-2", "api", "running"),
        container("banki-pr-5", "api", "running"),
        container("banki-slug-edge", "api", "running"),
      ].join("\n"),
      volumes: [
        "banki-edge-data-old\t1",
        "banki-pr-5_banki-data\t",
        "xbanki-production-data\t2",
      ].join("\n"),
    });

    expect(found).toEqual({
      edge: { project: undefined, volume: { exists: false } },
      production: { project: undefined, volume: { exists: false } },
    });
  });

  test("a volume label that isn't a Deployment ID names none", () => {
    for (const label of ["0", "-1", "abc", "1.5"]) {
      expect(
        longLivedFrom({ containers: "", volumes: `banki-edge-data\t${label}` }).edge.volume,
      ).toEqual({ exists: true, deploymentId: undefined });
    }
  });
});

describe("longLivedEnv", () => {
  test("names the installation, its host, its volume, its commit and its images", () => {
    expect(
      longLivedEnv({
        environment: "production",
        sha: SHA,
        deployedAt: new Date(AT),
        digests: { api: API, web: WEB },
      }),
    ).toEqual({
      LONG_LIVED_ENV: "production",
      LONG_LIVED_HOST: "banki.dkomeza.com",
      LONG_LIVED_VOLUME: "banki-production-data",
      LONG_LIVED_SHA: SHA,
      LONG_LIVED_DEPLOYED_AT: AT,
      LONG_LIVED_RELEASE: "true",
      API_DIGEST: API,
      WEB_DIGEST: WEB,
    });
  });

  test("makes only Production a Release", () => {
    const target = { sha: SHA, deployedAt: new Date(AT), digests: { api: API, web: WEB } };

    expect(longLivedEnv({ ...target, environment: "production" }).LONG_LIVED_RELEASE).toBe("true");
    expect(longLivedEnv({ ...target, environment: "edge" }).LONG_LIVED_RELEASE).toBe("false");
  });
});

describe("snapshotInvocation", () => {
  test("runs the agent's own image with only the volume, no network, a read-only root, as uid 1000", () => {
    expect(snapshotInvocation("edge", ["take", 41])).toEqual([
      "docker",
      "run",
      "--rm",
      "--pull",
      "never",
      "--network",
      "none",
      "--read-only",
      "--tmpfs",
      "/tmp",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges:true",
      "--user",
      "1000:1000",
      "--volume",
      "banki-edge-data:/data",
      "banki-preview-agent",
      "bun",
      "agent/snapshot.ts",
      "take",
      "41",
    ]);
  });

  test("mounts nothing but the installation's volume", () => {
    const argv = snapshotInvocation("production", ["prune"]);

    expect(argv.filter((arg, index) => argv[index - 1] === "--volume")).toEqual([
      "banki-production-data:/data",
    ]);
    expect(argv).not.toContain("--mount");
    expect(argv).not.toContain("/var/run/docker.sock");
    expect(argv.slice(-3)).toEqual(["bun", "agent/snapshot.ts", "prune"]);
  });

  test("clears a Reset's database in the same one-off container", () => {
    const argv = snapshotInvocation("edge", ["clear"]);

    expect(argv).toEqual([...snapshotInvocation("edge", ["prune"]).slice(0, -1), "clear"]);
  });
});
