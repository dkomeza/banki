import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { constants, tmpdir } from "node:os";
import { join } from "node:path";
import { ApiError, HealthResponse } from "@banki/shared";

// Proves the Docker deployment end to end: builds both images for this
// machine's platform, starts the stack under a throwaway Compose project (so
// its volume is throwaway too) on a free host port, and checks it through the
// web container's port only, the way a User's browser reaches it. The images
// get per-run tags, so a User's own `banki-api` and `banki-web` are left alone.
// The stack, its volume and those images are always torn down, even when a
// check fails or the run is interrupted.
//
// Run with `bun run smoke:docker`. It is on demand only: not part of `bun test`
// or CI.

const root = join(import.meta.dir, "..");
const project = `banki-smoke-${process.pid}-${Date.now().toString(36)}`;
const port = freePort();
const origin = `http://127.0.0.1:${port}`;
const env = { ...process.env, BANKI_PORT: String(port) };

// compose.yaml names the images `banki-api` and `banki-web`, the tags a User
// deploys. A second Compose file gives this run's images their own tags, so the
// build doesn't retag the User's, and `down --rmi all` removes only this run's.
const overrideDir = mkdtempSync(join(tmpdir(), "banki-smoke-"));
const overrideFile = join(overrideDir, "compose.smoke.yaml");
writeFileSync(
  overrideFile,
  `services:\n  api:\n    image: ${project}-api\n  web:\n    image: ${project}-web\n`,
);

const IMMUTABLE = "public, max-age=31536000, immutable";
const HEALTH_TIMEOUT_MS = 60_000;

class SmokeFailure extends Error {
  override name = "SmokeFailure";
}

// SIGINT and SIGTERM don't kill this script. They abort the run instead: the
// running docker command is killed (a Ctrl-C reaches Docker anyway, but a
// `kill` doesn't), a pending request or health poll stops, nothing new starts,
// and the run lands in the `finally` below, so the stack still comes down.
const interrupt = new AbortController();
let interruptedBy: "SIGINT" | "SIGTERM" | undefined;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    interruptedBy ??= signal;
    interrupt.abort(signal);
  });
}

function freePort(): number {
  const probe = Bun.serve({ hostname: "0.0.0.0", port: 0, fetch: () => new Response() });
  const found = probe.port;
  void probe.stop(true);
  if (found === undefined) throw new Error("Couldn't find a free port");
  return found;
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new SmokeFailure(message);
}

function step(message: string) {
  console.log(`\n==> ${message}`);
}

function pass(message: string) {
  console.log(`    ok: ${message}`);
}

const readAll = async (stream: unknown) =>
  stream instanceof ReadableStream ? (await new Response(stream).text()).trim() : "";

type RunOptions = {
  /** Capture stdout and stderr instead of printing them. */
  capture?: boolean;
  /** Resolve with a non-zero exit code instead of failing the run. */
  allowFailure?: boolean;
  /** Teardown runs even after an interrupt, and an interrupt doesn't kill it. */
  teardown?: boolean;
};

/** Runs a command from the repo root; an interrupt kills it unless it is teardown. */
async function exec(
  cmd: string[],
  { capture = false, allowFailure = false, teardown = false }: RunOptions = {},
): Promise<{ exitCode: number; stdout: string }> {
  if (!teardown) interrupt.signal.throwIfAborted();
  const proc = Bun.spawn(cmd, {
    cwd: root,
    env,
    stdin: "ignore",
    stdout: capture ? "pipe" : "inherit",
    stderr: capture ? "pipe" : "inherit",
    signal: teardown ? undefined : interrupt.signal,
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    readAll(proc.stdout),
    readAll(proc.stderr),
  ]);
  if (exitCode !== 0 && !allowFailure) {
    interrupt.signal.throwIfAborted();
    throw new SmokeFailure(`\`${cmd.join(" ")}\` exited with code ${exitCode}\n${stderr}`.trim());
  }
  return { exitCode, stdout };
}

