import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { HEALTH_ATTEMPTS, type ConfirmAction, type DeployAction, confirm, deploy } from "./deploy";
import { type ComposeTarget, setupInvocation } from "./docker";
import { PangolinError } from "./pangolin";
import type { DockerProject } from "./planner";
import type { RunResult } from "./run";

// The deploy and confirm sequences against fakes of Docker, GitHub and
// Pangolin that record every call in one log, in order, so a test reads
// exactly what the agent did and what the Deployment ended up saying.

const SHA = "a".repeat(40);
const OLD_SHA = "c".repeat(40);
const API_DIGEST = `sha256:${"1".repeat(64)}`;
const WEB_DIGEST = `sha256:${"2".repeat(64)}`;
const OLD_API = `sha256:${"3".repeat(64)}`;
const OLD_WEB = `sha256:${"4".repeat(64)}`;
const EMAIL = "preview@banki.dkomeza.com";
// A fake value, built at runtime so secret scanners don't flag it.
const PASSWORD = ["abcd", "efgh", "ijkl", "mnop", "qrst"].join("-");
const NOW = new Date("2026-10-20T12:00:00Z");

const ok = (stdout = ""): RunResult => ({ exitCode: 0, stdout, stderr: "", timedOut: false });
const exited = (exitCode: number, stderr = "boom"): RunResult => ({
  exitCode,
  stdout: "",
  stderr,
  timedOut: false,
});
const healthy = (commit: string) => ok(JSON.stringify({ status: "ok", database: "ok", commit }));

type Step = "down" | "pull" | "setup" | "seed" | "up" | "health";

/** Fakes whose results each test picks; every call lands in `log`. */
function fakes(results: Partial<Record<Step, RunResult | RunResult[]>> = {}) {
  const log: string[] = [];
  const passwords: string[] = [];
  let sleeps = 0;
  const queues = new Map<Step, RunResult[]>();
  const result = (step: Step, target: ComposeTarget): Promise<RunResult> => {
    log.push(`docker ${step} ${step === "down" ? target.digests.api : target.sha.slice(0, 7)}`);
    const given = results[step];
    if (!Array.isArray(given))
      return Promise.resolve(given ?? (step === "health" ? healthy(SHA) : ok()));
    if (!queues.has(step)) queues.set(step, [...given]);
    const queue = queues.get(step) ?? [];
    return Promise.resolve(queue.length > 1 ? (queue.shift() ?? ok()) : (queue[0] ?? ok()));
  };
  let pangolinError: unknown;
  const services = {
    github: {
      setStatus: (id: number, state: string, description: string, url?: string) => {
        log.push(`status ${id} ${state} ${description}${url === undefined ? "" : ` ${url}`}`);
        return Promise.resolve();
      },
    },
    pangolin: {
      createOrKeep: (pr: number) => {
        log.push(`pangolin createOrKeep ${pr}`);
        return pangolinError === undefined ? Promise.resolve() : Promise.reject(pangolinError);
      },
    },
    docker: {
      down: (target: ComposeTarget) => result("down", target),
      pull: (target: ComposeTarget) => result("pull", target),
      setup: (target: ComposeTarget, email: string, password: string) => {
        passwords.push(password);
        log.push(`email ${email}`);
        return result("setup", target);
      },
      seed: (target: ComposeTarget) => result("seed", target),
      up: (target: ComposeTarget) => result("up", target),
      health: (target: ComposeTarget) => result("health", target),
      serviceStates: () =>
        Promise.resolve([
          { service: "api", state: "running", health: "unhealthy" },
          { service: "web", state: "running", health: "" },
        ]),
      stop: (target: ComposeTarget) => {
        log.push(`docker stop ${target.sha.slice(0, 7)}`);
        return Promise.resolve();
      },
    },
    readSecret: (name: string) => (name === "preview-password" ? PASSWORD : EMAIL),
    sleep: () => {
      sleeps++;
      return Promise.resolve();
    },
  };
  return {
    log,
    passwords,
    services,
    sleeps: () => sleeps,
    failPangolin: (error: unknown) => {
      pangolinError = error;
    },
  };
}

