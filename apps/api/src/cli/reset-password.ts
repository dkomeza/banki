import { text } from "node:stream/consumers";
import { Password, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@banki/shared";
import { cancel, intro, isCancel, log, outro, password } from "@clack/prompts";
import { hashPassword } from "better-auth/crypto";
import { defineCommand } from "citty";
import { type Config, ConfigError, parseConfig } from "../config";
import { openDatabase } from "../db/database";
import { applyMigrations } from "../db/migrate";
import { createUserRepository } from "../repositories/user";

/** Ends the command with `exitCode` after printing `message` to stderr. */
class CliExit extends Error {
  override name = "CliExit";
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
  }
}

const INVALID_LENGTH = `The Password must be ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters.`;

const isValidPassword = (candidate: string) => Password.safeParse(candidate).success;

/** One line of stdin, without its line ending. */
async function passwordFromStdin(): Promise<string> {
  const [line = ""] = (await text(process.stdin)).split(/\r?\n/, 1);
  if (!isValidPassword(line)) throw new CliExit(INVALID_LENGTH);
  return line;
}

/** Asks once with hidden input; cancelling (Ctrl-C) changes nothing and exits non-zero. */
async function ask(message: string): Promise<string> {
  const answer = await password({
    message,
    validate: (value) => (isValidPassword(value ?? "") ? undefined : INVALID_LENGTH),
  });
  if (isCancel(answer)) {
    cancel("Cancelled. The Password is unchanged.");
    throw new CliExit("", 130);
  }
  return answer;
}

/** Asks for the new Password twice with hidden input, until both match and its length is valid. */
async function passwordFromPrompt(): Promise<string> {
  for (;;) {
    const first = await ask("New Password");
    if ((await ask("New Password again")) === first) return first;
    log.error("The Passwords don't match. Try again.");
  }
}

function readConfig(): Config {
  try {
    return parseConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) throw new CliExit(`Invalid configuration:\n${error.message}`);
    throw error;
  }
}

export const resetPassword = defineCommand({
  meta: {
    name: "reset-password",
    description: "Set a new Password and sign out every device",
  },
  args: {
    "password-stdin": {
      type: "boolean",
      description: "Read the new Password from one line of stdin, without asking twice",
    },
  },
  async run({ args }) {
    try {
      await reset({ fromStdin: args["password-stdin"] === true });
    } catch (error) {
      if (!(error instanceof CliExit)) throw error;
      if (error.message !== "") console.error(error.message);
      process.exit(error.exitCode);
    }
  },
});

async function reset({ fromStdin }: { fromStdin: boolean }) {
  const config = readConfig();
  // The same data directory, database and migrations as the API, which may be running.
  const database = openDatabase(config.dataDir);
  try {
    applyMigrations(database.db);
    const users = createUserRepository(database.db);
    const user = users.find();
    if (user === undefined) {
      throw new CliExit(
        `Banki isn't set up yet, so there is no Password to reset. Finish Setup at ${config.origin}/setup`,
      );
    }

    if (fromStdin) console.log(`Resetting the Password for ${user.email}`);
    else intro(`Resetting the Password for ${user.email}`);

    const newPassword = fromStdin ? await passwordFromStdin() : await passwordFromPrompt();
    users.setPasswordAndSignOutEverywhere(user.id, await hashPassword(newPassword));

    const done = `Password changed for ${user.email}. Every device is signed out.`;
    if (fromStdin) console.log(done);
    else outro(done);
  } finally {
    database.close();
  }
}
