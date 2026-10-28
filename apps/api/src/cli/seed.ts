import { defineCommand } from "citty";
import { uploadsDirOf } from "../db/database";
import { createUserRepository } from "../repositories/user";
import { userHasContent, writeSeedData } from "../seed/seed-data";
import { CliExit, readConfig, runCommand, withDatabase } from "./common";

export const seed = defineCommand({
  meta: {
    name: "seed",
    description: "Load the Seed data into an installation that is set up and has no content",
  },
  run: () => runCommand(loadSeedData),
});

/**
 * The time the Seed data is written relative to: now, or `BANKI_SEED_NOW` (an
 * ISO 8601 time) when set, as the `ui` script's stacks set it so their shots
 * show the same times on every run.
 */
function seedNow(env: NodeJS.ProcessEnv): Date {
  const fixed = env["BANKI_SEED_NOW"];
  if (fixed === undefined || fixed === "") return new Date();
  const now = new Date(fixed);
  if (Number.isNaN(now.getTime())) {
    throw new CliExit(`BANKI_SEED_NOW isn't a time: ${fixed}`);
  }
  return now;
}

async function loadSeedData() {
  const config = readConfig();
  const now = seedNow(process.env);
  await withDatabase(config, (db) => {
    // The checks and the writes are all or nothing: a CliExit rolls back.
    db.transaction(
      (tx) => {
        const user = createUserRepository(tx).find();
        if (user === undefined) {
          throw new CliExit(
            "Banki isn't set up yet, so there's nothing to seed. Run banki setup first.",
          );
        }
        if (userHasContent(tx, user.id)) {
          throw new CliExit("The User already has content, so nothing was seeded.");
        }
        writeSeedData({ db: tx, userId: user.id, now, uploadsDir: uploadsDirOf(config.dataDir) });
      },
      { behavior: "immediate" },
    );
  });
  console.log("Seed data loaded.");
}
