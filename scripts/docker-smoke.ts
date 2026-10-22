import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { constants, tmpdir } from "node:os";
import { join } from "node:path";
import { ApiError, HealthResponse, MeResponse, SetupStatus } from "@banki/shared";

// Proves the Docker deployment end to end: builds both images for this
// machine's platform, starts the stack under a throwaway Compose project (so
// its volume is throwaway too) on a free host port, and checks it through the
// web container's port only, the way a User's browser reaches it: the app,
// Setup, signing in and out, the client IP Caddy forwards, a restart and the
// `banki` CLI (reset-password, a refused second setup, and seed). The images
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
// The stack's ORIGIN is the address this script reaches it at, as a User sets
// BANKI_ORIGIN to the address they open Banki at.
const env = { ...process.env, BANKI_PORT: String(port), BANKI_ORIGIN: origin };

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
const EMAIL = "smoke@example.com";
const PASSWORD = "smoke-test-password";
const NEW_PASSWORD = "smoke-test-password-reset";
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
  "content-security-policy": CSP,
};
const HSTS = "max-age=31536000";
// The web image started alone, a second time, with an https BANKI_ORIGIN.
const hstsContainer = `${project}-hsts`;
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
  /** Written to the command's stdin. */
  input?: string;
  /** Extra environment variables for this command only. */
  extraEnv?: Record<string, string>;
  /** Resolve with a non-zero exit code instead of failing the run. */
  allowFailure?: boolean;
  /** Teardown runs even after an interrupt, and an interrupt doesn't kill it. */
  teardown?: boolean;
};

