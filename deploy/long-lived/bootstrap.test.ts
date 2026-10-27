import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Runs the real bootstrap script against a temporary directory, answering
// its questions on stdin, in the order it asks them. A fake `docker` comes
// first on PATH, so whether Edge runs, and what reaching it does, is the
// test's to say.

const SCRIPT = join(import.meta.dir, "bootstrap");

let dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "banki-long-lived-bootstrap-"));
  dirs.push(dir);
  return dir;
}

const secretsDir = () => join(tempDir(), "secrets");

// Fake values, built at runtime so secret scanners don't flag them.
const NEWT_SECRET = ["fake", "newt", "secret"].join("-");
const PASSWORD = ["edge", "pass", "word"].join("-");
const OTHER_PASSWORD = ["another", "edge", "pass"].join("-");
const PREVIEWS_PASSWORD = ["abcd", "efgh", "ijkl", "mnop", "qrst"].join("-");
const ENDPOINT = "https://pangolin.example.com";
const EMAIL = "me@example.com";

/** Enter for each of the three Pangolin and DNS steps. */
const STEPS = ["", "", ""];

const FIRST_ANSWERS = [...STEPS, ENDPOINT, "newt-id", NEWT_SECRET, EMAIL, PASSWORD, PASSWORD];

/** A rerun: the answer to showing the steps again, then Enter for every question. */
const keepAll = (show = "") => [show, ...(show === "y" ? STEPS : []), "", "", "", "", ""];

/** What the fake docker CLI does: `inspect` says whether Edge runs, `exec` records what it got. */
const FAKE_DOCKER = `#!/usr/bin/env bash
case "$1" in
  inspect)
    if [ -n "\${FAKE_EDGE_RUNNING:-}" ]; then echo true; else echo "Error: No such object" >&2; exit 1; fi ;;
  exec)
    printf '%s\\n' "$*" >>"$FAKE_DOCKER_LOG/argv"
    cat >"$FAKE_DOCKER_LOG/stdin"
    exit "\${FAKE_EXEC_EXIT:-0}" ;;
  *) exit 1 ;;
esac
`;

type Edge = { running?: boolean; execExit?: number };

