import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isRecord } from "./lib/parse";

// Renders compose.yaml with `docker compose config`, the way Compose itself
// reads it, and checks what it promises: the containers share nothing but the
// Broker's socket and, read-only for the Dashboard, the runner's volume; each
// gets only its own secrets; all are hardened; none can reach the Docker
// socket or the Previews; and only the Dashboard publishes a port, on the
// host's 127.0.0.1. Skipped without a docker CLI; nothing is started.

const hasDocker = Bun.which("docker") !== null;

// A runner's first `docker compose` can take seconds to start, past bun's 5s default.
setDefaultTimeout(30_000);

const secrets = mkdtempSync(join(tmpdir(), "banki-runner-secrets-"));
for (const file of ["claude-token", "github-app-key", "linear-client-secret"]) {
  writeFileSync(join(secrets, file), "dummy\n", { mode: 0o600 });
}
writeFileSync(join(secrets, "broker.env"), "GITHUB_APP_ID=123\nLINEAR_CLIENT_ID=client-id\n");
// In place of deploy/runner/.env, which a bootstrap on this machine may have written.
const noEnvFile = join(secrets, "empty.env");
writeFileSync(noEnvFile, "");
afterAll(() => rmSync(secrets, { recursive: true, force: true }));

const IDS = {
  BANKI_RUNNER_UID: "1000",
  BANKI_RUNNER_GID: "1001",
  BANKI_RUNNER_TZ: "Europe/Warsaw",
};
/** The runner's and the Dashboard's subnets, which compose.yaml and the host's firewall rules both name. */
const RUNNER_SUBNET = "10.213.94.0/24";
const DASHBOARD_SUBNET = "10.213.96.0/24";

type Service = Record<string, unknown> & {
  environment?: Record<string, string>;
  networks?: Record<string, unknown>;
  volumes?: { type: string; source: string; target: string; read_only?: boolean }[];
  ports?: Record<string, unknown>[];
  secrets?: { source: string; target: string }[];
  build?: { args?: Record<string, string> };
};
type Rendered = {
  services: Record<string, Service>;
  networks: Record<string, Record<string, unknown>>;
  volumes?: Record<string, { name?: string }>;
};

function isRendered(value: unknown): value is Rendered {
  return isRecord(value) && isRecord(value.services) && isRecord(value.networks);
}

