import { afterEach, beforeEach } from "bun:test";
import { configure, type LogRecord, reset } from "@logtape/logtape";

/**
 * Routes every `banki` log record into an array for the tests in the calling
 * file, instead of the console, so tests can assert on logs without printing.
 */
export function captureLogs(): LogRecord[] {
  const records: LogRecord[] = [];

  beforeEach(async () => {
    records.length = 0;
    await configure({
      reset: true,
      sinks: { capture: (record) => records.push(record) },
      loggers: [
        { category: ["banki"], sinks: ["capture"], lowestLevel: "debug" },
        { category: ["logtape", "meta"], sinks: [], lowestLevel: "warning" },
      ],
    });
  });

  afterEach(async () => {
    await reset();
  });

  return records;
}
