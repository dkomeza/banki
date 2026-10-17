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
      { category: ["logtape", "meta"], sinks: ["console"], lowestLevel: "warning" },
    ],
  });
}
