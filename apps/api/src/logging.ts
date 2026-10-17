import {
  configure,
  getConsoleSink,
  jsonLinesFormatter,
  type TextFormatter,
} from "@logtape/logtape";
import { getPrettyFormatter } from "@logtape/pretty";
import type { Config } from "./config";

// Pretty output is for reading in a terminal: the message alone, except that a
// record carrying an error also shows its properties, so the error is visible.
const prettyMessage = getPrettyFormatter();
const prettyWithProperties = getPrettyFormatter({ properties: true });
const prettyFormatter: TextFormatter = (record) =>
  "error" in record.properties ? prettyWithProperties(record) : prettyMessage(record);

/**
 * The Setup announcement's category. It is printed whatever `LOG_LEVEL` is,
 * since the Setup token is the only way to set Banki up.
 */
export const SETUP_ANNOUNCEMENT_CATEGORY = ["banki", "setup", "announcement"];

/**
 * Sends the API's log records to the console, as JSON lines or pretty text.
 * Only the server entry calls this, so tests stay silent.
 */
export async function configureLogging({ logFormat, logLevel }: Config): Promise<void> {
  await configure({
    sinks: {
      console: getConsoleSink({
        formatter: logFormat === "pretty" ? prettyFormatter : jsonLinesFormatter,
      }),
    },
    loggers: [
      { category: ["banki"], sinks: ["console"], lowestLevel: logLevel },
      // Its own sink, not its parents', which would drop it below LOG_LEVEL
      // or, above it, print it a second time.
      {
        category: SETUP_ANNOUNCEMENT_CATEGORY,
        sinks: ["console"],
        parentSinks: "override",
        lowestLevel: "debug",
      },
      { category: ["logtape", "meta"], sinks: ["console"], lowestLevel: "warning" },
    ],
  });
}
