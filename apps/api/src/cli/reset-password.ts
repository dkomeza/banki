import { Password, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@banki/shared";
import { intro, outro } from "@clack/prompts";
import { hashPassword } from "better-auth/crypto";
import { defineCommand } from "citty";
import { createUserRepository } from "../repositories/user";
import {
  askPasswordTwice,
  CliExit,
  firstLineOfStdin,
  readConfig,
  runCommand,
  withDatabase,
} from "./common";

const INVALID_LENGTH = `The Password must be ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters.`;

const invalidPassword = (candidate: string) =>
  Password.safeParse(candidate).success ? undefined : INVALID_LENGTH;

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
  run: ({ args }) => runCommand(() => reset({ fromStdin: args["password-stdin"] === true })),
});

async function reset({ fromStdin }: { fromStdin: boolean }) {
  const config = readConfig();
  await withDatabase(config, async (db) => {
    const users = createUserRepository(db);
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
  });
}

async function passwordFromStdin(): Promise<string> {
  const line = await firstLineOfStdin();
  const invalid = invalidPassword(line);
  if (invalid !== undefined) throw new CliExit(invalid);
  return line;
}

/** Asks for the new Password twice with hidden input, until both match and its length is valid. */
const passwordFromPrompt = () =>
  askPasswordTwice({
    message: "New Password",
    validate: invalidPassword,
    cancelMessage: "Cancelled. The Password is unchanged.",
  });
