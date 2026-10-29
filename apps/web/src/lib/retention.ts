import {
  DEFAULT_DESIRED_RETENTION,
  DESIRED_RETENTION_MAX,
  DESIRED_RETENTION_MIN,
} from "@banki/shared";

// Desired retention as Settings and a Deck's settings show it: the pickers'
// options and search, and what a change that didn't save says.

/** A picker's choice, as the settings Combobox takes it. */
export type RetentionOption = { value: string; label: string; display?: string; detail?: string };

/** The whole percents 70–97, 90 marked as the default. */
export const PERCENT_OPTIONS: readonly RetentionOption[] = Array.from(
  { length: DESIRED_RETENTION_MAX - DESIRED_RETENTION_MIN + 1 },
  (_, i) => {
    const value = DESIRED_RETENTION_MIN + i;
    return {
      value: String(value),
      label: `${value}%`,
      ...(value === DEFAULT_DESIRED_RETENTION ? { detail: "default" } : {}),
    };
  },
);

/** The percents a search finds: by number ("8" finds 80–89), or "default". */
export function matchPercents(
  options: readonly RetentionOption[],
  query: string,
): readonly RetentionOption[] {
  const wanted = query.trim().toLowerCase().replace("%", "");
  if (wanted === "") return options;
  return options.filter(
    (option) =>
      option.value.startsWith(wanted) || (option.detail?.toLowerCase().includes(wanted) ?? false),
  );
}

/** A Deck picker's value for following Settings. */
export const FOLLOW = "follow";

/** A Deck's choices: Follow Settings (showing their value) first, then the percents. */
export const deckOptions = (global: number): readonly RetentionOption[] => [
  {
    value: FOLLOW,
    label: "Follow Settings",
    display: `Follow Settings (${global}%)`,
    detail: `${global}%`,
  },
  // The Deck's default is to follow, so no percent is marked as one.
  ...PERCENT_OPTIONS.map(({ value, label }) => ({ value, label })),
];

/** What a search of a Deck's choices finds: Follow Settings for "follow" or "global", then percents. */
export function matchDeckOptions(
  options: readonly RetentionOption[],
  query: string,
): readonly RetentionOption[] {
  const [follow, ...percents] = options;
  const wanted = query.trim().toLowerCase();
  const follows =
    follow !== undefined &&
    (wanted === "" || "follow settings".includes(wanted) || "global".includes(wanted));
  return [...(follows ? [follow] : []), ...matchPercents(percents, query)];
}

/** What a change to the Desired retention in Settings that didn't save says. */
export const globalRetentionErrorText = (attempted: number, kept: number): string =>
  `The change to ${attempted}% didn't save, so it's still ${kept}%.`;

/**
 * What a change to a Deck's Desired retention that didn't save says: the
 * change (a percent, or following Settings), and what the Deck keeps.
 */
export function deckRetentionErrorText(
  attempted: number | null,
  kept: number | null,
  global: number,
): string {
  const tried = attempted === null ? "following Settings" : `${attempted}%`;
  const still = kept === null ? `it still follows Settings (${global}%)` : `it's still ${kept}%`;
  return `The change to ${tried} didn't save, so ${still}.`;
}

/** What the deck page says of a Deck's Desired retention. */
export const deckRetentionLabel = (own: number | null, global: number): string =>
  own === null ? `${global}% retention, from Settings` : `its own ${own}% retention`;
