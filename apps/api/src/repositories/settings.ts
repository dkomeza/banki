import { DEFAULT_DAY_START_HOUR, type SettingsResponse } from "@banki/shared";
import { eq, isNull } from "drizzle-orm";
import type { Queryable } from "../db/database";
import { user_settings } from "../db/schema";

export type Settings = SettingsResponse;

/** What a User without a row of Settings has. */
const DEFAULTS: Settings = { timezone: null, dayStartHour: DEFAULT_DAY_START_HOUR };

export type SettingsRepository = ReturnType<typeof createSettingsRepository>;

export function createSettingsRepository(db: Queryable) {
  const get = (userId: string): Settings =>
    db
      .select({ timezone: user_settings.timezone, dayStartHour: user_settings.dayStartHour })
      .from(user_settings)
      .where(eq(user_settings.userId, userId))
      .get() ?? DEFAULTS;

  return {
    /** The User's Settings, or the defaults when none are stored. */
    get,

    /** Changes the Settings given, creating the User's row if need be, and returns them all. */
    update(userId: string, changes: Partial<Settings>): Settings {
      if (Object.keys(changes).length > 0) {
        db.insert(user_settings)
          .values({ userId, ...changes })
          .onConflictDoUpdate({ target: user_settings.userId, set: changes })
          .run();
      }
      return get(userId);
    },

    /**
     * Stores `timezone` only if the User has none yet, in one statement, so a
     * stored choice (or another device that got there first) is never
     * overwritten. Returns the Settings either way.
     */
    setInitialTimezone(userId: string, timezone: string): Settings {
      db.insert(user_settings)
        .values({ userId, timezone })
        .onConflictDoUpdate({
          target: user_settings.userId,
          set: { timezone },
          setWhere: isNull(user_settings.timezone),
        })
        .run();
      return get(userId);
    },
  };
}
