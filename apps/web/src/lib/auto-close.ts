import { AUTO_CLOSE_CHOICES, type AutoClose } from "@banki/shared";

// The auto-close Setting as Settings shows it: each choice's name, and what a
// change that didn't save says.

const NAMES = {
  off: "Off",
  brackets: "Brackets",
  "brackets-and-dollar": "Brackets and $",
} as const satisfies Record<AutoClose, string>;

/** Each choice, in order, with its name. */
export const AUTO_CLOSE_OPTIONS = AUTO_CLOSE_CHOICES.map((value) => ({
  value,
  label: NAMES[value],
}));

/** A choice's name, such as "Brackets and $". */
export const autoCloseName = (choice: AutoClose): string => NAMES[choice];

/** What a change to auto-close that didn't save says. */
export function autoCloseSaveErrorText(attempted: AutoClose, kept: AutoClose): string {
  return `The change to ${NAMES[attempted]} didn't save, so auto-close is still ${NAMES[kept]}.`;
}

/** The options a search for `query` finds: by name, ignoring case and spacing. */
export function matchAutoClose(query: string): typeof AUTO_CLOSE_OPTIONS {
  const wanted = query.trim().toLowerCase().replaceAll(/\s+/g, " ");
  if (wanted === "") return AUTO_CLOSE_OPTIONS;
  return AUTO_CLOSE_OPTIONS.filter((option) => option.label.toLowerCase().includes(wanted));
}
