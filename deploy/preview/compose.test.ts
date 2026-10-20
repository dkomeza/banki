import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isRecord } from "./agent/parse";

// Renders the Preview template and agent.compose.yaml with `docker compose
// config`, the way Compose itself reads them, and checks what they promise:
// hardening, limits, networks, and no host port anywhere. Skipped without a
// docker CLI; nothing is started.

const hasDocker = Bun.which("docker") !== null;

const SAMPLE = {
  PREVIEW_PR: "5",
  PREVIEW_SHA: "a".repeat(40),
  PREVIEW_DEPLOYED_AT: "2026-10-20T12:00:00.000Z",
  API_DIGEST: `sha256:${"1".repeat(64)}`,
  WEB_DIGEST: `sha256:${"2".repeat(64)}`,
};

const secrets = mkdtempSync(join(tmpdir(), "banki-preview-secrets-"));
for (const file of ["github-token", "pangolin-api-key", "preview-email", "preview-password"]) {
  writeFileSync(join(secrets, file), "dummy\n", { mode: 0o600 });
}
writeFileSync(
  join(secrets, "agent.env"),
  "PANGOLIN_API_URL=https://api.example.com/v1\nPANGOLIN_ORG_ID=org\nPANGOLIN_SITE=previews\n",
);
writeFileSync(
  join(secrets, "newt.env"),
  "PANGOLIN_ENDPOINT=https://pangolin.example.com\nNEWT_ID=id\nNEWT_SECRET=secret\n",
);
afterAll(() => rmSync(secrets, { recursive: true, force: true }));

type Service = Record<string, unknown> & {
  environment?: Record<string, string>;
  networks?: Record<string, { ipv4_address?: string } | null>;
  labels?: Record<string, string>;
  volumes?: { type: string; source: string; target: string }[];
};
type Rendered = {
  services: Record<string, Service>;
  networks: Record<string, Record<string, unknown>>;
  volumes?: Record<string, { labels?: Record<string, string> }>;
};

function isRendered(value: unknown): value is Rendered {
  return isRecord(value) && isRecord(value.services) && isRecord(value.networks);
}

