// Runs one command with a timeout, the way every Docker step of the agent
// does. Its environment is only what the caller passes plus PATH, HOME and
// DOCKER_HOST: the agent's own environment never leaks into a Compose
// interpolation or a container.

export type RunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** Whether the command was killed for running longer than its timeout. */
  timedOut: boolean;
};

export type RunOptions = {
  timeoutMs: number;
  env?: Record<string, string>;
  /** Written to the command's stdin, which is then closed. Never logged. */
  stdin?: string;
  /** A name to log the command's output under, or undefined to keep it quiet. */
  logAs?: string;
};

const INHERITED = ["PATH", "HOME", "DOCKER_HOST"] as const;

export async function run(argv: string[], options: RunOptions): Promise<RunResult> {
  const env: Record<string, string> = {};
  for (const name of INHERITED) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  Object.assign(env, options.env);

  const proc = Bun.spawn(argv, {
    env,
    stdin: options.stdin === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (options.stdin !== undefined && proc.stdin !== undefined) {
    await proc.stdin.write(options.stdin);
    await proc.stdin.end();
  }

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGKILL");
  }, options.timeoutMs);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);

  if (options.logAs !== undefined) {
    for (const line of `${stdout}${stderr}`.split("\n")) {
      if (line.trim() !== "") console.log(`[${options.logAs}] ${line}`);
    }
  }
  return { exitCode, stdout, stderr, timedOut };
}