/** Runs `docker compose` against this run's project and its image tags. */
const compose = (args: string[], options?: RunOptions) =>
  exec(
    [
      "docker",
      "compose",
      "--project-name",
      project,
      "--file",
      "compose.yaml",
      "--file",
      overrideFile,
      ...args,
    ],
    options,
  );

/** Runs `docker compose`, capturing its output instead of printing it. */
const composeOutput = async (args: string[]) => (await compose(args, { capture: true })).stdout;

/** The API container's JSON log records, oldest first. */
async function apiLogRecords(): Promise<Array<{ message: string; properties: unknown }>> {
  const text = await composeOutput(["logs", "--no-color", "--no-log-prefix", "api"]);
  return text
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line): unknown => JSON.parse(line))
    .flatMap((record) =>
      typeof record === "object" &&
      record !== null &&
      "message" in record &&
      typeof record.message === "string"
        ? [{ message: record.message, properties: "properties" in record ? record.properties : {} }]
        : [],
    );
}

async function get(path: string): Promise<Response> {
  try {
    return await fetch(`${origin}${path}`, { signal: interrupt.signal });
  } catch (error) {
    throw new SmokeFailure(`GET ${path} failed: ${String(error)}`);
  }
}

/** Polls /api/health through the web port until it reports healthy. */
async function waitForHealth(): Promise<void> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let last = "no response yet";
  while (Date.now() < deadline && !interrupt.signal.aborted) {
    try {
      const res = await fetch(`${origin}/api/health`, { signal: interrupt.signal });
      const body: unknown = await res.json().catch(() => undefined);
      if (res.ok && HealthResponse.safeParse(body).success) return;
      last = `HTTP ${res.status} ${JSON.stringify(body)}`;
    } catch (error) {
      last = String(error);
    }
    await Bun.sleep(500);
  }
  throw new SmokeFailure(`/api/health didn't report healthy within 60 s (last: ${last})`);
}

async function checkSpa(path: string): Promise<string> {
  const res = await get(path);
  check(res.status === 200, `GET ${path} answered HTTP ${res.status}, expected 200`);
  const type = res.headers.get("content-type") ?? "";
  check(type.startsWith("text/html"), `GET ${path} answered ${type}, expected text/html`);
  const html = await res.text();
  check(html.includes('<div id="root">'), `GET ${path} didn't return the SPA's index.html`);
  return html;
}

async function checkHealth() {
  const res = await get("/api/health");
  check(res.status === 200, `GET /api/health answered HTTP ${res.status}, expected 200`);
  const body: unknown = await res.json();
  const parsed = HealthResponse.safeParse(body);
  check(
    parsed.success,
    `GET /api/health body ${JSON.stringify(body)} fails the HealthResponse contract`,
  );
}

async function checkApiNotFound() {
  const res = await get("/api/does-not-exist");
  check(res.status === 404, `GET /api/does-not-exist answered HTTP ${res.status}, expected 404`);
  const type = res.headers.get("content-type") ?? "";
  check(
    type.startsWith("application/json"),
    `GET /api/does-not-exist answered ${type}, expected JSON`,
  );
  const body: unknown = await res.json();
  const parsed = ApiError.safeParse(body);
  check(
    parsed.success && parsed.data.error.code === "not_found",
    `GET /api/does-not-exist body ${JSON.stringify(body)} isn't the API's not_found error`,
  );
}