async function render(env: Record<string, string> = IDS): Promise<Rendered> {
  const proc = Bun.spawn(
    [
      "docker",
      "compose",
      "--env-file",
      noEnvFile,
      "--file",
      join(import.meta.dir, "compose.yaml"),
      "config",
      "--format",
      "json",
    ],
    {
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? tmpdir(),
        BANKI_RUNNER_SECRETS: secrets,
        ...env,
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) throw new Error(`docker compose config failed: ${stderr}`);
  const rendered: unknown = JSON.parse(stdout);
  if (!isRendered(rendered)) throw new Error("docker compose config: unexpected output");
  return rendered;
}

/** A rendered size, in bytes or as `<n>m`/`<n>g` depending on the Compose version, in MiB. */
const megabytes = (size: unknown) => {
  if (typeof size === "string" && /^[0-9]+[mg]$/.test(size)) {
    return Number(size.slice(0, -1)) * (size.endsWith("g") ? 1024 : 1);
  }
  return Number(size) / 2 ** 20;
};

const SERVICES = ["broker", "dashboard", "runner"] as const;

const service = async (name: (typeof SERVICES)[number]) => {
  const found = (await render()).services[name];
  if (found === undefined) throw new Error(`no ${name} service`);
  return found;
};

/** Compose secrets as a service lists them once rendered. */
const files = (names: string[]) =>
  names.map((name) => ({ source: name, target: `/run/secrets/${name}` }));

describe.skipIf(!hasDocker)("compose.yaml", () => {
  test("has the broker, the runner and the Dashboard, and nothing else", async () => {
    expect(Object.keys((await render()).services).toSorted()).toEqual([...SERVICES]);
  });

  test("hardens each, as the host user's uid and gid", async () => {
    for (const name of SERVICES) {
      expect(await service(name)).toMatchObject({
        user: "1000:1001",
        read_only: true,
        security_opt: ["no-new-privileges:true"],
        cap_drop: ["ALL"],
        init: true,
        restart: "unless-stopped",
      });
      expect(await service(name)).not.toHaveProperty("cap_add");
      expect((await service(name)).tmpfs).toHaveLength(1);
      expect(await service(name)).not.toHaveProperty("privileged");
    }
  });

  test("lets the runner run what its tests write to /tmp, and keeps the others' noexec", async () => {
    expect((await service("runner")).tmpfs).toEqual(["/tmp:exec"]);
    expect((await service("broker")).tmpfs).toEqual(["/tmp"]);
    expect((await service("dashboard")).tmpfs).toEqual(["/tmp"]);
  });

  test("refuses to render before bootstrap has recorded the uid and gid", async () => {
    const outcome = await render({}).then(
      () => "rendered",
      (error: unknown) => String(error),
    );

    expect(outcome).toContain("run deploy/runner/bootstrap");
  });

  test("gives none the Docker socket, banki-previews or the pull agent's secrets, and only the Dashboard a host port", async () => {
    const rendered = await render();

    for (const [name, found] of Object.entries(rendered.services)) {
      if (name !== "dashboard") expect(found).not.toHaveProperty("ports");
      expect(found).not.toHaveProperty("network_mode");
      for (const volume of found.volumes ?? []) {
        expect(volume.type).toBe("volume");
        expect(volume.source).not.toContain("docker.sock");
        expect(volume.source).not.toContain("banki-preview");
      }
      expect(Object.keys(found.networks ?? {})).not.toContain("banki-previews");
    }
    expect(Object.keys(rendered.networks)).not.toContain("banki-previews");
  });

  test("publishes the Dashboard's 8790 on the host's 127.0.0.1, and nothing else of it", async () => {
    expect((await service("dashboard")).ports).toEqual([
      expect.objectContaining({
        host_ip: "127.0.0.1",
        target: 8790,
        published: "8790",
        protocol: "tcp",
      }),
    ]);
  });

  test("never pulls the image, which the runner's service builds and all run", async () => {
    const { services } = await render();

    for (const name of SERVICES) expect(services[name]?.pull_policy).toBe("never");
  });

  test("gives the runner's network the fixed subnet the host's firewall rules name", async () => {
    const { networks } = await render();
    const script = await Bun.file(join(import.meta.dir, "host-firewall")).text();

    expect(networks.runner?.ipam).toEqual({ config: [{ subnet: RUNNER_SUBNET }] });
    expect(script).toContain(`"${RUNNER_SUBNET}"`);
  });

  test("gives the Dashboard's network a fixed subnet of its own, which the host's firewall rules name too", async () => {
    const { networks } = await render();
    const script = await Bun.file(join(import.meta.dir, "host-firewall")).text();
    const subnets = Object.values(networks).flatMap((network) =>
      isRecord(network.ipam) && Array.isArray(network.ipam.config)
        ? network.ipam.config.flatMap((config: unknown) =>
            isRecord(config) && typeof config.subnet === "string" ? [config.subnet] : [],
          )
        : [],
    );

    expect(networks.dashboard?.ipam).toEqual({ config: [{ subnet: DASHBOARD_SUBNET }] });
    expect(script).toContain(`"${DASHBOARD_SUBNET}"`);
    expect(subnets.toSorted()).toEqual([RUNNER_SUBNET, DASHBOARD_SUBNET].toSorted());
    expect(DASHBOARD_SUBNET).not.toBe("172.31.255.0/24");
  });

  test("puts each on its own network, with internet access, and they share none", async () => {
    const { services, networks } = await render();

    expect(Object.keys(services.broker?.networks ?? {})).toEqual(["broker"]);
    expect(Object.keys(services.runner?.networks ?? {})).toEqual(["runner"]);
    expect(Object.keys(services.dashboard?.networks ?? {})).toEqual(["dashboard"]);
    for (const name of SERVICES) expect(networks[name]?.internal).toBeUndefined();
  });

  test("shares only the broker's socket volume, and the work volume with the Dashboard read-only", async () => {
    const { services, volumes } = await render();

    expect(services.broker?.volumes).toEqual([
      expect.objectContaining({ source: "banki-runner-broker", target: "/run/banki-broker" }),
    ]);
    expect(services.runner?.volumes).toEqual([
      expect.objectContaining({ source: "banki-runner-work", target: "/work" }),
      expect.objectContaining({ source: "banki-runner-broker", target: "/run/banki-broker" }),
    ]);
    expect(services.runner?.volumes?.[0]?.read_only).toBeUndefined();
    expect(services.dashboard?.volumes).toEqual([
      expect.objectContaining({ source: "banki-runner-work", target: "/work", read_only: true }),
      expect.objectContaining({ source: "banki-runner-broker", target: "/run/banki-broker" }),
    ]);
    expect(services.dashboard?.volumes?.[1]?.read_only).toBeUndefined();
    expect(volumes?.["banki-runner-work"]).toMatchObject({ name: "banki-runner-work" });
    expect(volumes?.["banki-runner-broker"]).toMatchObject({ name: "banki-runner-broker" });
  });

  test("gives the broker the App key and the Linear client secret, and the runner the Claude token, as files", async () => {
    const { services } = await render();
    expect(services.broker?.secrets).toEqual(files(["github-app-key", "linear-client-secret"]));
    expect(services.runner?.secrets).toEqual(files(["claude-token"]));
    expect(services.dashboard).not.toHaveProperty("secrets");
  });

  test("keeps every secret out of every environment", async () => {
    const { services } = await render();

    expect(Object.keys(services.broker?.environment ?? {}).toSorted()).toEqual([
      "BANKI_BROKER_SOCKET",
      "GITHUB_APP_ID",
      "HOME",
      "LINEAR_CLIENT_ID",
    ]);
    expect(Object.keys(services.runner?.environment ?? {}).toSorted()).toEqual([
      "BANKI_BROKER_SOCKET",
      "BANKI_RUNNER_CEILING",
      "BANKI_RUNNER_MAX_STAGES",
      "BANKI_RUNNER_NIGHT",
      "BANKI_RUNNER_OPEN_DAYS",
      "HOME",
      "NODE_OPTIONS",
      "PLAYWRIGHT_BROWSERS_PATH",
      "TZ",
    ]);
    expect(Object.keys(services.dashboard?.environment ?? {}).toSorted()).toEqual([
      "BANKI_BROKER_SOCKET",
      "BANKI_RUNNER_CEILING",
      "BANKI_RUNNER_MAX_STAGES",
      "BANKI_RUNNER_NIGHT",
      "BANKI_RUNNER_OPEN_DAYS",
      "HOME",
      "TZ",
    ]);
  });

  test("gives the Dashboard the Dispatcher's settings the runner has, for its queue and its window", async () => {
    const { services } = await render({ ...IDS, BANKI_RUNNER_CEILING: "0.45" });

    expect(services.dashboard?.environment).toMatchObject({
      TZ: "Europe/Warsaw",
      BANKI_RUNNER_CEILING: "0.45",
      BANKI_RUNNER_NIGHT: "01:00-07:00",
      BANKI_RUNNER_OPEN_DAYS: "sat,sun",
      BANKI_RUNNER_MAX_STAGES: "2",
    });
  });

  test("runs the Dashboard from the clone of main, through the wrapper on PATH", async () => {
    expect((await service("dashboard")).command).toEqual(["dashboard"]);
    const wrapper = await Bun.file(join(import.meta.dir, "bin", "dashboard")).text();
    expect(wrapper).toContain('server="$clone/deploy/runner/dashboard/main.ts"');
    expect(wrapper).toContain('clone="${BANKI_RUNNER_CLONE:-/work/banki}"');
  });

  test("gives the runner the host's timezone, and the Dispatcher's window, Ceiling and cap with their defaults", async () => {
    expect((await service("runner")).environment).toMatchObject({
      TZ: "Europe/Warsaw",
      BANKI_RUNNER_NIGHT: "01:00-07:00",
      BANKI_RUNNER_OPEN_DAYS: "sat,sun",
      BANKI_RUNNER_CEILING: "0.60",
      BANKI_RUNNER_MAX_STAGES: "2",
    });
    const { services } = await render({
      ...IDS,
      BANKI_RUNNER_CEILING: "0.45",
      BANKI_RUNNER_NIGHT: "23:00-06:00",
    });

    expect(services.runner?.environment).toMatchObject({
      BANKI_RUNNER_CEILING: "0.45",
      BANKI_RUNNER_NIGHT: "23:00-06:00",
    });
  });

  test("keeps the open days empty when they are set empty, for no open days", async () => {
    const { services } = await render({ ...IDS, BANKI_RUNNER_OPEN_DAYS: "" });

    expect(services.runner?.environment?.BANKI_RUNNER_OPEN_DAYS).toBe("");
  });

  test("refuses to render before bootstrap has recorded the host's timezone", async () => {
    const outcome = await render({ BANKI_RUNNER_UID: "1000", BANKI_RUNNER_GID: "1001" }).then(
      () => "rendered",
      (error: unknown) => String(error),
    );

    expect(outcome).toContain("run deploy/runner/bootstrap");
  });

  test("has Node resolve localhost to IPv4 first, where Vite then listens and the `ui` script looks", async () => {
    expect((await service("runner")).environment?.NODE_OPTIONS).toBe(
      "--dns-result-order=ipv4first",
    );
  });

  test("puts the runner's HOME and Playwright's browsers on the work volume", async () => {
    expect((await service("runner")).environment).toMatchObject({
      HOME: "/work/home",
      PLAYWRIGHT_BROWSERS_PATH: "/work/home/ms-playwright",
    });
  });

  test("caps the runner at 8 GB with no CPU cap and room in /dev/shm for Chromium, and the broker small", async () => {
    const runner = await service("runner");
    const broker = await service("broker");

    expect(megabytes(runner.mem_limit)).toBe(8 * 1024);
    expect(runner).not.toHaveProperty("cpus");
    expect(megabytes(runner.shm_size)).toBeGreaterThanOrEqual(512);
    expect(megabytes(broker.mem_limit)).toBeLessThanOrEqual(256);
    expect(megabytes((await service("dashboard")).mem_limit)).toBe(256);
  });

  test("builds one image, from the commit it is given, which all run", async () => {
    const commit = "c".repeat(40);
    const { services } = await render({ ...IDS, BANKI_RUNNER_COMMIT: commit });

    expect(services.runner?.build?.args).toEqual({ BANKI_RUNNER_COMMIT: commit });
    expect(services.broker).not.toHaveProperty("build");
    expect(services.dashboard).not.toHaveProperty("build");
    for (const name of SERVICES) expect(services[name]?.image).toBe("banki-runner");
    expect(services.broker?.command).toEqual(["bun", "/opt/banki-runner/broker/main.ts"]);
  });
});
