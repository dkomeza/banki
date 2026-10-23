import { InitialTimezoneRequest, SettingsPatch } from "@banki/shared";
import { Hono } from "hono";
import { validator } from "hono/validator";
import type { z } from "zod";
import { apiError } from "../http/errors";
import type { SignedInEnv } from "../http/require-signed-in";
import type { SettingsRepository } from "../repositories/settings";

/** A JSON body validator that answers 400 `invalid_request` when `schema` refuses it. */
const json = <T extends z.ZodType>(schema: T) =>
  validator("json", (value, c) => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) return c.json(apiError("invalid_request", "Invalid settings"), 400);
    return parsed.data;
  });

/**
 * The signed-in User's Settings. `GET /` reads them, `PATCH /` changes any of
 * them, and `PUT /timezone/initial` is the first fill: it stores this browser's
 * zone only while no Timezone is stored.
 */
export function settingsRoutes({ settings }: { settings: SettingsRepository }) {
  return new Hono<SignedInEnv>()
    .get("/", (c) => c.json(settings.get(c.var.user.id), 200))
    .patch("/", json(SettingsPatch), (c) =>
      c.json(settings.update(c.var.user.id, c.req.valid("json")), 200),
    )
    .put("/timezone/initial", json(InitialTimezoneRequest), (c) =>
      c.json(settings.setInitialTimezone(c.var.user.id, c.req.valid("json").timezone), 200),
    );
}
