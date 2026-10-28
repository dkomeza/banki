import { afterAll } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isRecord } from "./agent/parse";

// Reads a workflow from .github/workflows the way GitHub reads it, and runs
// its steps' scripts under bash, as Actions runs them, against a fake `gh` and
// a fake `docker` that answer from fixtures and record every call, so a test
// reads exactly what the workflow asked GitHub and the registry to do.

export type Step = {
  id?: string;
  name?: string;
  run?: string;
  uses?: string;
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
};
export type Job = {
  name?: string;
  if?: string;
  needs?: string | string[];
  "runs-on"?: string;
  concurrency?: { group: string; "cancel-in-progress": boolean };
  permissions?: Record<string, string>;
  env?: Record<string, string>;
  outputs?: Record<string, string>;
  strategy?: { matrix?: Record<string, unknown> };
  steps: Step[];
};
export type Workflow = {
  on: Record<string, unknown>;
  concurrency: { group: string; "cancel-in-progress": boolean };
  permissions: Record<string, string>;
  jobs: Record<string, Job>;
};

function isWorkflow(value: unknown): value is Workflow {
  return isRecord(value) && isRecord(value.jobs) && isRecord(value.on);
}

export const REPO = "dkomeza/banki";

/** What the fake prints and exits with, or else the JSON it answers. */
export type Raw = { stdout?: string; stderr?: string; exit?: number };
/** Answers, one per call in turn, each JSON or a `Raw`; the last repeats. */
export type Sequence = { sequence: unknown[] };
/**
 * Keyed `METHOD PATH` for `gh api`, and `docker <args joined by spaces>` for
 * `docker`.
 */
export type Answer = Raw | Sequence | unknown[] | Record<string, unknown>;

const isRaw = (answer: unknown): answer is Raw =>
  isRecord(answer) &&
  !Array.isArray(answer) &&
  ("stdout" in answer || "stderr" in answer || "exit" in answer);
const isSequence = (answer: Answer): answer is Sequence =>
  !Array.isArray(answer) && "sequence" in answer;

export type Call = { method: string; path: string; body: unknown };

export const writes = (calls: Call[]) => calls.filter((call) => call.method !== "GET");

// Answers from the $FIXTURES/<n>/ whose key file holds the key, with its
// stdout, stderr and exit; the nth call of a key answers stdout.<n> when there
// is one.
const ANSWER = `answer() {
  local dir="" each
  for each in "$FIXTURES"/*/; do
    if [ -f "$each/key" ] && [ "$(cat "$each/key")" = "$1" ]; then dir="$each"; break; fi
  done
  [ -n "$dir" ] || return 1
  echo >>"$dir/calls"
  n="$(wc -l <"$dir/calls" | tr -d ' ')"
  if [ -f "$dir/stdout.$n" ]; then
    cat "$dir/stdout.$n"
    if [ -f "$dir/stderr.$n" ]; then cat "$dir/stderr.$n" >&2; fi
    exit "$(cat "$dir/exit.$n" 2>/dev/null || echo 0)"
  fi
  if [ -f "$dir/stdout" ]; then cat "$dir/stdout"; fi
  if [ -f "$dir/stderr" ]; then cat "$dir/stderr" >&2; fi
  exit "$(cat "$dir/exit" 2>/dev/null || echo 0)"
}
`;

// The fake `gh api`: [--method M] [--paginate] [--silent] [--input -] [--jq F] PATH.
// An unknown GET is a 404, any other unknown call answers `{}`.
const FAKE_GH = `#!/usr/bin/env bash
set -u
${ANSWER}
[ "$1" = api ] || { echo "fake gh: only api" >&2; exit 2; }
shift
method=GET path="" input="" filter=""
while [ $# -gt 0 ]; do
  case "$1" in
    --method) method="$2"; shift 2 ;;
    --input) input="$2"; shift 2 ;;
    --jq) filter="$2"; shift 2 ;;
    --paginate | --silent) shift ;;
    -*) echo "fake gh: unknown flag $1" >&2; exit 2 ;;
    *) path="$1"; shift ;;
  esac
done
body=""
if [ "$input" = "-" ]; then body="$(cat)"; fi
jq -cn --arg method "$method" --arg path "$path" --arg body "$body" \\
  '{ method: $method, path: $path, body: $body }' >>"$GH_LOG"
respond() {
  answer "$method $path"
  if [ "$method" = GET ]; then echo "gh: Not Found (HTTP 404)" >&2; exit 1; fi
  echo '{}'
}
if [ -z "$filter" ]; then respond; exit 0; fi
# --jq applies its filter to a successful answer, as gh does.
out="$(respond)" || exit $?
jq -r "$filter" <<<"$out"
`;

// The fake `docker`: any arguments. An unknown `imagetools inspect` finds no
// image; any other unknown call succeeds, printing nothing.
const FAKE_DOCKER = `#!/usr/bin/env bash
set -u
${ANSWER}
jq -cn '$ARGS.positional' --args -- "$@" >>"$DOCKER_LOG"
answer "docker $*"
if [ "$1 $2 $3" = "buildx imagetools inspect" ]; then
  echo "ERROR: $4: not found" >&2
  exit 1
fi
`;

