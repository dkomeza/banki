import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { ConfigError } from "./config";
import { HEALTH_ATTEMPTS } from "./deploy";
import { setupInvocation } from "./docker";
import { deployLongLived, type LongLivedDeployAction } from "./long-lived-deploy";
import type { LongLivedTarget, SnapshotCommand } from "./long-lived-docker";
import type { LongLivedEnvironment } from "./naming";
import type { RunResult } from "./run";

// An Edge or Production deploy against fakes of Docker and GitHub that record
// every call in one log, in order, so a test reads exactly what the agent did
// to the installation and its data, and what the Deployment ended up saying.

const SHA = "a".repeat(40);
const OLD_SHA = "b".repeat(40);
const NEW = { api: `sha256:${"1".repeat(64)}`, web: `sha256:${"2".repeat(64)}` };
const OLD = { api: `sha256:${"3".repeat(64)}`, web: `sha256:${"4".repeat(64)}` };
const STALE = `ghcr.io/dkomeza/banki-api@sha256:${"5".repeat(64)}`;
const EMAIL = "edge@example.com";
// A fake value, built at runtime so secret scanners don't flag it.
const PASSWORD = ["edge", "pass", "word"].join("-");
const NOW = new Date("2026-10-20T12:00:00Z");

const ok = (stdout = ""): RunResult => ({ exitCode: 0, stdout, stderr: "", timedOut: false });
const exited = (exitCode: number): RunResult => ({
  exitCode,
  stdout: "",
  stderr: "boom",
  timedOut: false,
});
const healthy = (commit: string) => ok(JSON.stringify({ status: "ok", database: "ok", commit }));

type Step =
  | "down"
  | "pull"
  | "setup"
  | "seed"
  | "up"
  | "health"
  | "stop"
  | "volume create"
  | "volume rm"
  | "snapshot take"
  | "snapshot restore"
  | "snapshot prune"
  | "snapshot clear"
  | "image rm";

const short = (target: LongLivedTarget) => `${target.environment} ${target.sha.slice(0, 7)}`;

/**
 * Fakes whose results each test picks per step, one after another (the last
 * repeats); every call lands in `log`. A health check reports the commit it
 * was asked about, unless a test says otherwise.
 */
function fakes(results: Partial<Record<Step, RunResult[]>> = {}) {
  const log: string[] = [];
  const setups: { email: string; password: string }[] = [];
  const queues = new Map<Step, RunResult[]>();
  const result = (step: Step, detail: string, fallback = ok()): Promise<RunResult> => {
    log.push(`docker ${step} ${detail}`.trim());
    const given = results[step];
    if (given === undefined) return Promise.resolve(fallback);
    if (!queues.has(step)) queues.set(step, [...given]);
    const queue = queues.get(step) ?? [];
    return Promise.resolve(queue.length > 1 ? (queue.shift() ?? ok()) : (queue[0] ?? ok()));
  };
  let secretError: Error | undefined;
  const services = {
    github: {
      setStatus: (id: number, state: string, description: string, url?: string) => {
        log.push(`status ${id} ${state} ${description}${url === undefined ? "" : ` ${url}`}`);
        return Promise.resolve();
      },
    },
    docker: {
      down: (target: LongLivedTarget) => result("down", short(target)),
      pull: (target: LongLivedTarget) => result("pull", short(target)),
      setup: (target: LongLivedTarget, email: string, password: string) => {
        setups.push({ email, password });
        return result("setup", short(target));
      },
      seed: (target: LongLivedTarget) => result("seed", short(target)),
      up: (target: LongLivedTarget) => result("up", short(target)),
      health: (target: LongLivedTarget) => result("health", short(target), healthy(target.sha)),
      serviceStates: () =>
        Promise.resolve([
          { service: "api", state: "running", health: "unhealthy" },
          { service: "web", state: "created", health: "" },
        ]),
      stop: (target: LongLivedTarget) => result("stop", target.environment),
      createVolume: (environment: LongLivedEnvironment, deploymentId: number) =>
        result("volume create", `${environment} ${deploymentId}`),
      removeVolume: (environment: LongLivedEnvironment) => result("volume rm", environment),
      snapshot: (environment: LongLivedEnvironment, command: SnapshotCommand) => {
        const [name, id] = command;
        return result(`snapshot ${name}`, `${environment}${id === undefined ? "" : ` ${id}`}`);
      },
      removeImage: (ref: string) => result("image rm", ref),
    },
    readSecret: (name: string) => {
      if (secretError !== undefined) throw secretError;
      return name === "edge-password" ? PASSWORD : EMAIL;
    },
    sleep: () => Promise.resolve(),
  };
  return {
    log,
    setups,
    services,
    failSecrets: (error: Error) => {
      secretError = error;
    },
  };
}

