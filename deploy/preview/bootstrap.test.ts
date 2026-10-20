import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Runs the real bootstrap script against a temporary directory, answering
// its questions on stdin, in the order it asks them.

const SCRIPT = join(import.meta.dir, "bootstrap");
const PASSWORD_SHAPE = /^[a-z0-9]{4}(-[a-z0-9]{4}){4}$/;

let dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

function secretsDir(): string {
  const parent = mkdtempSync(join(tmpdir(), "banki-bootstrap-"));
  dirs.push(parent);
  return join(parent, "secrets");
}

const FIRST_ANSWERS = [
  "ghp_token",
  "https://api.pangolin.example.com/v1",
  "pangolin-key",
  "my-org",
  "previews",
  "https://pangolin.example.com",
  "newt-id",
  "newt-secret",
  // The Email: Enter takes the default.
  "",
];

/** Enter for every question, keeping each value, then the answer to rotating the Password. */
const keepAll = (rotate: string) => [...FIRST_ANSWERS.map(() => ""), rotate];

async function bootstrap(dir: string, answers: string[]) {
  const proc = Bun.spawn(["bash", SCRIPT], {
    env: { PATH: process.env.PATH ?? "", HOME: tmpdir(), BANKI_PREVIEW_SECRETS: dir },
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
  return { stdout, stderr, exitCode };
}

const read = (dir: string, file: string) => readFileSync(join(dir, file), "utf8");
const mode = (path: string) => statSync(path).mode & 0o777;

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

  test("writes every setting, in 0600 files in a 0700 directory", async () => {
    const dir = secretsDir();

    const result = await bootstrap(dir, FIRST_ANSWERS);

    expect(result.exitCode).toBe(0);
    expect(mode(dir)).toBe(0o700);
    expect(readdirSync(dir).toSorted()).toEqual([
      "agent.env",
      "github-token",
      "newt.env",
      "pangolin-api-key",
      "preview-email",
      "preview-password",
    ]);
    for (const file of readdirSync(dir)) expect(mode(join(dir, file))).toBe(0o600);
    expect(read(dir, "github-token")).toBe("ghp_token\n");
    expect(read(dir, "pangolin-api-key")).toBe("pangolin-key\n");
    expect(read(dir, "agent.env")).toBe(
      "PANGOLIN_API_URL=https://api.pangolin.example.com/v1\nPANGOLIN_ORG_ID=my-org\nPANGOLIN_SITE=previews\n",
    );
    expect(read(dir, "newt.env")).toBe(
      "PANGOLIN_ENDPOINT=https://pangolin.example.com\nNEWT_ID=newt-id\nNEWT_SECRET=newt-secret\n",
    );
    expect(read(dir, "preview-email")).toBe("preview@banki.dkomeza.com\n");
  });

  test("generates the Password and prints it once, never on stdout", async () => {
    const dir = secretsDir();

    const first = await bootstrap(dir, FIRST_ANSWERS);
    const password = read(dir, "preview-password").trim();
    const second = await bootstrap(dir, keepAll("n"));

    expect(password).toMatch(PASSWORD_SHAPE);
    expect(first.stderr).toContain(`Password: ${password}`);
    expect(first.stdout).not.toContain(password);
    expect(second.stderr).not.toContain(password);
  });

  test("keeps every value on a re-run where Enter is the answer", async () => {
    const dir = secretsDir();
    await bootstrap(dir, FIRST_ANSWERS);
    const before = Object.fromEntries(readdirSync(dir).map((file) => [file, read(dir, file)]));

    const result = await bootstrap(dir, keepAll(""));

    expect(result.exitCode).toBe(0);
    expect(Object.fromEntries(readdirSync(dir).map((file) => [file, read(dir, file)]))).toEqual(
      before,
    );
  });

  test("changes only the value given a new answer", async () => {
    const dir = secretsDir();
    await bootstrap(dir, FIRST_ANSWERS);
    const answers = keepAll("n");
    answers[3] = "other-org";

    await bootstrap(dir, answers);

    expect(read(dir, "agent.env")).toBe(
      "PANGOLIN_API_URL=https://api.pangolin.example.com/v1\nPANGOLIN_ORG_ID=other-org\nPANGOLIN_SITE=previews\n",
    );
    expect(read(dir, "github-token")).toBe("ghp_token\n");
  });

  test("rotates the Password only when the answer is yes", async () => {
    const dir = secretsDir();
    await bootstrap(dir, FIRST_ANSWERS);
    const first = read(dir, "preview-password");

    await bootstrap(dir, keepAll("n"));
    expect(read(dir, "preview-password")).toBe(first);

    const rotated = await bootstrap(dir, keepAll("y"));
    const second = read(dir, "preview-password");
    expect(second).not.toBe(first);
    expect(second.trim()).toMatch(PASSWORD_SHAPE);
    expect(rotated.stderr).toContain(`Password: ${second.trim()}`);
    expect(mode(join(dir, "preview-password"))).toBe(0o600);
  });

  test("refuses a $ in a value for agent.env or newt.env, which Compose would interpolate, and asks again", async () => {
    const dir = secretsDir();
    const answers = [...FIRST_ANSWERS];
    // The org ID (agent.env), then the Newt secret (newt.env), each asked again.
    answers.splice(3, 1, "org$HOME", "my-org");
    answers.splice(8, 1, "newt-${SECRET}", "newt-secret");

    const result = await bootstrap(dir, answers);

    expect(result.exitCode).toBe(0);
    expect(result.stderr.match(/No \$, please/g)).toHaveLength(2);
    expect(read(dir, "agent.env")).toContain("PANGOLIN_ORG_ID=my-org\n");
    expect(read(dir, "newt.env")).toContain("NEWT_SECRET=newt-secret\n");
  });

  test("allows a $ in a secret that isn't in an env file", async () => {
    const dir = secretsDir();
    const answers = [...FIRST_ANSWERS];
    answers[2] = "key$with$dollars";

    const result = await bootstrap(dir, answers);

    expect(result.exitCode).toBe(0);
    expect(read(dir, "pangolin-api-key")).toBe("key$with$dollars\n");
  });

  test("exits 1 and writes nothing when stdin runs out before a needed value", async () => {
    const dir = secretsDir();

    const result = await bootstrap(dir, ["ghp_token"]);

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
