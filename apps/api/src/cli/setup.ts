import { Email, Password } from "@banki/shared";
import { intro, isCancel, outro, text } from "@clack/prompts";
import { defineCommand } from "citty";
import type { z } from "zod";
import { setUpUser } from "../auth/set-up-user";
import { createUserRepository } from "../repositories/user";
import {
  askPasswordTwice,
  CliExit,
  cancelled,
  firstLineOfStdin,
  readConfig,
  runCommand,
  withDatabase,
} from "./common";

const ALREADY_SET_UP = "Banki is already set up, nothing changed.";
const CANCELLED = "Cancelled. Nothing changed.";

/** The schema's message for an invalid `value`, or undefined when it is valid. */
const schemaError = (schema: z.ZodType, value: string) =>
  schema.safeParse(value).error?.issues[0]?.message;

/** `value` parsed by `schema`, or the command ends with the schema's message. */
function parseOrExit<T>(schema: z.ZodType<T, string>, value: string, name: string): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new CliExit(`Invalid ${name}: ${parsed.error.issues[0]?.message ?? "invalid"}`);
}

async function askEmail(): Promise<string> {
  const answer = await text({
    message: "Email",
    validate: (value) => schemaError(Email, value ?? ""),
  });
  if (isCancel(answer)) cancelled(CANCELLED);
  return Email.parse(answer);
}

export const setup = defineCommand({
  meta: {
    name: "setup",
    description: "Do Setup from a shell: create the User with their Email and Password",
  },
  args: {
    email: {
      type: "string",
      description: "The Email to sign in with, instead of asking for it",
    },
    "password-stdin": {
      type: "boolean",
      description: "Read the Password from one line of stdin, without asking (needs --email)",
    },
  },
  run: ({ args }) =>
    runCommand(() => setUp({ email: args.email, fromStdin: args["password-stdin"] === true })),
});

async function setUp({ email: emailArg, fromStdin }: { email?: string; fromStdin: boolean }) {
  // Everything given up front is checked before the data directory is touched.
  if (fromStdin && emailArg === undefined) throw new CliExit("--password-stdin needs --email.");
  const givenEmail = emailArg === undefined ? undefined : parseOrExit(Email, emailArg, "Email");
  const config = readConfig();
  const givenPassword = fromStdin
    ? parseOrExit(Password, await firstLineOfStdin(), "Password")
    : undefined;

  await withDatabase(config, async (db) => {
    const users = createUserRepository(db);
    // Before asking anything, so nobody types a Password for nothing.
    if (users.exists()) throw new CliExit(ALREADY_SET_UP);

    if (!fromStdin) intro("Setting up Banki");
    const email = givenEmail ?? (await askEmail());
    const password =
      givenPassword ??
      (await askPasswordTwice({
        message: "Password",
        validate: (value) => schemaError(Password, value),
        cancelMessage: CANCELLED,
      }));

    // The final word: another Setup may have won while this one was asking.
    if ((await setUpUser(users, { email, password })) === "already_set_up") {
      throw new CliExit(ALREADY_SET_UP);
    }

    const done = `Banki is set up for ${email}. Sign in at ${config.origin}`;
    if (fromStdin) console.log(done);
    else outro(done);
  });
}
