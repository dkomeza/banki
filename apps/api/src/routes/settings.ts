import { ApiKeyRequest, InitialTimezoneRequest, SettingsPatch } from "@banki/shared";
import { getLogger } from "@logtape/logtape";
import { Hono } from "hono";
import { apiError } from "../http/errors";
import type { SignedInEnv } from "../http/require-signed-in";
import { type OpenRouterFetch, checkApiKey } from "../openrouter/check-api-key";
import type { SettingsRepository } from "../repositories/settings";
import { json } from "./json";

const logger = getLogger(["banki", "settings"]);

/**
 * The signed-in User's Settings. `GET /` reads them, `PATCH /` changes any of
 * them, and `PUT /timezone/initial` is the first fill: it stores this browser's
 * zone only while no Timezone is stored. `PUT /api-key` stores a new API key
 * once OpenRouter accepts it, and `DELETE /api-key` removes it. Every answer
 * is the Settings, which never hold the API key itself.
 */
export function settingsRoutes({
  settings,
  openRouterFetch,
}: {
  settings: SettingsRepository;
  openRouterFetch: OpenRouterFetch;
}) {
  return new Hono<SignedInEnv>()
    .get("/", (c) => c.json(settings.get(c.var.user.id), 200))
    .patch("/", json(SettingsPatch, "Invalid settings"), (c) =>
      c.json(settings.update(c.var.user.id, c.req.valid("json")), 200),
    )
    .put("/timezone/initial", json(InitialTimezoneRequest, "Invalid settings"), (c) =>
      c.json(settings.setInitialTimezone(c.var.user.id, c.req.valid("json").timezone), 200),
    )
    .put("/api-key", json(ApiKeyRequest, "Invalid settings"), async (c) => {
      const { apiKey } = c.req.valid("json");
      const check = await checkApiKey(apiKey, { fetch: openRouterFetch });
      if (check === "refused") {
        return c.json(apiError("api_key_refused", "OpenRouter didn't accept this key."), 422);
      }
      if (check === "unreachable") {
        return c.json(
          apiError("openrouter_unreachable", "Couldn't reach OpenRouter. Try again."),
          502,
        );
      }
      logger.info("API key stored");
      return c.json(settings.setApiKey(c.var.user.id, apiKey), 200);
    })
    .delete("/api-key", (c) => {
      logger.info("API key removed");
      return c.json(settings.removeApiKey(c.var.user.id), 200);
    });
}
