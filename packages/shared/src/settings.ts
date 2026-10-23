import { z } from "zod";

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

/** The body of `GET /api/settings`, and of every change to it. `timezone` is null until stored. */
export const SettingsResponse = z.object({
  timezone: z.string().nullable(),
  dayStartHour: z.number().int(),
});
export type SettingsResponse = z.infer<typeof SettingsResponse>;

/** The body of `PATCH /api/settings`: any of the Settings, each changed as given. */
export const SettingsPatch = z.strictObject({
  timezone: Timezone.optional(),
  dayStartHour: DayStartHour.optional(),
});
export type SettingsPatch = z.input<typeof SettingsPatch>;

/** The body of `PUT /api/settings/timezone/initial`: this browser's zone, set only if none is stored. */
export const InitialTimezoneRequest = z.strictObject({ timezone: Timezone });
export type InitialTimezoneRequest = z.input<typeof InitialTimezoneRequest>;
