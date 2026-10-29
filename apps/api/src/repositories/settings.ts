import {
  type ApiKeyStatus,
  DEFAULT_DAY_START_HOUR,
  DEFAULT_DESIRED_RETENTION,
  type ModelId,
  type SettingsPatch,
  type SettingsResponse,
  effectiveAutoClose,
  effectiveModelId,
} from "@banki/shared";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { z } from "zod";
import type { ApiKeyCipher } from "../crypto/api-key-cipher";
import type { Queryable } from "../db/database";
import { card, deck, user_settings } from "../db/schema";
import { rescheduleCards, schedulingSettingsOf } from "./reviews";

export type Settings = SettingsResponse;

/** What the Grader runs on for a User: the decrypted API key, if a readable one is stored, and the Model. */
export type GraderSettings = { apiKey: string | undefined; model: ModelId };

export type SettingsRepository = ReturnType<typeof createSettingsRepository>;

type Row = Pick<
  typeof user_settings.$inferSelect,
  | "timezone"
  | "dayStartHour"
  | "model"
  | "apiKeyEncrypted"
  | "apiKeyLastFour"
  | "autoClose"
  | "desiredRetention"
>;

/** What a User without a row of Settings has. */
const DEFAULT_ROW: Row = {
  timezone: null,
  dayStartHour: DEFAULT_DAY_START_HOUR,
  model: null,
  apiKeyEncrypted: null,
  apiKeyLastFour: null,
  autoClose: null,
  desiredRetention: DEFAULT_DESIRED_RETENTION,
};

const rowOf = (db: Queryable, userId: string): Row =>
  db
    .select({
      timezone: user_settings.timezone,
      dayStartHour: user_settings.dayStartHour,
      model: user_settings.model,
      apiKeyEncrypted: user_settings.apiKeyEncrypted,
      apiKeyLastFour: user_settings.apiKeyLastFour,
      autoClose: user_settings.autoClose,
      desiredRetention: user_settings.desiredRetention,
    })
    .from(user_settings)
    .where(eq(user_settings.userId, userId))
    .get() ?? DEFAULT_ROW;

/**
 * Stores `timezone` only if the User has none yet, in one statement, so a
 * stored choice (or another device that got there first) is never
 * overwritten. Needs no encryption key, so the Seed data writes it directly.
 */
export function setInitialTimezone(db: Queryable, userId: string, timezone: string): void {
  db.insert(user_settings)
    .values({ userId, timezone })
    .onConflictDoUpdate({
      target: user_settings.userId,
      set: { timezone },
      setWhere: isNull(user_settings.timezone),
    })
    .run();
}

/**
 * The User's Settings. The API key is stored encrypted with `cipher` and
 * never leaves through {@link get}: the browser sees only whether it is set,
 * and its last four characters. Only {@link graderSettings}, which no route
 * calls, returns it decrypted.
 */
export function createSettingsRepository(db: Queryable, cipher: ApiKeyCipher) {
  const apiKeyOf = (row: Row, userId: string): string | undefined =>
    row.apiKeyEncrypted === null ? undefined : cipher.decrypt(row.apiKeyEncrypted, userId);

  const apiKeyStatus = (row: Row, userId: string): ApiKeyStatus => {
    if (row.apiKeyEncrypted === null) return { state: "unset" };
    // A key stored under an encryption key that was lost or changed.
    if (apiKeyOf(row, userId) === undefined) return { state: "unreadable" };
    return { state: "set", lastFour: row.apiKeyLastFour ?? "" };
  };

  const get = (userId: string): Settings => {
    const row = rowOf(db, userId);
    return {
      timezone: row.timezone,
      dayStartHour: row.dayStartHour,
      model: effectiveModelId(row.model),
      apiKey: apiKeyStatus(row, userId),
      autoClose: effectiveAutoClose(row.autoClose),
      desiredRetention: row.desiredRetention,
    };
  };

  const upsert = (userId: string, changes: Partial<typeof user_settings.$inferInsert>) =>
    db
      .insert(user_settings)
      .values({ userId, ...changes })
      .onConflictDoUpdate({ target: user_settings.userId, set: changes })
      .run();

  return {
    /** The User's Settings, with the defaults for whatever isn't stored. */
    get,

    /**
     * Changes the Settings given, creating the User's row if need be, and
     * returns them all. A new Desired retention reschedules, in the same
     * transaction, the Cards of every Deck that follows it, deleted ones too.
     */
    update(userId: string, changes: z.output<typeof SettingsPatch>, now = new Date()): Settings {
      return db.transaction(
        (tx) => {
          if (Object.keys(changes).length === 0) return get(userId);
          const { desiredRetention: before } = schedulingSettingsOf(tx, userId);
          tx.insert(user_settings)
            .values({ userId, ...changes })
            .onConflictDoUpdate({ target: user_settings.userId, set: changes })
            .run();
          const { desiredRetention } = changes;
          if (desiredRetention !== undefined && desiredRetention !== before) {
            const following = tx
              .select({ id: deck.id })
              .from(deck)
              .where(and(eq(deck.userId, userId), isNull(deck.desiredRetention)));
            const cards = tx
              .select({ id: card.id })
              .from(card)
              .where(and(eq(card.userId, userId), inArray(card.deckId, following)));
            rescheduleCards(tx, userId, cards, desiredRetention, now);
          }
          return get(userId);
        },
        { behavior: "immediate" },
      );
    },

    /** Stores the first fill's Timezone, as {@link setInitialTimezone} does, and returns the Settings. */
    setInitialTimezone(userId: string, timezone: string): Settings {
      setInitialTimezone(db, userId, timezone);
      return get(userId);
    },

    /** Stores `apiKey` encrypted, with a fresh nonce, beside its last four characters. */
    setApiKey(userId: string, apiKey: string): Settings {
      upsert(userId, {
        apiKeyEncrypted: cipher.encrypt(apiKey, userId),
        apiKeyLastFour: apiKey.slice(-4),
      });
      return get(userId);
    },

    /** Deletes the stored API key, if any. */
    removeApiKey(userId: string): Settings {
      db.update(user_settings)
        .set({ apiKeyEncrypted: null, apiKeyLastFour: null })
        .where(eq(user_settings.userId, userId))
        .run();
      return get(userId);
    },

    /**
     * Server-only, for the Grader: the User's decrypted API key (undefined
     * when none is stored or it can't be read) and their effective Model. No
     * route may return it.
     */
    graderSettings(userId: string): GraderSettings {
      const row = rowOf(db, userId);
      return { apiKey: apiKeyOf(row, userId), model: effectiveModelId(row.model) };
    },
  };
}