const deployAction = (overrides: Partial<LongLivedDeployAction> = {}): LongLivedDeployAction => ({
  pool: "long-lived",
  environment: "edge",
  kind: "deploy",
  sha: SHA,
  deploymentId: 9,
  digests: NEW,
  volume: "kept",
  reset: false,
  rollbackTo: { deploymentId: 8, sha: OLD_SHA, digests: OLD },
  staleImages: [STALE],
  deployedAt: NOW,
  ...overrides,
});

const EDGE_URL = "https://preview.banki.dkomeza.com";

let quiet: { mockRestore: () => void }[] = [];
beforeEach(() => {
  quiet = [
    spyOn(console, "log").mockImplementation(() => {}),
    spyOn(console, "error").mockImplementation(() => {}),
  ];
});
afterEach(() => {
  for (const spy of quiet) spy.mockRestore();
});

describe("a deploy that keeps the data", () => {
  test("pulls, stops the api, takes the Snapshot, starts the new images, checks the commit, and tidies up", async () => {
    const { log, services } = fakes();

    await deployLongLived(deployAction(), services);

    expect(log).toEqual([
      "status 9 in_progress starting aaaaaaa",
      "docker pull edge aaaaaaa",
      "docker stop edge",
      "docker snapshot take edge 9",
      "docker up edge aaaaaaa",
      "docker health edge aaaaaaa",
      `status 9 success deployed aaaaaaa ${EDGE_URL}`,
      "docker snapshot prune edge",
      `docker image rm ${STALE}`,
    ]);
  });

  test("Production's success links to banki.dkomeza.com", async () => {
    const { log, services } = fakes();

    await deployLongLived(deployAction({ environment: "production" }), services);

    expect(log).toContain("status 9 success deployed aaaaaaa https://banki.dkomeza.com");
  });

  test("never sets up or seeds an installation that keeps its data, and never removes its volume", async () => {
    const { log, services } = fakes({ up: [exited(1)] });

    await deployLongLived(deployAction(), services);

    expect(log.filter((line) => /setup|seed|volume/.test(line))).toEqual([]);
  });

  test("an interrupted deploy's retry keeps its existing Snapshot, and restores that one on failure", async () => {
    const { log, services } = fakes({
      "snapshot take": [ok("kept snapshots/9.db")],
      health: [healthy(OLD_SHA)],
    });

    await deployLongLived(deployAction(), services);

    expect(log).toEqual([
      "status 9 in_progress starting aaaaaaa",
      "docker pull edge aaaaaaa",
      "docker stop edge",
      "docker snapshot take edge 9",
      "docker up edge aaaaaaa",
      "docker health edge aaaaaaa",
      "docker stop edge",
      "docker snapshot restore edge 9",
      "docker up edge bbbbbbb",
      "docker health edge bbbbbbb",
      "status 9 failure health reports wrong commit bbbbbbb, rolled back to bbbbbbb",
    ]);
  });
});