const previous: DockerProject = {
  pr: 5,
  sha: OLD_SHA,
  deployedAt: NOW,
  digests: { api: OLD_API, web: OLD_WEB },
  api: "running",
  web: "running",
};

const deployAction = (overrides: Partial<DeployAction> = {}): DeployAction => ({
  kind: "deploy",
  pr: 5,
  sha: SHA,
  deploymentId: 7,
  digests: { api: API_DIGEST, web: WEB_DIGEST },
  previous,
  supersedes: [3],
  deployedAt: NOW,
  needs: [],
  ...overrides,
});

const confirmAction = (overrides: Partial<ConfirmAction> = {}): ConfirmAction => ({
  kind: "confirm",
  pr: 5,
  sha: SHA,
  deploymentId: 7,
  project: { ...previous, sha: SHA, digests: { api: API_DIGEST, web: WEB_DIGEST } },
  supersedes: [3],
  ...overrides,
});

const URL = "https://pr-5.banki.dkomeza.com";

// The sequences log what they do; keep the test output to the results.
let quiet: ReturnType<typeof spyOn>[] = [];
beforeEach(() => {
  quiet = [
    spyOn(console, "log").mockImplementation(() => undefined),
    spyOn(console, "error").mockImplementation(() => undefined),
  ];
});
afterEach(() => {
  for (const spy of quiet) spy.mockRestore();
});

describe("deploy", () => {
  test("runs every step in order, then routes it, marks it a success and the older ones inactive", async () => {
    const fake = fakes();

    await deploy(deployAction(), fake.services);

    expect(fake.log).toEqual([
      "status 7 in_progress starting aaaaaaa",
      // The previous project, with its images, so --rmi all removes them.
      `docker down ${OLD_API}`,
      "docker pull aaaaaaa",
      `email ${EMAIL}`,
      "docker setup aaaaaaa",
      "docker seed aaaaaaa",
      "docker up aaaaaaa",
      "docker health aaaaaaa",
      "pangolin createOrKeep 5",
      `status 7 success deployed aaaaaaa ${URL}`,
      "status 3 inactive superseded by a newer deploy",
    ]);
  });

  test("a first deploy's down names no images, so it removes none", async () => {
    const fake = fakes();

    await deploy(deployAction({ previous: undefined }), fake.services);

    expect(fake.log[1]).toBe(`docker down sha256:${"0".repeat(64)}`);
  });

  test("hands setup the Password read from its secret", async () => {
    const fake = fakes();

    await deploy(deployAction(), fake.services);

    expect(fake.passwords).toEqual([PASSWORD]);
  });

  test("a health check reporting another commit stops the Preview and fails it", async () => {
    const fake = fakes({ health: healthy("b".repeat(40)) });

    await deploy(deployAction(), fake.services);

    expect(fake.log.slice(-4)).toEqual([
      "docker health aaaaaaa",
      "docker stop aaaaaaa",
      "status 7 failure health reports wrong commit bbbbbbb",
      "status 3 inactive superseded by a newer deploy",
    ]);
    expect(fake.log).not.toContain("pangolin createOrKeep 5");
  });

  test("a health body with no commit fails it too", async () => {
    const fake = fakes({ health: ok("<html>") });

    await deploy(deployAction(), fake.services);

    expect(fake.log).toContain("status 7 failure health reports wrong commit (none)");
  });

  test("a step that fails stops the Preview, fails it with the step and its exit code, and runs nothing after", async () => {
    const fake = fakes({ seed: exited(1) });

    await deploy(deployAction(), fake.services);

    expect(fake.log.slice(-4)).toEqual([
      "docker seed aaaaaaa",
      "docker stop aaaaaaa",
      "status 7 failure seed exited 1",
      "status 3 inactive superseded by a newer deploy",
    ]);
    expect(fake.log).not.toContain("docker up aaaaaaa");
  });

  test("a step that times out says so", async () => {
    const fake = fakes({ setup: { ...exited(137), timedOut: true } });

    await deploy(deployAction(), fake.services);

    expect(fake.log).toContain("status 7 failure setup timed out");
  });

  test("down and pull failures have their own reasons", async () => {
    const down = fakes({ down: exited(1) });
    const pull = fakes({ pull: exited(1) });

    await deploy(deployAction(), down.services);
    await deploy(deployAction(), pull.services);

    expect(down.log).toContain("status 7 failure couldn't remove the previous Preview");
    expect(pull.log).toContain("status 7 failure couldn't pull the images");
  });

  test("up failing names the service that isn't healthy", async () => {
    const fake = fakes({ up: exited(1) });

    await deploy(deployAction(), fake.services);

    expect(fake.log).toContain("status 7 failure api not healthy after 60 s");
    expect(fake.log).not.toContain("docker health aaaaaaa");
  });

  test("a health check refused while Caddy starts is tried again", async () => {
    const fake = fakes({ health: [exited(1), exited(1), healthy(SHA)] });

    await deploy(deployAction(), fake.services);

    expect(fake.sleeps()).toBe(2);
    expect(fake.log).toContain(`status 7 success deployed aaaaaaa ${URL}`);
  });

  test("a health check that never answers fails it after every attempt", async () => {
    const fake = fakes({ health: [exited(1)] });

    await deploy(deployAction(), fake.services);

    expect(fake.log.filter((line) => line === "docker health aaaaaaa")).toHaveLength(
      HEALTH_ATTEMPTS,
    );
    expect(fake.log).toContain("status 7 failure health check failed (wget exited 1)");
  });

  test("a Pangolin failure gives a short fixed reason, never Pangolin's own text", async () => {
    const withStatus = fakes();
    withStatus.failPangolin(
      new PangolinError("PUT /org/x/public-resource: HTTP 409 {secret body}", 409),
    );
    const network = fakes();
    network.failPangolin(new Error("connect ECONNREFUSED 10.0.0.1:3003"));

    await deploy(deployAction(), withStatus.services);
    await deploy(deployAction(), network.services);

    expect(withStatus.log).toContain("docker stop aaaaaaa");
    expect(withStatus.log).toContain(
      "status 7 failure Pangolin: couldn't create the resource (HTTP 409)",
    );
    expect(network.log).toContain("status 7 failure Pangolin: couldn't create the resource");
    expect([...withStatus.log, ...network.log].join("\n")).not.toMatch(/secret body|ECONNREFUSED/);
  });

  test("an unexpected error gives a fixed reason, and its text stays in the agent's log", async () => {
    const fake = fakes();
    fake.services.readSecret = () => {
      throw new Error("Can't read the secret preview-password in /run/secrets");
    };

    await deploy(deployAction(), fake.services);

    expect(fake.log).toContain("status 7 failure agent error, see the agent's log");
    expect(fake.log.join("\n")).not.toContain("/run/secrets");
  });
});

