import { z } from "zod";
import { Macro, MacroList } from "./macros";
import { ModelId } from "./models";
import { DesiredRetention } from "./scheduling";
import { LearningLimit, NewCardBatch } from "./study";

/** The Day start a User has until they change it: 4:00 a.m. */
export const DEFAULT_DAY_START_HOUR = 4;

/**
 * Whether `name` is an IANA timezone name `Intl.DateTimeFormat` accepts,
 * aliases such as `Europe/Kiev` included. UTC offsets such as `+02:00`, which
 * Intl also accepts, aren't names, so they aren't Timezones.
 */
export function isTimezone(name: string): boolean {
  if (name === "" || /^[+-]/.test(name)) return false;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: name }).resolvedOptions().timeZone !== "";
  } catch {
    return false;
  }
}

/** The Timezone Banki counts the User's days in: an IANA name. */
export const Timezone = z.string().refine(isTimezone, "Expected an IANA timezone name");

/** The hour, 0 to 23, at which one Study day ends and the next begins. */
export const DayStartHour = z
  .number()
  .int("Expected a whole hour")
  .min(0, "Expected an hour from 0 to 23")
  .max(23, "Expected an hour from 0 to 23");

/**
 * Auto-close, how the editor closes what is typed: `off`, `brackets` (`{`,
 * `(` and `[`), or `brackets-and-dollar` (and `$`, for Formulas).
 */
export const AUTO_CLOSE_CHOICES = ["off", "brackets", "brackets-and-dollar"] as const;
export const AutoClose = z.enum(AUTO_CLOSE_CHOICES);
export type AutoClose = z.infer<typeof AutoClose>;

/** The auto-close a User has until they change it. */
export const DEFAULT_AUTO_CLOSE: AutoClose = "brackets";

/** The auto-close `stored` stands for: the default when none is stored, or one Banki no longer knows. */
export const effectiveAutoClose = (stored: string | null): AutoClose =>
  AutoClose.safeParse(stored).data ?? DEFAULT_AUTO_CLOSE;

/** The longest API key accepted, after trimming. */
export const API_KEY_MAX_LENGTH = 200;

/**
 * The User's OpenRouter API key as the browser sees it: never the key itself,
 * only whether one is stored, and its last four characters when it is.
 * `unreadable` is a key stored under an encryption key Banki no longer has.
 */
export const ApiKeyStatus = z.discriminatedUnion("state", [
  z.object({ state: z.literal("set"), lastFour: z.string() }),
  z.object({ state: z.literal("unreadable") }),
  z.object({ state: z.literal("unset") }),
]);
export type ApiKeyStatus = z.infer<typeof ApiKeyStatus>;

/**
 * The body of `GET /api/settings`, and of every change to it. `timezone` is
 * null until stored; `model` is the effective Model, and `autoClose` the
 * effective auto-close, each the default when none is stored. `desiredRetention`
 * is the one every Deck follows until it has its own. `newCardBatch` and
 * `learningLimit` pace a Session's New cards (CONTEXT.md: New-card batch,
 * Learning limit). `macros` are Settings' Macros, [] for none, which every
 * Deck's Cards use under its own.
 */
export const SettingsResponse = z.object({
  timezone: z.string().nullable(),
  dayStartHour: z.number().int(),
  model: z.string(),
  apiKey: ApiKeyStatus,
  autoClose: AutoClose,
  desiredRetention: z.number().int(),
  newCardBatch: z.number().int(),
  learningLimit: z.number().int(),
  macros: z.array(Macro),
});
export type SettingsResponse = z.infer<typeof SettingsResponse>;

/**
 * The body of `PATCH /api/settings`: any of the Settings, each changed as given.
 * A new Desired retention reschedules the Cards of every Deck that follows it.
 * `macros` replaces Settings' Macros with the whole list given.
 */
export const SettingsPatch = z.strictObject({
  timezone: Timezone.optional(),
  dayStartHour: DayStartHour.optional(),
  model: ModelId.optional(),
  autoClose: AutoClose.optional(),
  desiredRetention: DesiredRetention.optional(),
  newCardBatch: NewCardBatch.optional(),
  learningLimit: LearningLimit.optional(),
  macros: MacroList.optional(),
});
export type SettingsPatch = z.input<typeof SettingsPatch>;

/** The body of `PUT /api/settings/timezone/initial`: this browser's zone, set only if none is stored. */
export const InitialTimezoneRequest = z.strictObject({ timezone: Timezone });
export type InitialTimezoneRequest = z.input<typeof InitialTimezoneRequest>;

/** The body of `PUT /api/settings/api-key`: a new OpenRouter API key, trimmed, 1 to 200 characters. */
export const ApiKeyRequest = z.strictObject({
  apiKey: z.string().trim().min(1, "Enter the API key").max(API_KEY_MAX_LENGTH),
});
export type ApiKeyRequest = z.input<typeof ApiKeyRequest>;
