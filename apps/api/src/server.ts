import { getLogger } from "@logtape/logtape";
import { createApp } from "./app";
import { type Config, ConfigError, parseConfig } from "./config";
import { configureLogging } from "./logging";

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
    const server = Bun.serve({ port: config.port, fetch: booted.app.fetch });
    logger.info("Listening {port}", { port: server.port });
    return { server, close: booted.close };
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
