import { join } from "node:path";

const entry = join(import.meta.dir, "..", "cli.ts");

/**
 * Runs the real `banki` CLI in a child process against `dataDir`, with
 * nothing else from this process's environment but `PATH`.
 */
export async function runCli(
  args: string[],
  {
    dataDir,
    stdin = "",
    env = {},
  }: { dataDir: string; stdin?: string; env?: Record<string, string> },
) {
  const cli = Bun.spawn(["bun", entry, ...args], {
    env: { PATH: process.env.PATH, DATA_DIR: dataDir, ...env },
    stdin: new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    cli.exited,
    new Response(cli.stdout).text(),
    new Response(cli.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}