describe("a failed deploy", () => {
  test("a failed migration restores the Snapshot and the previous images, and says so", async () => {
    const { log, services } = fakes({ up: [exited(1), ok()] });

    await deployLongLived(deployAction(), services);

    expect(log.slice(4)).toEqual([
      "docker up edge aaaaaaa",
      "docker stop edge",
      "docker snapshot restore edge 9",
      "docker up edge bbbbbbb",
      "docker health edge bbbbbbb",
      "status 9 failure api not healthy after 60 s, rolled back to bbbbbbb",
    ]);
  });

  test("a failed health check is rolled back too, after every try", async () => {
    const { log, services } = fakes({
      health: [...Array.from({ length: HEALTH_ATTEMPTS }, () => exited(1)), healthy(OLD_SHA)],
    });

    await deployLongLived(deployAction(), services);

    expect(log.filter((line) => line === "docker health edge aaaaaaa")).toHaveLength(
      HEALTH_ATTEMPTS,
    );
    expect(log.slice(-4)).toEqual([
      "docker snapshot restore edge 9",
      "docker up edge bbbbbbb",
      "docker health edge bbbbbbb",
      "status 9 failure health check failed (wget exited 1), rolled back to bbbbbbb",
    ]);
  });

  test("keeps every Snapshot and image after a failure", async () => {
    const { log, services } = fakes({ up: [exited(1), ok()] });

    await deployLongLived(deployAction(), services);

    expect(log.filter((line) => /prune|image rm/.test(line))).toEqual([]);
  });

  test("a failed pull leaves the data untouched: no Snapshot to restore, the previous images up again", async () => {
    const { log, services } = fakes({ pull: [exited(1)] });

    await deployLongLived(deployAction(), services);

    expect(log).toEqual([
      "status 9 in_progress starting aaaaaaa",
      "docker pull edge aaaaaaa",
      "docker stop edge",
      "docker up edge bbbbbbb",
      "docker health edge bbbbbbb",
      "status 9 failure couldn't pull the images, rolled back to bbbbbbb",
    ]);
  });

  test("a failed Snapshot never restores: the new images never ran on the data", async () => {
    const { log, services } = fakes({ "snapshot take": [exited(1)] });

    await deployLongLived(deployAction(), services);

    expect(log).not.toContain("docker snapshot restore edge 9");
    expect(log).not.toContain("docker up edge aaaaaaa");
    expect(log.at(-1)).toBe("status 9 failure couldn't take the Snapshot, rolled back to bbbbbbb");
  });

  test("a failed restore stops both services and says so", async () => {
    const { log, services } = fakes({ up: [exited(1)], "snapshot restore": [exited(1)] });

    await deployLongLived(deployAction(), services);

    expect(log.slice(4)).toEqual([
      "docker up edge aaaaaaa",
      "docker stop edge",
      "docker snapshot restore edge 9",
      "docker stop edge",
      "status 9 failure api not healthy after 60 s, rollback failed, stopped",
    ]);
  });

  test("previous images that fail too are stopped", async () => {
    const { log, services } = fakes({ up: [exited(1), ok()], health: [healthy(SHA)] });

    await deployLongLived(deployAction(), services);

    expect(log.slice(-4)).toEqual([
      "docker up edge bbbbbbb",
      "docker health edge bbbbbbb",
      "docker stop edge",
      "status 9 failure api not healthy after 60 s, rollback failed, stopped",
    ]);
  });

  test("with no success Deployment to roll back to, it restores the Snapshot and stops", async () => {
    const { log, services } = fakes({ up: [exited(1)] });

    await deployLongLived(deployAction({ rollbackTo: undefined }), services);

    expect(log.slice(4)).toEqual([
      "docker up edge aaaaaaa",
      "docker stop edge",
      "docker snapshot restore edge 9",
      "docker stop edge",
      "status 9 failure api not healthy after 60 s, rollback failed, stopped",
    ]);
  });

  test("a Docker step that throws is an agent error, rolled back like any failure", async () => {
    const { log, services } = fakes();
    let calls = 0;
    services.docker.up = () =>
      calls++ === 0 ? Promise.reject(new Error("socket gone")) : Promise.resolve(ok());

    await deployLongLived(deployAction(), services);

    expect(log.at(-1)).toBe(
      "status 9 failure agent error, see the agent's log, rolled back to bbbbbbb",
    );
  });
});

