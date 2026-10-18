import { defineCommand, runMain } from "citty";
import { resetPassword } from "./cli/reset-password";

// The `banki` CLI: `bun run banki <command>` in apps/api, or
// `docker compose exec -it api bun run banki <command>` in Docker.

await runMain(
  defineCommand({
    meta: { name: "banki", description: "Manage a Banki installation" },
    subCommands: { "reset-password": resetPassword },
  }),
);
