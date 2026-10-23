// Runs one command with a timeout, its output logged line by line under a
// name or kept quiet. The Runner's environment holds no secret (those are
// files under /run/secrets), so a command inherits it.

export type RunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** Whether the command was killed for running longer than its timeout. */
  timedOut: boolean;
};

export type RunOptions = {
  timeoutMs: number;
  cwd?: string;
  env?: Record<string, string>;
  /** A name to log the command's output under, line by line as it comes, or undefined to keep it quiet. */
  logAs?: string;
};

export async function run(argv: string[], options: RunOptions): Promise<RunResult> {
  const proc = Bun.spawn(argv, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGKILL");
  }, options.timeoutMs);
  const [stdout, stderr, exitCode] = await Promise.all([
    read(proc.stdout, options.logAs, console.log),
    read(proc.stderr, options.logAs, console.error),
    proc.exited,
  ]);
  clearTimeout(timer);
  return { exitCode, stdout, stderr, timedOut };
}

/** Why a command failed, in a few words and its last line of stderr. */
export function failure(result: RunResult): string {
  if (result.timedOut) return "timed out";
  const last = result.stderr.trim().split("\n").at(-1) ?? "";
  return `exited ${result.exitCode}${last === "" ? "" : `: ${last.slice(0, 300)}`}`;
}

/** A stream's whole text, each line logged under `logAs` as soon as it ends. */
async function read(
  stream: ReadableStream<Uint8Array>,
  logAs: string | undefined,
  write: (line: string) => void,
) {
  const decoder = new TextDecoder();
  let text = "";
  let partial = "";
  const log = (line: string) => {
    if (logAs !== undefined && line.trim() !== "") write(`[${logAs}] ${line}`);
  };
  for await (const chunk of stream) {
    const piece = decoder.decode(chunk, { stream: true });
    text += piece;
    const lines = `${partial}${piece}`.split("\n");
    partial = lines.pop() ?? "";
    lines.forEach(log);
  }
  const rest = decoder.decode();
  text += rest;
  log(`${partial}${rest}`);
  return text;
}
