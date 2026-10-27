import { getLogger } from "@logtape/logtape";
import { createApp } from "./app";
import { type Config, ConfigError, parseConfig } from "./config";
import { configureLogging, SETUP_ANNOUNCEMENT_CATEGORY } from "./logging";
import { startRemovalSweep } from "./removal-sweep";

// The API process: parse the environment, configure logging, boot the app,
// serve it, and shut down cleanly on SIGTERM/SIGINT. Startup failures exit 1.

function readConfig(): Config {
  try {
    return parseConfig(process.env);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    // Logging isn't configured yet, since its settings are part of what failed.
    console.error(`Invalid configuration:\n${error.message}`);
    return process.exit(1);
  }
}

const config = readConfig();
await configureLogging(config);
const logger = getLogger(["banki", "server"]);

function start() {
  let booted: ReturnType<typeof createApp> | undefined;
  try {
    logger.info("API starting {dataDir}", { dataDir: config.dataDir });
    booted = createApp(config);
    logger.info("Migrations applied {migrations}", { migrations: booted.appliedMigrations });
    if (booted.setupToken !== undefined) {
      const setupToken = booted.setupToken.value;
      getLogger(SETUP_ANNOUNCEMENT_CATEGORY).warning(
        "Banki isn't set up yet. To set it up, open {setupUrl}",
        {
          setupUrl: `${config.origin}/setup?token=${setupToken}`,
          setupToken,
        },
      );
    }
    const server = Bun.serve({ port: config.port, fetch: booted.app.fetch });
    logger.info("Listening {port}", { port: server.port });
    const app = booted;
    const stopSweep = startRemovalSweep(() => app.removeExpiredDeletions());
    return {
      server,
      close: () => {
        stopSweep();
        app.close();
      },
    };
  } catch (error) {
    logger.error("API failed to start", { error });
    booted?.close();
    return process.exit(1);
  }
}

const { server, close } = start();

let shuttingDown = false;
async function shutDown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("Shutting down {signal}", { signal });
  // Stops accepting connections, then resolves once in-flight requests finish.
  await server.stop();
  close();
  process.exit(0);
}

process.on("SIGTERM", (signal) => void shutDown(signal));
process.on("SIGINT", (signal) => void shutDown(signal));