const readLines = (file: string): unknown[] =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line): unknown => JSON.parse(line));

export function workflowHarness(fileName: string) {
  const path = join(import.meta.dir, "..", "..", ".github", "workflows", fileName);
  const parsed: unknown = Bun.YAML.parse(readFileSync(path, "utf8"));
  if (!isWorkflow(parsed)) throw new Error(`${fileName}: unexpected shape`);
  const workflow = parsed;

  function job(name: string): Job {
    const found = workflow.jobs[name];
    if (found === undefined) throw new Error(`no job ${name}`);
    return found;
  }

  function step(jobName: string, stepId: string): Step {
    const found = job(jobName).steps.find((candidate) => candidate.id === stepId);
    if (found === undefined) throw new Error(`no step ${jobName}.${stepId}`);
    return found;
  }

  function script(jobName: string, stepId: string): string {
    const run = step(jobName, stepId).run;
    if (run === undefined) throw new Error(`no step ${jobName}.${stepId} with a script`);
    return run;
  }

  const scratch = mkdtempSync(join(tmpdir(), "banki-workflow-"));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));
  const bin = join(scratch, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "gh"), FAKE_GH);
  writeFileSync(join(bin, "docker"), FAKE_DOCKER);
  chmodSync(join(bin, "gh"), 0o755);
  chmodSync(join(bin, "docker"), 0o755);

  let runs = 0;

  /**
   * Runs one step's script as Actions does (`bash -eo pipefail`), with `env`,
   * and `gh` and `docker` answering from `fixtures`. `files` are written under
   * the run's directory, where the script runs, and then `prepare` gets that
   * directory, for what plain files can't set up, such as a git repo.
   */
  async function runStep(
    jobName: string,
    stepId: string,
    env: Record<string, string>,
    fixtures: Record<string, Answer> = {},
    files: Record<string, string> = {},
    prepare?: (dir: string) => void,
  ) {
    const dir = join(scratch, `run-${runs++}`);
    mkdirSync(dir);
    const fixturesDir = join(dir, "fixtures");
    mkdirSync(fixturesDir);
    for (const [n, [key, answer]] of Object.entries(fixtures).entries()) {
      const answerDir = join(fixturesDir, String(n));
      mkdirSync(answerDir);
      writeFileSync(join(answerDir, "key"), key);
      if (isSequence(answer)) {
        answer.sequence.forEach((each, index) => {
          const raw = isRaw(each) ? each : { stdout: JSON.stringify(each) };
          const call = index + 1;
          writeFileSync(join(answerDir, `stdout.${call}`), raw.stdout ?? "");
          if (raw.stderr !== undefined)
            writeFileSync(join(answerDir, `stderr.${call}`), raw.stderr);
          if (raw.exit !== undefined)
            writeFileSync(join(answerDir, `exit.${call}`), String(raw.exit));
        });
        writeFileSync(join(answerDir, "stdout"), JSON.stringify(answer.sequence.at(-1)));
        continue;
      }
      const raw = isRaw(answer) ? answer : { stdout: JSON.stringify(answer) };
      if (raw.stdout !== undefined) writeFileSync(join(answerDir, "stdout"), raw.stdout);
      if (raw.stderr !== undefined) writeFileSync(join(answerDir, "stderr"), raw.stderr);
      if (raw.exit !== undefined) writeFileSync(join(answerDir, "exit"), String(raw.exit));
    }
    for (const [name, content] of Object.entries(files)) {
      const file = join(dir, name);
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, content);
    }
    prepare?.(dir);
    const file = join(dir, "step.sh");
    writeFileSync(file, script(jobName, stepId));
    const ghLog = join(dir, "gh.log");
    const dockerLog = join(dir, "docker.log");
    const output = join(dir, "output");
    writeFileSync(ghLog, "");
    writeFileSync(dockerLog, "");
    writeFileSync(output, "");
    const proc = Bun.spawn(["bash", "--noprofile", "--norc", "-eo", "pipefail", file], {
      cwd: dir,
      env: {
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        HOME: dir,
        GH_LOG: ghLog,
        DOCKER_LOG: dockerLog,
        FIXTURES: fixturesDir,
        GITHUB_OUTPUT: output,
        GITHUB_REPOSITORY: REPO,
        GITHUB_REPOSITORY_OWNER: "DKomeza",
        ...env,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const calls: Call[] = readLines(ghLog).map((call) => {
      if (!isRecord(call) || typeof call.method !== "string" || typeof call.path !== "string") {
        throw new Error(`fake gh: bad log line ${JSON.stringify(call)}`);
      }
      const body = typeof call.body === "string" && call.body !== "" ? call.body : undefined;
      const parsedBody: unknown = body === undefined ? undefined : JSON.parse(body);
      return { method: call.method, path: call.path, body: parsedBody };
    });
    const docker: string[][] = readLines(dockerLog).map((args) => {
      if (!Array.isArray(args) || !args.every((arg) => typeof arg === "string")) {
        throw new Error(`fake docker: bad log line ${JSON.stringify(args)}`);
      }
      return args;
    });
    return { exitCode, out: stdout + stderr, calls, docker, output: readFileSync(output, "utf8") };
  }

  return { workflow, job, step, script, runStep };
}
