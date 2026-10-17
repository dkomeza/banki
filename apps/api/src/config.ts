import { resolve } from "node:path";
import { z } from "zod";

/**
 * Everything the API reads from its environment, validated once at startup.
 *
 * This is the one place for settings that depend on where the API is served
 * from. The origin-dependent ones (cookies, CORS, better-auth `trustedOrigins`)
 * join it in BAN-7; nothing else may assume the web app shares the API's origin.
 */
export type Config = {
  /** Absolute path of the data directory holding `banki.db` and `uploads/`. */
  dataDir: string;
  port: number;
  logFormat: "json" | "pretty";
  logLevel: "debug" | "info" | "warning" | "error";
};

/** Thrown by {@link parseConfig}; its message lists every invalid variable. */
export class ConfigError extends Error {
  override name = "ConfigError";
}

// An empty variable (`PORT=`) counts as unset, so it falls back to the default.
const unsetIfEmpty = (value: unknown) => (value === "" ? undefined : value);

const env = z.object({
  DATA_DIR: z.preprocess(
    unsetIfEmpty,
    z
      .string()
      .default("/data")
      .transform((dir) => resolve(dir)),
  ),
  PORT: z.preprocess(
    unsetIfEmpty,
    z
      .string()
      .regex(/^\d+$/, "Expected a whole number")
      .default("3000")
      .transform(Number)
      .pipe(z.number().int().min(1).max(65535)),
  ),
  LOG_FORMAT: z.preprocess(unsetIfEmpty, z.enum(["json", "pretty"]).default("json")),
  LOG_LEVEL: z.preprocess(
    unsetIfEmpty,
    z.enum(["debug", "info", "warning", "error"]).default("info"),
  ),
});

/** Validates the API's environment, throwing a {@link ConfigError} when it is invalid. */
export function parseConfig(environment: Record<string, string | undefined>): Config {
  const result = env.safeParse(environment);
  if (!result.success) {
    throw new ConfigError(z.prettifyError(result.error));
  }
  const { DATA_DIR, PORT, LOG_FORMAT, LOG_LEVEL } = result.data;
  return { dataDir: DATA_DIR, port: PORT, logFormat: LOG_FORMAT, logLevel: LOG_LEVEL };
}