describe("setupInvocation", () => {
  test("puts the Password on stdin only, never in the arguments", () => {
    const { args, stdin } = setupInvocation(EMAIL, PASSWORD);

    expect(stdin).toBe(`${PASSWORD}\n`);
    expect(args.join(" ")).not.toContain(PASSWORD);
    expect(args).toEqual([
      "run",
      "--rm",
      "-T",
      "api",
      "bun",
      "run",
      "banki",
      "setup",
      "--email",
      EMAIL,
      "--password-stdin",
    ]);
  });
});

describe("confirm", () => {
  test("passes with nothing taken down: health, the resource, success, and the older ones inactive", async () => {
    const fake = fakes();

    await confirm(confirmAction(), fake.services);

    expect(fake.log).toEqual([
      "docker health aaaaaaa",
      "pangolin createOrKeep 5",
      `status 7 success deployed aaaaaaa ${URL}`,
      "status 3 inactive superseded by a newer deploy",
    ]);
  });

  test("fails by stopping the Preview and marking the failure", async () => {
    const fake = fakes({ health: healthy("b".repeat(40)) });

    await confirm(confirmAction(), fake.services);

    expect(fake.log).toEqual([
      "docker health aaaaaaa",
      "docker stop aaaaaaa",
      "status 7 failure health reports wrong commit bbbbbbb",
      "status 3 inactive superseded by a newer deploy",
    ]);
  });
});