describe("a first boot", () => {
  test("on Edge, creates the volume, sets up with the Password on stdin only, seeds, and starts", async () => {
    const { log, setups, services } = fakes();

    await deployLongLived(deployAction({ volume: "missing", rollbackTo: undefined }), services);

    expect(log).toEqual([
      "status 9 in_progress starting aaaaaaa",
      "docker volume create edge 9",
      "docker pull edge aaaaaaa",
      "docker setup edge aaaaaaa",
      "docker seed edge aaaaaaa",
      "docker up edge aaaaaaa",
      "docker health edge aaaaaaa",
      `status 9 success deployed aaaaaaa ${EDGE_URL}`,
      `docker image rm ${STALE}`,
    ]);
    expect(setups).toEqual([{ email: EMAIL, password: PASSWORD }]);
    // The real invocation: the Password goes in on stdin, never in argv.
    const invocation = setupInvocation(EMAIL, PASSWORD);
    expect(invocation.args).not.toContain(PASSWORD);
    expect(invocation.args).toContain("--password-stdin");
    expect(invocation.stdin).toBe(`${PASSWORD}\n`);
  });

  test("on Production, neither sets up nor seeds: it starts empty for the Maintainer's Setup", async () => {
    const { log, setups, services } = fakes();

    await deployLongLived(
      deployAction({ environment: "production", volume: "missing", rollbackTo: undefined }),
      services,
    );

    expect(log).toEqual([
      "status 9 in_progress starting aaaaaaa",
      "docker volume create production 9",
      "docker pull production aaaaaaa",
      "docker up production aaaaaaa",
      "docker health production aaaaaaa",
      "status 9 success deployed aaaaaaa https://banki.dkomeza.com",
      `docker image rm ${STALE}`,
    ]);
    expect(setups).toEqual([]);
  });

  test("an interrupted one starts over: its project and its own volume go first", async () => {
    const { log, services } = fakes();

    await deployLongLived(deployAction({ volume: "own", rollbackTo: undefined }), services);

    expect(log.slice(0, 5)).toEqual([
      "status 9 in_progress starting aaaaaaa",
      "docker down edge aaaaaaa",
      "docker volume rm edge",
      "docker volume create edge 9",
      "docker pull edge aaaaaaa",
    ]);
    expect(log.at(-2)).toBe(`status 9 success deployed aaaaaaa ${EDGE_URL}`);
  });

  test("a failed one removes the project and the volume it created, and fails with the reason", async () => {
    const { log, services } = fakes({ seed: [exited(3)] });

    await deployLongLived(deployAction({ volume: "missing", rollbackTo: undefined }), services);

    expect(log.slice(-3)).toEqual([
      "docker down edge aaaaaaa",
      "docker volume rm edge",
      "status 9 failure seed exited 3",
    ]);
    expect(log).not.toContain("docker snapshot restore edge 9");
  });

  test("a failed one never rolls back, even with an older success", async () => {
    const { log, services } = fakes({ up: [exited(1)] });

    await deployLongLived(deployAction({ volume: "missing" }), services);

    expect(log).not.toContain("docker up edge bbbbbbb");
    expect(log.at(-1)).toBe("status 9 failure api not healthy after 60 s");
  });

  test("a volume it couldn't create is not removed", async () => {
    const { log, services } = fakes({ "volume create": [exited(1)] });

    await deployLongLived(deployAction({ volume: "missing" }), services);

    expect(log).not.toContain("docker volume rm edge");
    expect(log.at(-1)).toBe("status 9 failure couldn't create the data volume");
  });

  test("on Edge without its Email or Password, fails with a fixed reason and removes what it made", async () => {
    const { log, services, failSecrets } = fakes();
    failSecrets(new ConfigError("Can't read the secret edge-password"));

    await deployLongLived(deployAction({ volume: "missing" }), services);

    expect(log.slice(-3)).toEqual([
      "docker down edge aaaaaaa",
      "docker volume rm edge",
      "status 9 failure no Edge Email or Password, run deploy/long-lived/bootstrap",
    ]);
  });
});

const reset = (overrides: Partial<LongLivedDeployAction> = {}) =>
  deployAction({ reset: true, ...overrides });