async function bootstrap(dir: string, answers: string[], edge: Edge = {}) {
  const fake = tempDir();
  mkdirSync(join(fake, "bin"));
  writeFileSync(join(fake, "bin", "docker"), FAKE_DOCKER, { mode: 0o755 });
  const proc = Bun.spawn(["bash", SCRIPT], {
    env: {
      PATH: `${join(fake, "bin")}:${process.env.PATH ?? ""}`,
      HOME: tmpdir(),
      BANKI_PREVIEW_SECRETS: dir,
      FAKE_DOCKER_LOG: fake,
      FAKE_EDGE_RUNNING: edge.running === true ? "1" : "",
      FAKE_EXEC_EXIT: String(edge.execExit ?? 0),
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.stdin.write(answers.map((answer) => `${answer}\n`).join(""));
  await proc.stdin.end();
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const logged = (file: string) =>
    existsSync(join(fake, file)) ? readFileSync(join(fake, file), "utf8") : undefined;
  return { stdout, stderr, exitCode, execArgv: logged("argv"), execStdin: logged("stdin") };
}

const read = (dir: string, file: string) => readFileSync(join(dir, file), "utf8");
const mode = (path: string) => statSync(path).mode & 0o777;
const snapshot = (dir: string) =>
  Object.fromEntries(readdirSync(dir).map((file) => [file, read(dir, file)]));

/** A secrets directory that already holds the pull agent's files, as on the home server. */
function withPreviewFiles(dir: string) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, "preview-password"), `${PREVIEWS_PASSWORD}\n`, { mode: 0o600 });
  writeFileSync(join(dir, "newt.env"), `PANGOLIN_ENDPOINT=${ENDPOINT}\nNEWT_ID=previews\n`, {
    mode: 0o600,
  });
  writeFileSync(join(dir, "agent.env"), "PANGOLIN_SITE=previews\n", { mode: 0o600 });
}

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

  test("writes Newt's settings and Edge's Email and Password, in 0600 files in a 0700 directory, and no AUTH_SECRET", async () => {
    const dir = secretsDir();

    const result = await bootstrap(dir, FIRST_ANSWERS);

    expect(result.exitCode).toBe(0);
    expect(mode(dir)).toBe(0o700);
    expect(readdirSync(dir).toSorted()).toEqual([
      "edge-email",
      "edge-password",
      "long-lived-newt.env",
    ]);
    for (const file of readdirSync(dir)) expect(mode(join(dir, file))).toBe(0o600);
    expect(read(dir, "long-lived-newt.env")).toBe(
      `PANGOLIN_ENDPOINT=${ENDPOINT}\nNEWT_ID=newt-id\nNEWT_SECRET=${NEWT_SECRET}\n`,
    );
    expect(read(dir, "edge-email")).toBe(`${EMAIL}\n`);
    expect(read(dir, "edge-password")).toBe(`${PASSWORD}\n`);
    expect(result.stderr).not.toContain("AUTH_SECRET");
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toContain(PASSWORD);
    expect(result.stderr).toContain("docker compose -f deploy/long-lived/compose.yaml up -d");
  });

  test("prints the Pangolin and DNS steps on a first run, with the exact names, hosts and targets", async () => {
    const result = await bootstrap(secretsDir(), FIRST_ANSWERS);

    expect(result.stderr).toContain("new site of type Newt");
    expect(result.stderr).toMatch(
      /Banki Edge +at subdomain preview +-> +http +banki-edge-web-1 +port 8080/,
    );
    expect(result.stderr).toMatch(
      /Banki Production +at the base domain +-> +http +banki-production-web-1 +port 8080/,
    );
    expect(result.stderr).toContain("SSO off");
    expect(result.stderr).toContain("DNS record for banki.dkomeza.com itself");
  });

  test("takes the Previews' PANGOLIN_ENDPOINT as the default on a first run, and leaves the Previews' files untouched", async () => {
    const dir = secretsDir();
    withPreviewFiles(dir);
    const previews = snapshot(dir);
    const answers = [...FIRST_ANSWERS];
    answers[3] = "";

    const result = await bootstrap(dir, answers);

    expect(result.exitCode).toBe(0);
    expect(read(dir, "long-lived-newt.env")).toContain(`PANGOLIN_ENDPOINT=${ENDPOINT}\n`);
    expect(read(dir, "long-lived-newt.env")).toContain("NEWT_ID=newt-id\n");
    for (const [file, content] of Object.entries(previews)) expect(read(dir, file)).toBe(content);
  });

  test("keeps every value on a rerun where Enter is the answer, without showing the steps", async () => {
    const dir = secretsDir();
    withPreviewFiles(dir);
    await bootstrap(dir, FIRST_ANSWERS);
    const before = snapshot(dir);

    const result = await bootstrap(dir, keepAll());

    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain("Banki Edge");
    expect(snapshot(dir)).toEqual(before);
    for (const file of readdirSync(dir)) expect(mode(join(dir, file))).toBe(0o600);
  });

  test("shows the steps again on a rerun when the answer is yes", async () => {
    const dir = secretsDir();
    await bootstrap(dir, FIRST_ANSWERS);
    const before = snapshot(dir);

    const result = await bootstrap(dir, keepAll("y"));

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("Banki Edge");
    expect(snapshot(dir)).toEqual(before);
  });

  test("changes only the value given a new answer", async () => {
    const dir = secretsDir();
    await bootstrap(dir, FIRST_ANSWERS);
    const answers = keepAll();
    answers[2] = "other-id";

    await bootstrap(dir, answers);

    expect(read(dir, "long-lived-newt.env")).toBe(
      `PANGOLIN_ENDPOINT=${ENDPOINT}\nNEWT_ID=other-id\nNEWT_SECRET=${NEWT_SECRET}\n`,
    );
    expect(read(dir, "edge-email")).toBe(`${EMAIL}\n`);
    expect(read(dir, "edge-password")).toBe(`${PASSWORD}\n`);
  });

  test("refuses a $ in Newt's settings, which Compose would interpolate, and asks again", async () => {
    const dir = secretsDir();
    const answers = [...FIRST_ANSWERS];
    answers.splice(5, 1, `${NEWT_SECRET}\${X}`, NEWT_SECRET);

    const result = await bootstrap(dir, answers);

    expect(result.exitCode).toBe(0);
    expect(result.stderr.match(/No \$, please/g)).toHaveLength(1);
    expect(read(dir, "long-lived-newt.env")).toContain(`NEWT_SECRET=${NEWT_SECRET}\n`);
  });

  test("has no default Email on a first run", async () => {
    const dir = secretsDir();
    withPreviewFiles(dir);
    writeFileSync(join(dir, "preview-email"), "preview@banki.dkomeza.com\n");
    const answers = [...FIRST_ANSWERS];
    answers.splice(6, 1, "", EMAIL);

    const result = await bootstrap(dir, answers);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("A value is needed.");
    expect(read(dir, "edge-email")).toBe(`${EMAIL}\n`);
  });

  test("asks for the Password again when it is too short, too long, the Previews' or typed differently twice", async () => {
    const dir = secretsDir();
    withPreviewFiles(dir);
    const answers = [
      ...FIRST_ANSWERS.slice(0, 7),
      "",
      "short12",
      "x".repeat(129),
      PREVIEWS_PASSWORD,
      PASSWORD,
      OTHER_PASSWORD,
      "x".repeat(128),
      "x".repeat(128),
    ];

    const result = await bootstrap(dir, answers);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("A value is needed.");
    expect(result.stderr.match(/must be 8 to 128 characters/g)).toHaveLength(2);
    expect(result.stderr).toContain("That is the Previews' Password");
    expect(result.stderr).toContain("The two don't match.");
    expect(read(dir, "edge-password")).toBe(`${"x".repeat(128)}\n`);
  });

  test("takes a Password of exactly 8 characters, spaces included", async () => {
    const dir = secretsDir();
    const answers = [...FIRST_ANSWERS.slice(0, 7), "a b c d ", "a b c d "];

    const result = await bootstrap(dir, answers);

    expect(result.exitCode).toBe(0);
    expect(read(dir, "edge-password")).toBe("a b c d \n");
  });

  test("changes the Password on a rerun with no Edge running, typed twice", async () => {
    const dir = secretsDir();
    await bootstrap(dir, FIRST_ANSWERS);
    const answers = [...keepAll().slice(0, 5), OTHER_PASSWORD, OTHER_PASSWORD];

    const result = await bootstrap(dir, answers);

    expect(result.exitCode).toBe(0);
    expect(read(dir, "edge-password")).toBe(`${OTHER_PASSWORD}\n`);
    expect(result.execArgv).toBeUndefined();
  });

  test("sets a changed Password in a running Edge first, on stdin only, and says every device is signed out", async () => {
    const dir = secretsDir();
    await bootstrap(dir, FIRST_ANSWERS);
    const answers = [...keepAll().slice(0, 5), OTHER_PASSWORD, OTHER_PASSWORD];

    const result = await bootstrap(dir, answers, { running: true });

    expect(result.exitCode).toBe(0);
    expect(result.execArgv).toBe(
      "exec -i banki-edge-api-1 bun run banki reset-password --password-stdin\n",
    );
    expect(result.execStdin).toBe(`${OTHER_PASSWORD}\n`);
    expect(read(dir, "edge-password")).toBe(`${OTHER_PASSWORD}\n`);
    expect(result.stderr).toContain("every Edge device is signed out");
  });

  test("leaves every file as it was when a running Edge refuses the new Password", async () => {
    const dir = secretsDir();
    await bootstrap(dir, FIRST_ANSWERS);
    const before = snapshot(dir);
    const answers = [...keepAll().slice(0, 2), "other-id", "", "", OTHER_PASSWORD, OTHER_PASSWORD];

    const result = await bootstrap(dir, answers, { running: true, execExit: 1 });

    expect(result.exitCode).toBe(1);
    expect(result.execStdin).toBe(`${OTHER_PASSWORD}\n`);
    expect(result.stderr).toContain("couldn't set Edge's new Password");
    expect(snapshot(dir)).toEqual(before);
  });

  test("doesn't reach a running Edge when the Password is kept", async () => {
    const dir = secretsDir();
    await bootstrap(dir, FIRST_ANSWERS);

    const result = await bootstrap(dir, keepAll(), { running: true });

    expect(result.exitCode).toBe(0);
    expect(result.execArgv).toBeUndefined();
  });

  test("refuses to change the Email of a running Edge, and asks again", async () => {
    const dir = secretsDir();
    await bootstrap(dir, FIRST_ANSWERS);
    const answers = [...keepAll().slice(0, 4), "new@example.com", "", ""];

    const result = await bootstrap(dir, answers, { running: true });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("reset Edge instead");
    expect(read(dir, "edge-email")).toBe(`${EMAIL}\n`);
  });

  test("changes the Email when no Edge is running", async () => {
    const dir = secretsDir();
    await bootstrap(dir, FIRST_ANSWERS);
    const answers = [...keepAll().slice(0, 4), "new@example.com", ""];

    const result = await bootstrap(dir, answers);

    expect(result.exitCode).toBe(0);
    expect(read(dir, "edge-email")).toBe("new@example.com\n");
  });

  test("exits 1 and writes nothing when stdin runs out before a needed value", async () => {
    const dir = secretsDir();

    const result = await bootstrap(dir, [...STEPS, ENDPOINT]);

    expect(result.exitCode).toBe(1);
    expect(readdirSync(dir)).toEqual([]);
  });

  test("refuses a directory inside a git work tree", async () => {
    const dir = join(import.meta.dir, ".bootstrap-test-secrets");
    dirs.push(dir);

    const result = await bootstrap(dir, FIRST_ANSWERS);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("inside a git work tree");
    expect(existsSync(dir)).toBe(false);
  });
});
