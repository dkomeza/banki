import { SetupRequest, type SetupStatus } from "@banki/shared";
import { getLogger } from "@logtape/logtape";
import { Hono } from "hono";
import { validator } from "hono/validator";
import type { Auth } from "../auth/auth";
import type { SetupToken } from "../auth/setup-token";
import { clientIp } from "../http/client-ip";
import { apiError } from "../http/errors";
import type { RateLimiter } from "../http/rate-limit";
import type { UserRepository } from "../repositories/user";

const logger = getLogger(["banki", "setup"]);

const alreadySetUp = apiError("already_set_up", "Banki is already set up. Sign in instead.");

/**
 * `GET /` says whether Setup is done. `POST /` does Setup: it checks the
 * Setup token, creates the User with their Email and Password, and signs them
 * in. `setupToken` is undefined when the User already existed at startup.
 */
export function setupRoutes({
  auth,
  users,
  setupToken,
  limiter,
}: {
  auth: Auth;
  users: UserRepository;
  setupToken: SetupToken | undefined;
  limiter: RateLimiter;
}) {
  return new Hono()
    .get("/", (c) => c.json({ setUp: users.exists() } satisfies SetupStatus, 200))
    .post(
      "/",
      async (c, next) => {
        const decision = limiter.consume(clientIp(c) ?? "unknown");
        if (decision.allowed) return next();
        logger.warning("Setup rate limited for {ip}", { ip: clientIp(c) ?? "unknown" });
        c.header("Retry-After", String(decision.retryAfterSeconds));
        return c.json(apiError("rate_limited", "Too many attempts. Try again later."), 429);
      },
      validator("json", (value, c) => {
        const parsed = SetupRequest.safeParse(value);
        if (!parsed.success) {
          return c.json(apiError("invalid_request", "Invalid email, password or token"), 400);
        }
        return parsed.data;
      }),
      async (c) => {
        if (users.exists()) return c.json(alreadySetUp, 409);

        const { token, email, password } = c.req.valid("json");
        if (setupToken === undefined || !setupToken.matches(token)) {
          logger.warning("Wrong Setup token from {ip}", { ip: clientIp(c) ?? "unknown" });
          return c.json(apiError("invalid_setup_token", "The Setup token is wrong"), 403);
        }

        const context = await auth.$context;
        const userId = context.generateId({ model: "user" });
        const accountId = context.generateId({ model: "account" });
        if (userId === false || accountId === false) throw new Error("better-auth generated no id");
        const created = users.createWithPassword({
          userId,
          accountId,
          email,
          passwordHash: await context.password.hash(password),
        });
        if (created === "already_set_up") return c.json(alreadySetUp, 409);
        setupToken.discard();
        logger.info("Setup done");

        // Signing in the usual way sets the same cookie a sign-in would.
        const { headers } = await auth.api.signInEmail({
          body: { email, password },
          headers: c.req.raw.headers,
          returnHeaders: true,
        });
        for (const cookie of headers.getSetCookie())
          c.header("set-cookie", cookie, { append: true });
        return c.body(null, 204);
      },
    );
}
