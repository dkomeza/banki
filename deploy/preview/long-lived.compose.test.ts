import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type LongLivedTarget, longLivedEnv } from "./agent/long-lived-docker";
import { isRecord } from "./agent/parse";

// Renders the Long-lived template with `docker compose config`, the way
// Compose itself reads it, and checks what it promises: hardening, the fixed
// limits, internet access, `web` on banki-long-lived only, and the external
// data volume. Skipped without a docker CLI; nothing is started.

const hasDocker = Bun.which("docker") !== null;

const EDGE: LongLivedTarget = {
  environment: "edge",
  sha: "a".repeat(40),
  deployedAt: new Date("2026-10-20T12:00:00.000Z"),
  digests: { api: `sha256:${"1".repeat(64)}`, web: `sha256:${"2".repeat(64)}` },
};
const PRODUCTION: LongLivedTarget = { ...EDGE, environment: "production" };

type Service = Record<string, unknown> & {
  environment?: Record<string, string>;
  networks?: Record<string, unknown>;
  labels?: Record<string, string>;
  volumes?: { type: string; source: string; target: string }[];
};
type Rendered = {
  services: Record<string, Service>;
  networks: Record<string, Record<string, unknown>>;
  volumes?: Record<string, Record<string, unknown>>;
};

function isRendered(value: unknown): value is Rendered {
  return isRecord(value) && isRecord(value.services) && isRecord(value.networks);
}

async function config(env: Record<string, string>, project = "banki-edge"): Promise<Rendered> {
  const proc = Bun.spawn(
    [
      "docker",
      "compose",
      "--project-name",
      project,
      "--file",
      join(import.meta.dir, "long-lived.compose.yaml"),
      "config",
      "--format",
      "json",
    ],
    {
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? tmpdir(), ...env },
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

/** A rendered mem_limit, in bytes or as `<n>m` depending on the Compose version, in MiB. */
const megabytes = (limit: unknown) =>
  typeof limit === "string" && limit.endsWith("m")
    ? Number(limit.slice(0, -1))
    : Number(limit) / 2 ** 20;

const HARDENING = {
  read_only: true,
  cap_drop: ["ALL"],
  security_opt: ["no-new-privileges:true"],
  restart: "unless-stopped",
};

describe.skipIf(!hasDocker)("the Long-lived template", () => {
  test("refuses to render without the values the agent sets", async () => {
    const outcome = await config({}).then(
      () => "rendered",
      () => "refused",
    );

    expect(outcome).toBe("refused");
  });

  test("pulls the images by digest, and builds and publishes nothing", async () => {
    const { services } = await config(longLivedEnv(EDGE));

    expect(Object.keys(services).toSorted()).toEqual(["api", "web"]);
    expect(services.api?.image).toBe(`ghcr.io/dkomeza/banki-api@${EDGE.digests.api}`);
    expect(services.web?.image).toBe(`ghcr.io/dkomeza/banki-web@${EDGE.digests.web}`);
    for (const service of Object.values(services)) {
      expect(service).not.toHaveProperty("build");
      expect(service).not.toHaveProperty("ports");
    }
  });

  test("hardens both services as the Preview template does, with the same fixed limits for Edge and Production", async () => {
    for (const target of [EDGE, PRODUCTION]) {
      const { services } = await config(longLivedEnv(target));

      expect(services.api).toMatchObject({
        ...HARDENING,
        tmpfs: ["/tmp"],
        cpus: 1,
        pids_limit: 128,
      });
      expect(megabytes(services.api?.mem_limit)).toBe(512);
      expect(services.web).toMatchObject({
        ...HARDENING,
        tmpfs: ["/tmp", "/config:uid=1000,gid=1000", "/data:uid=1000,gid=1000"],
        cpus: 0.5,
        pids_limit: 64,
      });
      expect(megabytes(services.web?.mem_limit)).toBe(128);
    }
  });

  test("sets each installation's origin, trusts only the Long-lived Newt, and sets no secret", async () => {
    const edge = await config(longLivedEnv(EDGE));
    const production = await config(longLivedEnv(PRODUCTION), "banki-production");

    expect(edge.services.api?.environment).toEqual({
      ORIGIN: "https://preview.banki.dkomeza.com",
    });
    expect(edge.services.web?.environment).toEqual({
      BANKI_ORIGIN: "https://preview.banki.dkomeza.com",
      BANKI_TRUSTED_PROXIES: "172.31.254.2",
    });
    expect(production.services.api?.environment).toEqual({ ORIGIN: "https://banki.dkomeza.com" });
    expect(production.services.web?.environment).toEqual({
      BANKI_ORIGIN: "https://banki.dkomeza.com",
      BANKI_TRUSTED_PROXIES: "172.31.254.2",
    });
  });

  test("reaches the internet, with only web on banki-long-lived and never banki-previews", async () => {
    const { services, networks } = await config(longLivedEnv(EDGE));

    expect(Object.keys(services.api?.networks ?? {})).toEqual(["default"]);
    expect(Object.keys(services.web?.networks ?? {}).toSorted()).toEqual([
      "banki-long-lived",
      "default",
    ]);
    expect(networks.default?.internal).toBeFalsy();
    expect(networks["banki-long-lived"]).toMatchObject({
      name: "banki-long-lived",
      external: true,
    });
    expect(networks).not.toHaveProperty("banki-previews");
  });

  test("keeps the data in the installation's external volume, mounted at /data", async () => {
    for (const [target, project] of [
      [EDGE, "banki-edge"],
      [PRODUCTION, "banki-production"],
    ] as const) {
      const { services, volumes } = await config(longLivedEnv(target), project);
      const name = `${project}-data`;

      expect(services.api?.volumes).toEqual([
        expect.objectContaining({ type: "volume", source: "data", target: "/data" }),
      ]);
      expect(volumes?.data).toMatchObject({ name, external: true });
    }
  });

  test("labels the containers and the network with the installation, the SHA, the deploy time and the images", async () => {
    const { services, networks } = await config(longLivedEnv(EDGE));
    const labels = {
      "banki.long-lived.environment": "edge",
      "banki.long-lived.sha": EDGE.sha,
      "banki.long-lived.deployed-at": EDGE.deployedAt.toISOString(),
      "banki.long-lived.api-digest": EDGE.digests.api,
      "banki.long-lived.web-digest": EDGE.digests.web,
    };

    expect(services.api?.labels).toEqual(labels);
    expect(services.web?.labels).toEqual(labels);
    expect(networks.default?.labels).toEqual(labels);
  });
});
