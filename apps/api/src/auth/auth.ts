import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@banki/shared";
import { getLogger } from "@logtape/logtape";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Config } from "../config";
import type { Database } from "../db/database";
import * as schema from "../db/schema";

const DAY_SECONDS = 24 * 60 * 60;

/** Sign-in attempts allowed per client IP per window. Setup gets the same limit. */
export const SIGN_IN_RATE_LIMIT = { max: 5, windowSeconds: 60 } as const;

const authLogger = getLogger(["banki", "auth"]);

// LogTape reads `{name}` in a message as a placeholder, so literal braces in
// better-auth's messages are escaped.
const escapeBraces = (message: string) => message.replaceAll("{", "{{").replaceAll("}", "}}");

/** Sends better-auth's own log lines to LogTape, which filters them by `LOG_LEVEL`. */
const logger: BetterAuthOptions["logger"] = {
  level: "debug",
  log: (level, message, ...args: unknown[]) => {
    const properties = args.length > 0 ? { args } : {};
    const text = escapeBraces(message);
    if (level === "debug") authLogger.debug(text, properties);
    else if (level === "info") authLogger.info(text, properties);
    else if (level === "warn") authLogger.warning(text, properties);
    else authLogger.error(text, properties);
  },
};

/**
 * better-auth's options for Banki. Every setting that better-auth would
 * otherwise derive from `NODE_ENV` (secure cookies, rate limiting, the secret,
 * the origin check) is set explicitly from `Config`.
 */
export function authOptions({
  db,
  config,
  secret,
}: {
  db: Database;
  config: Pick<Config, "origin">;
  secret: string;
}) {
  return {
    appName: "Banki",
    baseURL: config.origin,
    basePath: "/api/auth",
    trustedOrigins: [config.origin],
    secret,
    database: drizzleAdapter(db, { provider: "sqlite", schema }),
    user: { modelName: "user" },
    session: {
      modelName: "auth_session",
      expiresIn: 30 * DAY_SECONDS,
      // Sliding: using Banki moves the expiry forward, at most once a day.
      updateAge: DAY_SECONDS,
      // Off, so deleting an auth session signs that device out straight away (ADR-0005).
      cookieCache: { enabled: false },
    },
    account: { modelName: "auth_account" },
    verification: { modelName: "auth_verification" },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
    },
    rateLimit: {
      enabled: true,
      storage: "memory",
      customRules: {
        "/sign-in/email": {
          max: SIGN_IN_RATE_LIMIT.max,
          window: SIGN_IN_RATE_LIMIT.windowSeconds,
        },
      },
    },
    advanced: {
      useSecureCookies: new URL(config.origin).protocol === "https:",
      disableCSRFCheck: false,
      disableOriginCheck: false,
      // Caddy sends a single-value X-Forwarded-For with the client's IP, and
      // only Caddy can reach the API. Without the header (a request straight
      // to the API) every such client shares one rate-limit bucket.
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
    },
    logger,
    telemetry: { enabled: false },
  } satisfies BetterAuthOptions;
}

export function createAuth(options: Parameters<typeof authOptions>[0]) {
  return betterAuth(authOptions(options));
}

export type Auth = ReturnType<typeof createAuth>;
