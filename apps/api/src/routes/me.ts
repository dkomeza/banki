import { ChangeEmailRequest, type MeResponse } from "@banki/shared";
import { getLogger } from "@logtape/logtape";
import { verifyPassword } from "better-auth/crypto";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { clientIp } from "../http/client-ip";
import { apiError } from "../http/errors";
import type { RateLimiter } from "../http/rate-limit";
import type { SignedInEnv } from "../http/require-signed-in";
import type { UserRepository } from "../repositories/user";

const logger = getLogger(["banki", "auth"]);

/**
 * `GET /`: the signed-in User. `POST /email` changes their Email, given their
 * Password. It is Banki's own rather than better-auth's `/change-email`, which
 * refuses a verified User unless Banki sends a confirmation email, and Banki
 * never sends mail (ADR-0006). Attempts are limited per client IP by `limiter`.
 */
export function meRoutes({ users, limiter }: { users: UserRepository; limiter: RateLimiter }) {
  return new Hono<SignedInEnv>()
    .get("/", (c) => c.json({ email: c.var.user.email } satisfies MeResponse, 200))
    .post(
      "/email",
      async (c, next) => {
        const ip = clientIp(c) ?? "unknown";
        const decision = limiter.consume(ip);
        if (!decision.allowed) {
          logger.warning("Email change rate limited for {ip}", { ip });
          c.header("Retry-After", String(decision.retryAfterSeconds));
          return c.json(apiError("rate_limited", "Too many attempts. Try again later."), 429);
        }
        await next();
        if (!c.res.ok) {
          logger.warning("Failed Email change from {ip} ({status})", { ip, status: c.res.status });
        }
        return c.res;
      },
      validator("json", (value, c) => {
        const parsed = ChangeEmailRequest.safeParse(value);
        if (!parsed.success) {
          return parsed.error.issues.some((issue) => issue.path[0] === "email")
            ? c.json(apiError("invalid_email", "Expected an email address"), 400)
            : c.json(apiError("invalid_request", "Invalid request"), 400);
        }
        return parsed.data;
      }),
      async (c) => {
        const { email, password } = c.req.valid("json");
        const { id, email: current } = c.var.user;
        if (email === current) {
          return c.json(apiError("same_email", "That's already your Email"), 409);
        }

        const hash = users.passwordHash(id);
        if (hash === undefined || !(await verifyPassword({ hash, password }))) {
          return c.json(apiError("wrong_password", "That Password isn't right"), 403);
        }

        if (users.changeEmail(id, email) === "taken") {
          return c.json(apiError("email_taken", "That Email belongs to someone else"), 409);
        }
        logger.info("Email changed");
        return c.json({ email } satisfies MeResponse, 200);
      },
    );
}
