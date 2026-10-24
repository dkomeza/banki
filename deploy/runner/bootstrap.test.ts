import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";

// Runs the real bootstrap script against a temporary directory, answering
// its questions on stdin, in the order it asks them.

const SCRIPT = join(import.meta.dir, "bootstrap");

let dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

/** A secrets directory to be, the .env to write, and a key file to copy in, under one temporary parent. */
function setup() {
  const parent = mkdtempSync(join(tmpdir(), "banki-runner-bootstrap-"));
  dirs.push(parent);
  const key = join(parent, "banki-runner.private-key.pem");
  writeFileSync(key, KEY);
  return { dir: join(parent, "secrets"), composeEnv: join(parent, "compose.env"), key, parent };
}

// Fake values, built at runtime so secret scanners don't flag them.
const CLAUDE_TOKEN = ["sk", "ant", "oat01", "fake"].join("-");
const LINEAR_SECRET = ["fake", "linear", "secret"].join("-");
const PEM_LABEL = ["RSA", "PRIVATE", "KEY"].join(" ");
const KEY = [`-----BEGIN ${PEM_LABEL}-----`, "ZmFrZQ==", `-----END ${PEM_LABEL}-----`, ""].join(
  "\n",
);

const answers = (key: string) => [CLAUDE_TOKEN, "123456", key, "linear-client-id", LINEAR_SECRET];
/** Enter for every question, keeping each value. */
const KEEP_ALL = ["", "", "", "", ""];

