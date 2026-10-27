import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Renders compose.yaml with `docker compose config`, the way Compose itself
// reads it, and checks what it promises: one hardened Newt pinned to the
// Previews' Newt image, the banki-long-lived network, and no socket or host
// port. Skipped without a docker CLI; nothing is started.

const hasDocker = Bun.which("docker") !== null;

// A fake value, built at runtime so secret scanners don't flag it.
const NEWT_SECRET = ["fake", "newt", "secret"].join("-");

const secrets = mkdtempSync(join(tmpdir(), "banki-long-lived-secrets-"));
writeFileSync(
  join(secrets, "long-lived-newt.env"),
  `PANGOLIN_ENDPOINT=https://pangolin.example.com\nNEWT_ID=id\nNEWT_SECRET=${NEWT_SECRET}\n`,
);
afterAll(() => rmSync(secrets, { recursive: true, force: true }));

type Service = Record<string, unknown> & {
  environment?: Record<string, string>;
  networks?: Record<string, { ipv4_address?: string } | null>;
  volumes?: unknown[];
};
type Rendered = {
  name: string;
  services: Record<string, Service>;
  networks: Record<string, Record<string, unknown>>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function isRendered(value: unknown): value is Rendered {
  return isRecord(value) && isRecord(value.services) && isRecord(value.networks);
}

async function render(): Promise<Rendered> {
  const proc = Bun.spawn(
    [
      "docker",
      "compose",
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
        BANKI_PREVIEW_SECRETS: secrets,
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

/** The `image:` line of a compose file's Newt. */
const newtImage = (file: string) =>
  /^\s*image: (fosrl\/newt\S*)$/m.exec(readFileSync(join(import.meta.dir, file), "utf8"))?.[1];

describe("the Long-lived installations' Newt image", () => {
  test("is the Previews' Newt image, pinned by digest", () => {
    expect(newtImage("compose.yaml")).toMatch(/^fosrl\/newt:[\w.]+@sha256:[0-9a-f]{64}$/);
    expect(newtImage("compose.yaml")).toBe(newtImage("../preview/agent.compose.yaml"));
  });
});

describe.skipIf(!hasDocker)("deploy/long-lived/compose.yaml", () => {
  test("is the project banki-long-lived, with Newt alone", async () => {
    const rendered = await render();

    expect(rendered.name).toBe("banki-long-lived");
    expect(Object.keys(rendered.services)).toEqual(["newt"]);
  });

  test("defines banki-long-lived by name as internal, on 172.31.254.0/24, handing out the upper half only", async () => {
    const { networks } = await render();

    expect(networks["banki-long-lived"]).toMatchObject({
      name: "banki-long-lived",
      internal: true,
    });
    expect(networks["banki-long-lived"]?.ipam).toEqual({
      config: [{ subnet: "172.31.254.0/24", ip_range: "172.31.254.128/25" }],
    });
  });

  test("puts a hardened Newt at 172.31.254.2 and on its tunnel, with no socket and only its settings in its env", async () => {
    const { services } = await render();
    const newt = services.newt;

    expect(newt).toMatchObject({
      read_only: true,
      tmpfs: ["/tmp"],
      cap_drop: ["ALL"],
      security_opt: ["no-new-privileges:true"],
      restart: "unless-stopped",
    });
    expect(newt?.networks?.["banki-long-lived"]?.ipv4_address).toBe("172.31.254.2");
    expect(Object.keys(newt?.networks ?? {}).toSorted()).toEqual(["banki-long-lived", "tunnel"]);
    expect(newt?.volumes ?? []).toEqual([]);
    expect(newt?.environment).toEqual({
      CONFIG_FILE: "/tmp/newt.json",
      DISABLE_SSH: "true",
      DISABLE_CLIENTS: "true",
      PANGOLIN_ENDPOINT: "https://pangolin.example.com",
      NEWT_ID: "id",
      NEWT_SECRET,
    });
  });

  test("publishes no host port", async () => {
    const { services } = await render();

    for (const service of Object.values(services)) expect(service).not.toHaveProperty("ports");
  });
});
