import type { MeResponse } from "@banki/shared";
import { Hono } from "hono";
import type { SignedInEnv } from "../http/require-signed-in";

/** `GET /`: the signed-in User. */
export function meRoutes() {
  return new Hono<SignedInEnv>().get("/", (c) =>
    c.json({ email: c.var.user.email } satisfies MeResponse, 200),
  );
}
