import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isRecord } from "./lib/parse";

// Renders compose.yaml with `docker compose config`, the way Compose itself
// reads it, and checks what it promises: the two containers share nothing but
// the broker's socket, each gets only its own secrets, both are hardened, and
// neither can reach the Docker socket, the Previews or a host port. Skipped
// without a docker CLI; nothing is started.

const hasDocker = Bun.which("docker") !== null;

const secrets = mkdtempSync(join(tmpdir(), "banki-runner-secrets-"));
for (const file of ["claude-token", "github-app-key", "linear-client-secret"]) {
  writeFileSync(join(secrets, file), "dummy\n", { mode: 0o600 });
}
writeFileSync(join(secrets, "broker.env"), "GITHUB_APP_ID=123\nLINEAR_CLIENT_ID=client-id\n");
// In place of deploy/runner/.env, which a bootstrap on this machine may have written.
const noEnvFile = join(secrets, "empty.env");
writeFileSync(noEnvFile, "");
afterAll(() => rmSync(secrets, { recursive: true, force: true }));

const IDS = { BANKI_RUNNER_UID: "1000", BANKI_RUNNER_GID: "1001" };

type Service = Record<string, unknown> & {
  environment?: Record<string, string>;
  networks?: Record<string, unknown>;
  volumes?: { type: string; source: string; target: string }[];
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

const service = async (name: "broker" | "runner") => {
  const found = (await render()).services[name];
  if (found === undefined) throw new Error(`no ${name} service`);
  return found;
};

/** Compose secrets as a service lists them once rendered. */
const files = (names: string[]) =>
  names.map((name) => ({ source: name, target: `/run/secrets/${name}` }));

describe.skipIf(!hasDocker)("compose.yaml", () => {
  test("has the broker and the runner, and nothing else", async () => {
    expect(Object.keys((await render()).services).toSorted()).toEqual(["broker", "runner"]);
  });

  test("hardens both, as the host user's uid and gid", async () => {
    for (const name of ["broker", "runner"] as const) {
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

  test("lets the runner run what its tests write to /tmp, and keeps the broker's noexec", async () => {
    expect((await service("runner")).tmpfs).toEqual(["/tmp:exec"]);
    expect((await service("broker")).tmpfs).toEqual(["/tmp"]);
  });

  test("refuses to render before bootstrap has recorded the uid and gid", async () => {
    const outcome = await render({}).then(
      () => "rendered",
      (error: unknown) => String(error),
    );

    expect(outcome).toContain("run deploy/runner/bootstrap");
  });

  test("gives neither the Docker socket, banki-previews, the pull agent's secrets or a host port", async () => {
    const rendered = await render();

    for (const found of Object.values(rendered.services)) {
      expect(found).not.toHaveProperty("ports");
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

  test("puts each on its own network, with internet access, and they share none", async () => {
    const { services, networks } = await render();

    expect(Object.keys(services.broker?.networks ?? {})).toEqual(["broker"]);
    expect(Object.keys(services.runner?.networks ?? {})).toEqual(["runner"]);
    expect(networks.broker?.internal).toBeUndefined();
    expect(networks.runner?.internal).toBeUndefined();
  });

  test("shares only the broker's socket volume; the work volume is the runner's alone", async () => {
    const { services, volumes } = await render();

    expect(services.broker?.volumes).toEqual([
      expect.objectContaining({ source: "banki-runner-broker", target: "/run/banki-broker" }),
    ]);
    expect(services.runner?.volumes).toEqual([
      expect.objectContaining({ source: "banki-runner-work", target: "/work" }),
      expect.objectContaining({ source: "banki-runner-broker", target: "/run/banki-broker" }),
    ]);
    expect(volumes?.["banki-runner-work"]).toMatchObject({ name: "banki-runner-work" });
    expect(volumes?.["banki-runner-broker"]).toMatchObject({ name: "banki-runner-broker" });
  });

  test("gives the broker the App key and the Linear client secret, and the runner the Claude token, as files", async () => {
    const { services } = await render();
    expect(services.broker?.secrets).toEqual(files(["github-app-key", "linear-client-secret"]));
    expect(services.runner?.secrets).toEqual(files(["claude-token"]));
  });

  test("keeps every secret out of both environments", async () => {
    const { services } = await render();

    expect(Object.keys(services.broker?.environment ?? {}).toSorted()).toEqual([
      "BANKI_BROKER_SOCKET",
      "GITHUB_APP_ID",
      "HOME",
      "LINEAR_CLIENT_ID",
    ]);
    expect(Object.keys(services.runner?.environment ?? {}).toSorted()).toEqual([
      "BANKI_BROKER_SOCKET",
      "HOME",
      "NODE_OPTIONS",
      "PLAYWRIGHT_BROWSERS_PATH",
    ]);
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
  });

  test("builds one image, from the commit it is given, which both run", async () => {
    const commit = "c".repeat(40);
    const { services } = await render({ ...IDS, BANKI_RUNNER_COMMIT: commit });

    expect(services.runner?.build?.args).toEqual({ BANKI_RUNNER_COMMIT: commit });
    expect(services.broker).not.toHaveProperty("build");
    expect(services.broker?.image).toBe("banki-runner");
    expect(services.runner?.image).toBe("banki-runner");
    expect(services.broker?.command).toEqual(["bun", "/opt/banki-runner/broker/main.ts"]);
  });
});
