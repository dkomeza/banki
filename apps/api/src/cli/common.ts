import { text } from "node:stream/consumers";
import { cancel, isCancel, log, password } from "@clack/prompts";
import { type Config, ConfigError, parseConfig } from "../config";
import { type Database, openDatabase } from "../db/database";
import { applyMigrations } from "../db/migrate";

// The plumbing every `banki` command shares.

/** Ends the command with `exitCode` after printing `message` (if any) to stderr. */
export class CliExit extends Error {
  override name = "CliExit";
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
  }
}

/** The exit code for a command cancelled with Ctrl-C at a prompt. */
const CANCELLED = 130;

/** Runs a command's body, turning a {@link CliExit} into its message and exit code. */
export async function runCommand(body: () => Promise<void>): Promise<void> {
  try {
    await body();
  } catch (error) {
    if (!(error instanceof CliExit)) throw error;
    if (error.message !== "") console.error(error.message);
    process.exit(error.exitCode);
  }
}

/** The same configuration the API reads from its environment. */
export function readConfig(): Config {
  try {
    return parseConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) throw new CliExit(`Invalid configuration:\n${error.message}`);
    throw error;
  }
}

/**
 * Opens the API's data directory and database (the API may be running),
 * applies pending migrations, and runs `body` against it, closing it after.
 */
export async function withDatabase<T>(
  config: Config,
  body: (db: Database) => T | Promise<T>,
): Promise<T> {
  const database = openDatabase(config.dataDir);
  try {
    applyMigrations(database.db);
    return await body(database.db);
  } finally {
    database.close();
  }
}

/** The first line of stdin, without its line ending (`\n` or `\r\n`). */
export async function firstLineOfStdin(): Promise<string> {
  const [line = ""] = (await text(process.stdin)).split(/\r?\n/, 1);
  return line;
}

/** Ends the command after a prompt was cancelled (Ctrl-C), with `message` saying nothing changed. */
export function cancelled(message: string): never {
  cancel(message);
  throw new CliExit("", CANCELLED);
}

/**
 * Asks for a Password twice with hidden input, until both answers match and
 * `validate` accepts them. Ctrl-C at either prompt prints `cancelMessage` and
 * exits 130.
 */
export async function askPasswordTwice({
  message,
  validate,
  cancelMessage,
}: {
  message: string;
  /** An error to show for an invalid answer, or undefined when it is valid. */
  validate: (value: string) => string | undefined;
  cancelMessage: string;
}): Promise<string> {
  const ask = async (prompt: string) => {
    const answer = await password({ message: prompt, validate: (value) => validate(value ?? "") });
    if (isCancel(answer)) cancelled(cancelMessage);
    return answer;
  };
  for (;;) {
    const first = await ask(message);
    if ((await ask(`${message} again`)) === first) return first;
    log.error("The Passwords don't match. Try again.");
  }
}