describe("a Reset of Edge", () => {
  test("on a kept volume, stops, takes the Snapshot, clears, sets up with the Password on stdin only, seeds, and starts", async () => {
    const { log, setups, services } = fakes();

    await deployLongLived(reset(), services);

    expect(log).toEqual([
      "status 9 in_progress resetting to aaaaaaa",
      "docker pull edge aaaaaaa",
      "docker stop edge",
      "docker snapshot take edge 9",
      "docker snapshot clear edge",
      "docker setup edge aaaaaaa",
      "docker seed edge aaaaaaa",
      "docker up edge aaaaaaa",
      "docker health edge aaaaaaa",
      `status 9 success reset to aaaaaaa ${EDGE_URL}`,
      "docker snapshot prune edge",
      `docker image rm ${STALE}`,
    ]);
    expect(setups).toEqual([{ email: EMAIL, password: PASSWORD }]);
    // The real invocation: the Password goes in on stdin, never in argv.
    const invocation = setupInvocation(EMAIL, PASSWORD);
    expect(invocation.args).not.toContain(PASSWORD);
    expect(invocation.stdin).toBe(`${PASSWORD}\n`);
  });

  test("an interrupted one is retried from its start, keeping its existing Snapshot", async () => {
    const { log, services } = fakes({ "snapshot take": [ok("kept snapshots/9.db")] });

    await deployLongLived(reset(), services);

    expect(log.slice(0, 7)).toEqual([
      "status 9 in_progress resetting to aaaaaaa",
      "docker pull edge aaaaaaa",
      "docker stop edge",
      "docker snapshot take edge 9",
      "docker snapshot clear edge",
      "docker setup edge aaaaaaa",
      "docker seed edge aaaaaaa",
    ]);
    expect(log).toContain(`status 9 success reset to aaaaaaa ${EDGE_URL}`);
  });

  test("a failed one restores the Snapshot over the cleared database and the previous images", async () => {
    const { log, services } = fakes({ seed: [exited(3)] });

    await deployLongLived(reset(), services);

    expect(log.slice(6)).toEqual([
      "docker seed edge aaaaaaa",
      "docker stop edge",
      "docker snapshot restore edge 9",
      "docker up edge bbbbbbb",
      "docker health edge bbbbbbb",
      "status 9 failure seed exited 3, rolled back to bbbbbbb",
    ]);
    expect(log.filter((line) => /prune|image rm|volume/.test(line))).toEqual([]);
  });

  test("a failed clear is rolled back too", async () => {
    const { log, services } = fakes({ "snapshot clear": [exited(1)] });

    await deployLongLived(reset(), services);

    expect(log).not.toContain("docker setup edge aaaaaaa");
    expect(log).toContain("docker snapshot restore edge 9");
    expect(log.at(-1)).toBe("status 9 failure couldn't clear the database, rolled back to bbbbbbb");
  });

  test("without Edge's Email or Password, is rolled back with a fixed reason", async () => {
    const { log, services, failSecrets } = fakes();
    failSecrets(new ConfigError("Can't read the secret edge-password"));

    await deployLongLived(reset(), services);

    expect(log).toContain("docker snapshot restore edge 9");
    expect(log.at(-1)).toBe(
      "status 9 failure no Edge Email or Password, run deploy/long-lived/bootstrap, rolled back to bbbbbbb",
    );
  });

  test("one whose rollback fails too is stopped, and says so", async () => {
    const { log, services } = fakes({ up: [exited(1)], "snapshot restore": [exited(1)] });

    await deployLongLived(reset(), services);

    expect(log.slice(-4)).toEqual([
      "docker stop edge",
      "docker snapshot restore edge 9",
      "docker stop edge",
      "status 9 failure api not healthy after 60 s, rollback failed, stopped",
    ]);
  });

  test("with no volume, is a first boot: no Snapshot to take, nothing to clear", async () => {
    const { log, services } = fakes();

    await deployLongLived(reset({ volume: "missing", rollbackTo: undefined }), services);

    expect(log).toEqual([
      "status 9 in_progress resetting to aaaaaaa",
      "docker volume create edge 9",
      "docker pull edge aaaaaaa",
      "docker setup edge aaaaaaa",
      "docker seed edge aaaaaaa",
      "docker up edge aaaaaaa",
      "docker health edge aaaaaaa",
      `status 9 success reset to aaaaaaa ${EDGE_URL}`,
      `docker image rm ${STALE}`,
    ]);
  });

  test("with its own interrupted first boot's volume, starts that first boot over", async () => {
    const { log, services } = fakes();

    await deployLongLived(reset({ volume: "own", rollbackTo: undefined }), services);

    expect(log.slice(1, 4)).toEqual([
      "docker down edge aaaaaaa",
      "docker volume rm edge",
      "docker volume create edge 9",
    ]);
    expect(log).not.toContain("docker snapshot clear edge");
  });
});
