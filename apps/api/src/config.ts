import { resolve } from "node:path";
import { z } from "zod";

/**
 * Everything the API reads from its environment, validated once at startup.
 *
 * This is the one place for settings that depend on where the API is served
 * from (ADR-0002): cookie security and better-auth's `baseURL` and
 * `trustedOrigins` all derive from `origin`, and nothing else may assume the
 * web app shares the API's origin.
 */
export type Config = {
  /** Absolute path of the data directory holding `banki.db` and `uploads/`. */
  dataDir: string;
  port: number;
  logFormat: "json" | "pretty";
  logLevel: "debug" | "info" | "warning" | "error";
  /** The origin the User opens Banki at, e.g. `https://banki.example.com`, with no trailing slash. */
  origin: string;
  /** Overrides the secret in `<dataDir>/auth-secret` when set. */
  authSecret: string | undefined;
};

/** Thrown by {@link parseConfig}; its message lists every invalid variable. */
export class ConfigError extends Error {
  override name = "ConfigError";
}

// An empty variable (`PORT=`) counts as unset, so it falls back to the default.
const unsetIfEmpty = (value: unknown) => (value === "" ? undefined : value);

/**
 * An `http:` or `https:` URL with nothing after the host and port but one
 * optional `/`, normalised to its origin (lowercased, default port dropped).
 */
const Origin = z.string().transform((value, ctx) => {
  const invalid = (message: string) => {
    ctx.addIssue({ code: "custom", message });
    return z.NEVER;
  };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return invalid("Expected a URL such as https://banki.example.com");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return invalid("Expected an http: or https: URL");
  }
  if (url.username !== "" || url.password !== "") {
    return invalid("Expected a URL without a username or password");
  }
  if (url.pathname !== "/" || value.includes("?") || value.includes("#")) {
    return invalid("Expected a URL with no path, query or hash, such as https://banki.example.com");
  }
  return url.origin;
});

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
  // The Vite dev server, which proxies /api to the API.
  ORIGIN: z.preprocess(unsetIfEmpty, Origin.default("http://localhost:5173")),
  AUTH_SECRET: z.preprocess(
    unsetIfEmpty,
    z.string().min(32, "Expected at least 32 characters").optional(),
  ),
});

/** Validates the API's environment, throwing a {@link ConfigError} when it is invalid. */
export function parseConfig(environment: Record<string, string | undefined>): Config {
  const result = env.safeParse(environment);
  if (!result.success) {
    throw new ConfigError(z.prettifyError(result.error));
  }
  const { DATA_DIR, PORT, LOG_FORMAT, LOG_LEVEL, ORIGIN, AUTH_SECRET } = result.data;
  return {
    dataDir: DATA_DIR,
    port: PORT,
    logFormat: LOG_FORMAT,
    logLevel: LOG_LEVEL,
    origin: ORIGIN,
    authSecret: AUTH_SECRET,
  };
}