async function checkImmutableAsset(html: string) {
  const asset = /\/assets\/[^"]+\.js/.exec(html)?.[0];
  check(asset !== undefined, "index.html references no /assets/*.js file");
  const res = await get(asset);
  check(res.status === 200, `GET ${asset} answered HTTP ${res.status}, expected 200`);
  const cacheControl = res.headers.get("cache-control");
  check(
    cacheControl === IMMUTABLE,
    `GET ${asset} has Cache-Control ${JSON.stringify(cacheControl)}, expected ${JSON.stringify(IMMUTABLE)}`,
  );
  return asset;
}

async function checkNonRoot(service: "api" | "web") {
  const uid = await composeOutput(["exec", "-T", service, "id", "-u"]);
  check(/^\d+$/.test(uid), `\`id -u\` in ${service} printed ${JSON.stringify(uid)}`);
  check(uid !== "0", `${service} runs as root`);
  return uid;
}

async function checkSurvivesRestart() {
  await compose(["restart"]);
  await waitForHealth();
  const exists = await compose(["exec", "-T", "api", "test", "-f", "/data/banki.db"], {
    capture: true,
    allowFailure: true,
  });
  check(exists.exitCode === 0, "banki.db isn't in the volume after the restart");
  const migrations = (await apiLogRecords()).filter((record) =>
    record.message.startsWith("Migrations applied"),
  );
  check(migrations.length === 2, `expected 2 boots in the API logs, found ${migrations.length}`);
  check(
    JSON.stringify(migrations[1]?.properties) === JSON.stringify({ migrations: [] }),
    `the second boot applied migrations (${migrations[1]?.message}), so the database didn't persist`,
  );
}

async function checkCleanStop() {
  await compose(["stop", "api"]);
  const id = await composeOutput(["ps", "--all", "--quiet", "api"]);
  check(id !== "", "can't find the api container after stopping it");
  const { stdout: exitCode } = await exec(
    ["docker", "inspect", "--format", "{{.State.ExitCode}}", id],
    { capture: true },
  );
  check(exitCode === "0", `the API exited with code ${exitCode} on stop, expected 0`);
  const last = (await apiLogRecords()).at(-1);
  check(
    last?.message.startsWith("Shutting down") === true,
    `the API's last log line is ${JSON.stringify(last?.message)}, expected "Shutting down"`,
  );
}

async function run() {
  step(`Building and starting project ${project} on port ${port}`);
  await compose(["up", "--detach", "--build", "--wait", "--wait-timeout", "180"]);

  step("Checking through the web port");
  const html = await checkSpa("/");
  pass("/ returns the SPA");
  const deepLink = await checkSpa("/some/client/route");
  check(deepLink === html, "a deep link returned different HTML from /");
  pass("/some/client/route falls back to the SPA");
  await checkHealth();
  pass("/api/health passes the HealthResponse contract and reports healthy");
  await checkApiNotFound();
  pass("/api/does-not-exist returns the API's JSON 404");
  const asset = await checkImmutableAsset(html);
  pass(`${asset} is served immutable`);

  step("Checking the containers");
  pass(`api runs as uid ${await checkNonRoot("api")}`);
  pass(`web runs as uid ${await checkNonRoot("web")}`);

  step("Restarting the stack");
  await checkSurvivesRestart();
  pass("banki.db survives a restart, and health still passes");

  step("Stopping the API");
  await checkCleanStop();
  pass('the API logs "Shutting down" and exits with code 0');
}

let failed = false;
try {
  await run();
} catch (error) {
  failed = true;
  if (interruptedBy !== undefined) {
    console.error(`\nSmoke test interrupted by ${interruptedBy}`);
  } else {
    console.error(`\nSmoke test FAILED: ${error instanceof Error ? error.message : String(error)}`);
    const logs = await compose(["logs", "--no-color", "--tail", "50"], {
      capture: true,
      allowFailure: true,
      teardown: true,
    });
    console.error(`\nLast container logs:\n${logs.stdout}`);
  }
} finally {
  step(`Tearing down project ${project}, including its volume and images`);
  await compose(["down", "--volumes", "--remove-orphans", "--rmi", "all"], {
    allowFailure: true,
    teardown: true,
  });
  rmSync(overrideDir, { recursive: true, force: true });
}

// The usual exit code for a process ended by a signal: 128 plus its number.
if (interruptedBy !== undefined) process.exit(128 + constants.signals[interruptedBy]);
if (failed) process.exit(1);
console.log("\nSmoke test passed.");
