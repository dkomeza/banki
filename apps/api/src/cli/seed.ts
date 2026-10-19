import { defineCommand } from "citty";
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

async function loadSeedData() {
  const config = readConfig();
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
        writeSeedData({ db: tx, userId: user.id, now: new Date() });
      },
      { behavior: "immediate" },
    );
  });
  console.log("Seed data loaded.");
}