async function config(file: string, env: Record<string, string>): Promise<Rendered> {
  const proc = Bun.spawn(
    ["docker", "compose", "--file", join(import.meta.dir, file), "config", "--format", "json"],
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
  if (exitCode !== 0) throw new Error(`docker compose config ${file} failed: ${stderr}`);
  const rendered: unknown = JSON.parse(stdout);
  if (!isRendered(rendered)) throw new Error(`docker compose config ${file}: unexpected output`);
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

describe.skipIf(!hasDocker)("the Preview template", () => {
  test("renders cleanly with sample values", async () => {
    await config("compose.yaml", SAMPLE);
  });

  test("refuses to render without the values the agent sets", async () => {
    const outcome = await config("compose.yaml", {}).then(
      () => "rendered",
      () => "refused",
    );

    expect(outcome).toBe("refused");
  });

  test("pulls the images by digest, and builds and publishes nothing", async () => {
    const { services } = await config("compose.yaml", SAMPLE);

    expect(Object.keys(services).toSorted()).toEqual(["api", "web"]);
    expect(services.api?.image).toBe(`ghcr.io/dkomeza/banki-api@${SAMPLE.API_DIGEST}`);
    expect(services.web?.image).toBe(`ghcr.io/dkomeza/banki-web@${SAMPLE.WEB_DIGEST}`);
    for (const service of Object.values(services)) {
      expect(service).not.toHaveProperty("build");
      expect(service).not.toHaveProperty("ports");
    }
  });

  test("hardens both services and limits them", async () => {
    const { services } = await config("compose.yaml", SAMPLE);

    expect(services.api).toMatchObject({
      ...HARDENING,
      tmpfs: ["/tmp"],
      cpus: 1,
      pids_limit: 128,
    });
    expect(megabytes(services.api?.mem_limit)).toBe(256);
    expect(services.web).toMatchObject({
      ...HARDENING,
      tmpfs: ["/tmp", "/config:uid=1000,gid=1000", "/data:uid=1000,gid=1000"],
      cpus: 0.5,
      pids_limit: 64,
    });
    expect(megabytes(services.web?.mem_limit)).toBe(128);
  });

  test("sets the Preview's origin and trusts only Newt, and nothing else", async () => {
    const { services } = await config("compose.yaml", SAMPLE);

    expect(services.api?.environment).toEqual({ ORIGIN: "https://pr-5.banki.dkomeza.com" });
    expect(services.web?.environment).toEqual({ BANKI_TRUSTED_PROXIES: "172.31.255.2" });
  });

  test("keeps api on the internal default network, and only web on banki-previews", async () => {
    const { services, networks } = await config("compose.yaml", SAMPLE);

    expect(Object.keys(services.api?.networks ?? {})).toEqual(["default"]);
    expect(Object.keys(services.web?.networks ?? {}).toSorted()).toEqual([
      "banki-previews",
      "default",
    ]);
    expect(networks.default?.internal).toBe(true);
    expect(networks["banki-previews"]).toMatchObject({ name: "banki-previews", external: true });
  });

  test("labels the containers, the network and the volume with the PR, the SHA, the deploy time and the images", async () => {
    const { services, networks, volumes } = await config("compose.yaml", SAMPLE);
    const labels = {
      "banki.preview.pr": "5",
      "banki.preview.sha": SAMPLE.PREVIEW_SHA,
      "banki.preview.deployed-at": SAMPLE.PREVIEW_DEPLOYED_AT,
      "banki.preview.api-digest": SAMPLE.API_DIGEST,
      "banki.preview.web-digest": SAMPLE.WEB_DIGEST,
    };

    expect(services.api?.labels).toEqual(labels);
    expect(services.web?.labels).toEqual(labels);
    expect(networks.default?.labels).toEqual(labels);
    expect(volumes?.["banki-data"]?.labels).toEqual(labels);
  });
});

const render = () => config("agent.compose.yaml", { BANKI_PREVIEW_SECRETS: secrets });

describe.skipIf(!hasDocker)("agent.compose.yaml", () => {
  test("defines banki-previews as internal, on 172.31.255.0/24", async () => {
    const { networks } = await render();

    expect(networks["banki-previews"]).toEqual({
      name: "banki-previews",
      internal: true,
      ipam: { config: [{ subnet: "172.31.255.0/24" }] },
    });
  });

  test("puts a hardened, pinned Newt at 172.31.255.2, with no socket and only its settings in its env", async () => {
    const { services } = await render();
    const newt = services.newt;

    expect(newt).toMatchObject({ ...HARDENING, tmpfs: ["/tmp"] });
    expect(newt?.image).toMatch(/^fosrl\/newt:1\.18\.1@sha256:[0-9a-f]{64}$/);
    expect(newt?.networks?.["banki-previews"]?.ipv4_address).toBe("172.31.255.2");
    expect(Object.keys(newt?.networks ?? {}).toSorted()).toEqual(["banki-previews", "tunnel"]);
    expect(newt?.volumes ?? []).toEqual([]);
    expect(newt?.environment).toEqual({
      CONFIG_FILE: "/tmp/newt.json",
      DISABLE_SSH: "true",
      DISABLE_CLIENTS: "true",
      PANGOLIN_ENDPOINT: "https://pangolin.example.com",
      NEWT_ID: "id",
      NEWT_SECRET: "secret",
    });
  });

  test("gives the agent the socket and its secrets as files, and keeps it off banki-previews", async () => {
    const { services } = await render();
    const agent = services.agent;

    expect(agent).toMatchObject({ read_only: true, restart: "unless-stopped" });
    expect(agent?.volumes).toEqual([
      expect.objectContaining({ source: "/var/run/docker.sock", target: "/var/run/docker.sock" }),
    ]);
    expect(agent?.secrets).toEqual(
      ["github-token", "pangolin-api-key", "preview-email", "preview-password"].map((name) => ({
        source: name,
        target: `/run/secrets/${name}`,
      })),
    );
    expect(Object.keys(agent?.networks ?? {})).toEqual(["default"]);
    // The secrets never reach its environment.
    expect(Object.keys(agent?.environment ?? {}).toSorted()).toEqual([
      "HOME",
      "PANGOLIN_API_URL",
      "PANGOLIN_ORG_ID",
      "PANGOLIN_SITE",
    ]);
  });

  test("publishes no host port", async () => {
    const { services } = await render();

    for (const service of Object.values(services)) expect(service).not.toHaveProperty("ports");
  });
});