async function bootstrap(
  paths: { dir: string; composeEnv: string },
  input: string[],
  env: Record<string, string> = { TZ: "Europe/Warsaw" },
) {
  const proc = Bun.spawn(["bash", SCRIPT], {
    env: {
      PATH: process.env.PATH ?? "",
      HOME: tmpdir(),
      BANKI_RUNNER_SECRETS: paths.dir,
      BANKI_RUNNER_COMPOSE_ENV: paths.composeEnv,
      ...env,
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.stdin.write(input.map((answer) => `${answer}\n`).join(""));
  await proc.stdin.end();
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

const read = (dir: string, file: string) => readFileSync(join(dir, file), "utf8");
const mode = (path: string) => statSync(path).mode & 0o777;
const all = (dir: string) =>
  Object.fromEntries(readdirSync(dir).map((file) => [file, read(dir, file)]));

describe("bootstrap", () => {
  test("passes bash -n", async () => {
    const proc = Bun.spawn(["bash", "-n", SCRIPT], { stderr: "pipe" });
    expect(await proc.exited).toBe(0);
  });

  test.skipIf(Bun.which("shellcheck") === null)("passes shellcheck", async () => {
    const proc = Bun.spawn(["shellcheck", SCRIPT], { stdout: "pipe" });
    const output = await new Response(proc.stdout).text();
    expect(output).toBe("");
    expect(await proc.exited).toBe(0);
  });

  test("writes every secret, in 0600 files in a 0700 directory, the key copied in", async () => {
    const paths = setup();

    const result = await bootstrap(paths, answers(paths.key));

    expect(result.exitCode).toBe(0);
    expect(mode(paths.dir)).toBe(0o700);
    expect(readdirSync(paths.dir).toSorted()).toEqual([
      "broker.env",
      "claude-token",
      "github-app-key",
      "linear-client-secret",
    ]);
    for (const file of readdirSync(paths.dir)) expect(mode(join(paths.dir, file))).toBe(0o600);
    expect(read(paths.dir, "claude-token")).toBe(`${CLAUDE_TOKEN}\n`);
    expect(read(paths.dir, "github-app-key")).toBe(KEY);
    expect(read(paths.dir, "linear-client-secret")).toBe(`${LINEAR_SECRET}\n`);
    expect(read(paths.dir, "broker.env")).toBe(
      "GITHUB_APP_ID=123456\nLINEAR_CLIENT_ID=linear-client-id\n",
    );
  });

  test("records the host user's uid and gid, the host's timezone, and where the secrets are, for Compose", async () => {
    const paths = setup();

    await bootstrap(paths, answers(paths.key));

    const { uid, gid } = userInfo();
    expect(readFileSync(paths.composeEnv, "utf8")).toBe(
      `BANKI_RUNNER_UID=${uid}\nBANKI_RUNNER_GID=${gid}\nBANKI_RUNNER_TZ=Europe/Warsaw\nBANKI_RUNNER_SECRETS=${paths.dir}\n`,
    );
  });

  test("reads the host's timezone from the system when TZ isn't set", async () => {
    const paths = setup();

    await bootstrap(paths, answers(paths.key), {});

    const line = readFileSync(paths.composeEnv, "utf8")
      .split("\n")
      .find((found) => found.startsWith("BANKI_RUNNER_TZ="));
    const timezone = line?.slice("BANKI_RUNNER_TZ=".length) ?? "";
    expect(() => Intl.DateTimeFormat("en-US", { timeZone: timezone })).not.toThrow();
    expect(timezone).not.toBe("");
  });

  test("keeps the other settings in that file, such as the Dispatcher's, on a re-run", async () => {
    const paths = setup();
    await bootstrap(paths, answers(paths.key));
    writeFileSync(
      paths.composeEnv,
      `${readFileSync(paths.composeEnv, "utf8")}BANKI_RUNNER_CEILING=0.45\n`,
    );

    await bootstrap(paths, KEEP_ALL, { TZ: "UTC" });

    const lines = readFileSync(paths.composeEnv, "utf8").split("\n");
    expect(lines).toContain("BANKI_RUNNER_CEILING=0.45");
    expect(lines).toContain("BANKI_RUNNER_TZ=UTC");
    expect(lines.filter((found) => found.startsWith("BANKI_RUNNER_TZ="))).toHaveLength(1);
  });

  test("never prints a secret", async () => {
    const paths = setup();

    const result = await bootstrap(paths, answers(paths.key));

    for (const secret of [CLAUDE_TOKEN, LINEAR_SECRET, "ZmFrZQ=="]) {
      expect(result.stdout + result.stderr).not.toContain(secret);
    }
  });

  test("keeps every value on a re-run where Enter is the answer, the key included", async () => {
    const paths = setup();
    await bootstrap(paths, answers(paths.key));
    const before = all(paths.dir);
    rmSync(paths.key);

    const result = await bootstrap(paths, KEEP_ALL);

    expect(result.exitCode).toBe(0);
    expect(all(paths.dir)).toEqual(before);
  });

  test("changes only the value given a new answer", async () => {
    const paths = setup();
    await bootstrap(paths, answers(paths.key));
    const input = [...KEEP_ALL];
    input[1] = "654321";

    await bootstrap(paths, input);

    expect(read(paths.dir, "broker.env")).toBe(
      "GITHUB_APP_ID=654321\nLINEAR_CLIENT_ID=linear-client-id\n",
    );
    expect(read(paths.dir, "claude-token")).toBe(`${CLAUDE_TOKEN}\n`);
  });

  test("copies a new key in when given one, in place", async () => {
    const paths = setup();
    await bootstrap(paths, answers(paths.key));
    const inode = statSync(join(paths.dir, "github-app-key")).ino;
    const rotated = KEY.replace("ZmFrZQ==", "bmV3");
    writeFileSync(paths.key, rotated);
    const input = [...KEEP_ALL];
    input[2] = paths.key;

    await bootstrap(paths, input);

    expect(read(paths.dir, "github-app-key")).toBe(rotated);
    expect(statSync(join(paths.dir, "github-app-key")).ino).toBe(inode);
  });

  test("asks again for a key path that isn't a private key, or isn't there", async () => {
    const paths = setup();
    const notAKey = join(paths.parent, "notes.txt");
    writeFileSync(notAKey, "hello");
    const input = answers(paths.key);
    input.splice(2, 1, join(paths.parent, "missing.pem"), notAKey, paths.key);

    const result = await bootstrap(paths, input);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("No file to read at");
    expect(result.stderr).toContain("isn't a PEM private key");
    expect(read(paths.dir, "github-app-key")).toBe(KEY);
  });

  test("asks again for an App ID that isn't a number, and refuses a $ in broker.env", async () => {
    const paths = setup();
    const input = answers(paths.key);
    input.splice(1, 1, "my-app", "123456");
    input.splice(4, 1, "client$HOME", "linear-client-id");

    const result = await bootstrap(paths, input);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("A number, please.");
    expect(result.stderr).toContain("No $, please");
    expect(read(paths.dir, "broker.env")).toBe(
      "GITHUB_APP_ID=123456\nLINEAR_CLIENT_ID=linear-client-id\n",
    );
  });

  test("exits 1 and writes nothing when stdin runs out before a needed value", async () => {
    const paths = setup();

    const result = await bootstrap(paths, [CLAUDE_TOKEN]);

    expect(result.exitCode).toBe(1);
    expect(readdirSync(paths.dir)).toEqual([]);
    expect(existsSync(paths.composeEnv)).toBe(false);
  });

  test("refuses a directory inside a git work tree", async () => {
    const paths = setup();
    const dir = join(import.meta.dir, ".bootstrap-test-secrets");
    dirs.push(dir);

    const result = await bootstrap({ ...paths, dir }, answers(paths.key));

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("inside a git work tree");
    expect(existsSync(dir)).toBe(false);
  });
});