/** Runs a command from the repo root; an interrupt kills it unless it is teardown. */
async function exec(
  cmd: string[],
  {
    capture = false,
    input,
    extraEnv = {},
    allowFailure = false,
    teardown = false,
  }: RunOptions = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  if (!teardown) interrupt.signal.throwIfAborted();
  const proc = Bun.spawn(cmd, {
    cwd: root,
    env: { ...env, ...extraEnv },
    stdin: input === undefined ? "ignore" : new TextEncoder().encode(input),
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
  return { exitCode, stdout, stderr };
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

/** The API container's JSON log records (stdout and stderr), oldest first. */
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

async function get(path: string, cookie?: string): Promise<Response> {
  try {
    return await fetch(`${origin}${path}`, {
      headers: cookie === undefined ? {} : { cookie },
      signal: interrupt.signal,
    });
  } catch (error) {
    throw new SmokeFailure(`GET ${path} failed: ${String(error)}`);
  }
}

/** POSTs JSON the way the web app does: from ORIGIN, with any cookie. */
async function post(
  path: string,
  body: unknown,
  { cookie, headers = {} }: { cookie?: string; headers?: Record<string, string> } = {},
): Promise<Response> {
  try {
    return await fetch(`${origin}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
        ...(cookie === undefined ? {} : { cookie }),
        ...headers,
      },
      body: JSON.stringify(body),
      signal: interrupt.signal,
    });
  } catch (error) {
    throw new SmokeFailure(`POST ${path} failed: ${String(error)}`);
  }
}

/** The `name=value` part of each cookie a response sets, as a Cookie header. */
const cookiesFrom = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");

function expectStatus(res: Response, expected: number, what: string) {
  check(res.status === expected, `${what} answered HTTP ${res.status}, expected ${expected}`);
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

/** An unknown /api path is the API's JSON 401 when signed out, and its JSON 404 when signed in. */
async function checkApiError(cookie: string | undefined, status: number, code: string) {
  const res = await get("/api/does-not-exist", cookie);
  expectStatus(res, status, "GET /api/does-not-exist");
  const type = res.headers.get("content-type") ?? "";
  check(
    type.startsWith("application/json"),
    `GET /api/does-not-exist answered ${type}, expected JSON`,
  );
  const body: unknown = await res.json();
  const parsed = ApiError.safeParse(body);
  check(
    parsed.success && parsed.data.error.code === code,
    `GET /api/does-not-exist body ${JSON.stringify(body)} isn't the API's ${code} error`,
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

async function checkSecurityHeaders(path: string) {
  const res = await get(path);
  await res.arrayBuffer();
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    const actual = res.headers.get(name);
    check(
      actual === value,
      `GET ${path} has ${name} ${JSON.stringify(actual)}, expected ${JSON.stringify(value)}`,
    );
  }
  const hsts = res.headers.get("strict-transport-security");
  check(hsts === null, `GET ${path} sends HSTS (${hsts}) under the http origin ${origin}`);
}

/** The manifest, by its own type and revalidated, and each of its icons as a PNG. */
async function checkManifest() {
  const res = await get("/manifest.webmanifest");
  expectStatus(res, 200, "GET /manifest.webmanifest");
  const type = res.headers.get("content-type") ?? "";
  check(
    type.startsWith("application/manifest+json"),
    `GET /manifest.webmanifest answered ${type}, expected application/manifest+json`,
  );
  const cacheControl = res.headers.get("cache-control");
  check(
    cacheControl === "no-cache",
    `GET /manifest.webmanifest has Cache-Control ${JSON.stringify(cacheControl)}, expected "no-cache"`,
  );
  const manifest: unknown = await res.json();
  const icons =
    typeof manifest === "object" && manifest !== null && "icons" in manifest
      ? manifest.icons
      : undefined;
  check(Array.isArray(icons) && icons.length > 0, "the manifest lists no icons");
  for (const icon of icons) {
    const src: unknown = typeof icon === "object" && icon !== null && "src" in icon && icon.src;
    check(
      typeof src === "string",
      `the manifest has an icon without a src: ${JSON.stringify(icon)}`,
    );
    const path = new URL(src, `${origin}/`).pathname;
    const png = await get(path);
    await png.arrayBuffer();
    expectStatus(png, 200, `GET ${path}`);
    const pngType = png.headers.get("content-type");
    check(pngType === "image/png", `GET ${path} answered ${pngType}, expected image/png`);
  }
  return icons.length;
}

/** No service worker: /sw.js is at most the SPA's index.html, never a script. */
async function checkNoServiceWorker() {
  const res = await get("/sw.js");
  await res.arrayBuffer();
  const type = res.headers.get("content-type") ?? "";
  check(
    res.status !== 200 || type.startsWith("text/html"),
    `GET /sw.js answered HTTP ${res.status} as ${type}: a service worker is deployed`,
  );
}

/** The web image, started alone with an https BANKI_ORIGIN, sends HSTS. */
async function checkHstsOverHttps() {
  const hstsPort = freePort();
  await exec([
    "docker",
    "run",
    "--detach",
    "--rm",
    "--name",
    hstsContainer,
    "--env",
    "BANKI_ORIGIN=https://banki.example.com",
    "--publish",
    `127.0.0.1:${hstsPort}:8080`,
    `${project}-web`,
  ]);
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let hsts: string | null = null;
  let answered = false;
  let last = "no response yet";
  while (Date.now() < deadline && !interrupt.signal.aborted) {
    try {
      const res = await fetch(`http://127.0.0.1:${hstsPort}/`, { signal: interrupt.signal });
      await res.arrayBuffer();
      hsts = res.headers.get("strict-transport-security");
      answered = true;
      break;
    } catch (error) {
      last = String(error);
    }
    await Bun.sleep(250);
  }
  check(answered, `the web image alone didn't answer within 60 s (last: ${last})`);
  check(
    hsts === HSTS,
    `with BANKI_ORIGIN=https://banki.example.com, GET / has Strict-Transport-Security ${JSON.stringify(hsts)}, expected ${JSON.stringify(HSTS)}`,
  );
  await exec(["docker", "rm", "--force", hstsContainer], { capture: true });
}

async function setupStatus(): Promise<boolean> {
  const res = await get("/api/setup");
  expectStatus(res, 200, "GET /api/setup");
  return SetupStatus.parse(await res.json()).setUp;
}

async function checkSignedOutBeforeSetup() {
  expectStatus(await get("/api/me"), 401, "GET /api/me signed out");
  check(!(await setupStatus()), "GET /api/setup says Banki is set up before Setup");
}

/** A string property of a log record's properties, if it has one. */
function stringProperty(properties: unknown, name: string): string | undefined {
  if (typeof properties !== "object" || properties === null) return undefined;
  const value: unknown = Object.entries(properties).find(([key]) => key === name)?.[1];
  return typeof value === "string" ? value : undefined;
}

/** The Setup token the API logged on its latest start. */
async function setupTokenFromLogs(): Promise<string> {
  const logged = (await apiLogRecords())
    .map(({ properties }) => ({
      token: stringProperty(properties, "setupToken"),
      url: stringProperty(properties, "setupUrl"),
    }))
    .filter((record) => record.token !== undefined)
    .at(-1);
  check(logged?.token !== undefined, "`docker compose logs api` shows no Setup token");
  check(
    logged.url === `${origin}/setup?token=${logged.token}`,
    `the logged Setup link ${logged.url} isn't on ORIGIN ${origin}`,
  );
  return logged.token;
}

/** Does Setup through the web port, returning the signed-in cookie. */
async function checkSetup(token: string): Promise<string> {
  const wrong = await post("/api/setup", { token: "wrong", email: EMAIL, password: PASSWORD });
  expectStatus(wrong, 403, "POST /api/setup with a wrong token");
  const right = await post("/api/setup", { token, email: EMAIL, password: PASSWORD });
  expectStatus(right, 204, "POST /api/setup with the logged token");
  const cookie = cookiesFrom(right);
  check(cookie !== "", "POST /api/setup set no cookie");
  return cookie;
}

async function checkMe(cookie: string) {
  const res = await get("/api/me", cookie);
  expectStatus(res, 200, "GET /api/me signed in");
  const me = MeResponse.parse(await res.json());
  check(me.email === EMAIL, `GET /api/me answered ${me.email}, expected ${EMAIL}`);
}

async function checkSignOut(cookie: string) {
  expectStatus(await post("/api/auth/sign-out", {}, { cookie }), 200, "POST /api/auth/sign-out");
  expectStatus(await get("/api/me", cookie), 401, "GET /api/me after signing out");
}

/** Signs in through the web port, returning the cookie. */
async function signIn(password: string, expected: number, headers?: Record<string, string>) {
  const res = await post("/api/auth/sign-in/email", { email: EMAIL, password }, { headers });
  expectStatus(
    res,
    expected,
    `signing in with ${password === "wrong-password" ? "a wrong" : "the"} Password`,
  );
  return cookiesFrom(res);
}

/** The client IP the API logged for the latest failed sign-in. */
async function lastFailedSignInIp(): Promise<string> {
  const failed = (await apiLogRecords()).filter((record) =>
    record.message.startsWith("Failed sign-in"),
  );
  const ip = stringProperty(failed.at(-1)?.properties, "ip");
  check(ip !== undefined, "the API logged no IP for a failed sign-in");
  return ip;
}

/**
 * Caddy sends the API a single-value X-Forwarded-For holding the client IP:
 * one a client makes up is ignored, unless it comes from a proxy listed in
 * BANKI_TRUSTED_PROXIES.
 */
async function checkClientIp() {
  await signIn("wrong-password", 401, { "x-forwarded-for": "203.0.113.7" });
  const ip = await lastFailedSignInIp();
  check(ip !== "203.0.113.7", "the API believed an X-Forwarded-For a client made up");
  check(!ip.includes(","), `the API got a multi-value X-Forwarded-For: ${ip}`);
  pass(`a made-up X-Forwarded-For is ignored; the API sees the client as ${ip}`);

  // Trust the address this script connects from, as a User's own proxy.
  await compose(["up", "--detach", "--no-deps", "--wait", "web"], {
    extraEnv: { BANKI_TRUSTED_PROXIES: ip },
  });
  await signIn("wrong-password", 401, { "x-forwarded-for": "203.0.113.7" });
  const forwarded = await lastFailedSignInIp();
  check(
    forwarded === "203.0.113.7",
    `with BANKI_TRUSTED_PROXIES=${ip} the API saw ${forwarded}, expected 203.0.113.7`,
  );
  pass("with BANKI_TRUSTED_PROXIES set, a trusted proxy's X-Forwarded-For is honoured");

  await compose(["up", "--detach", "--no-deps", "--wait", "web"]);
}

async function checkResetPassword(oldCookie: string) {
  const { stdout } = await compose(
    ["exec", "-T", "api", "bun", "run", "banki", "reset-password", "--password-stdin"],
    { capture: true, input: `${NEW_PASSWORD}\n` },
  );
  check(stdout.includes(EMAIL), `reset-password didn't print the Email: ${stdout}`);
  expectStatus(
    await get("/api/me", oldCookie),
    401,
    "GET /api/me with a cookie from before the reset",
  );
  await signIn(PASSWORD, 401);
  await checkMe(await signIn(NEW_PASSWORD, 200));
}

/** `banki setup` refuses an installation that is set up, and the User still signs in. */
async function checkSecondSetupRefused(password: string) {
  const { exitCode, stderr } = await compose(
    [
      "run",
      "--rm",
      "-T",
      "api",
      "bun",
      "run",
      "banki",
      "setup",
      "--email",
      "someone-else@example.com",
      "--password-stdin",
    ],
    { capture: true, input: "someone-elses-password\n", allowFailure: true },
  );
  check(exitCode === 1, `a second banki setup exited with code ${exitCode}, expected 1`);
  check(
    stderr.includes("already set up"),
    `a second banki setup didn't say Banki is already set up: ${stderr}`,
  );
  await checkMe(await signIn(password, 200));
}

async function checkSeed() {
  const { stdout } = await compose(["run", "--rm", "-T", "api", "bun", "run", "banki", "seed"], {
    capture: true,
  });
  check(stdout.includes("Seed data loaded."), `banki seed didn't say it loaded: ${stdout}`);
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
  check(await setupStatus(), "GET /api/setup says Banki isn't set up after the restart");
  const again = await post("/api/setup", { token: "any", email: EMAIL, password: PASSWORD });
  expectStatus(again, 409, "POST /api/setup after the restart");
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
  await checkApiError(undefined, 401, "unauthorized");
  pass("/api/does-not-exist returns the API's JSON 401 when signed out");
  const asset = await checkImmutableAsset(html);
  pass(`${asset} is served immutable`);
  for (const path of ["/", "/api/health", "/api/does-not-exist", asset]) {
    await checkSecurityHeaders(path);
  }
  pass("every response has the three security headers, with the full CSP, and no HSTS over http");
  pass(
    `/manifest.webmanifest is application/manifest+json, and its ${await checkManifest()} icons are PNGs`,
  );
  await checkNoServiceWorker();
  pass("there is no service worker at /sw.js");
  await checkHstsOverHttps();
  pass("the web image alone with an https BANKI_ORIGIN sends HSTS");

  step("Setting up and signing in");
  await checkSignedOutBeforeSetup();
  pass("before Setup, /api/me answers 401 and /api/setup says setUp: false");
  const token = await setupTokenFromLogs();
  pass("the Setup token and link are in `docker compose logs api`");
  const setupCookie = await checkSetup(token);
  pass("a wrong Setup token gets 403, the logged one 204 and a cookie");
  await checkMe(setupCookie);
  pass("/api/me answers the Email when signed in");
  await checkSignOut(setupCookie);
  pass("after signing out, the old cookie gets 401");
  const cookie = await signIn(PASSWORD, 200);
  await checkMe(cookie);
  await checkApiError(cookie, 404, "not_found");
  pass("/api/does-not-exist returns the API's JSON 404 when signed in");
  await signIn("wrong-password", 401);
  pass("signing in works with the Password and fails with a wrong one");
  await checkClientIp();

  step("Checking the containers");
  pass(`api runs as uid ${await checkNonRoot("api")}`);
  pass(`web runs as uid ${await checkNonRoot("web")}`);

  step("Restarting the stack");
  await checkSurvivesRestart();
  pass("banki.db survives a restart, health still passes, and Setup answers 409");

  step("Resetting the Password with the CLI");
  await checkResetPassword(cookie);
  pass("reset-password --password-stdin signs out the old cookie, and the new Password works");

  step("Running banki setup and banki seed with docker compose run");
  await checkSecondSetupRefused(NEW_PASSWORD);
  pass("a second banki setup exits 1 with already set up, and signing in still works");
  await checkSeed();
  pass("banki seed exits 0 and loads the Seed data");

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
  await exec(["docker", "rm", "--force", hstsContainer], {
    capture: true,
    allowFailure: true,
    teardown: true,
  });
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
