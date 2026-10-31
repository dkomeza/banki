import { z } from "zod";
import { Macro, MacroList } from "./macros";
import { DesiredRetention } from "./scheduling";

/** The longest Deck name, after trimming. */
export const DECK_NAME_MAX_LENGTH = 100;

/** The longest Deck description, after trimming. */
export const DECK_DESCRIPTION_MAX_LENGTH = 1000;

/** A Deck's name: trimmed, 1 to 100 characters. */
export const DeckName = z
  .string()
  .trim()
  .min(1, "Give the deck a name")
  .max(DECK_NAME_MAX_LENGTH, `Keep the name to ${DECK_NAME_MAX_LENGTH} characters`);

/**
 * A Deck's description: plain text, trimmed, up to 1,000 characters, with its
 * line breaks kept. Empty, or null, means none.
 */
export const DeckDescription = z
  .string()
  .trim()
  .max(
    DECK_DESCRIPTION_MAX_LENGTH,
    `Keep the description to ${DECK_DESCRIPTION_MAX_LENGTH} characters`,
  )
  .nullable()
  .transform((description) => (description === "" ? null : description));

/**
 * The key two Deck names are compared by: the same key means the same name,
 * ignoring case. Expects a name already trimmed. Upper case first, then lower,
 * so letters with more than one lower or upper form compare alike: "ß" and "SS",
 * a word-final "ς" and "σ". Folder names are compared by it too.
 */
export const deckNameKey = (name: string) => name.normalize("NFC").toUpperCase().toLowerCase();

/**
 * The name Keep both gives an item moved in beside another of its name: the
 * first of "Name (2)", "Name (3)", … that `taken` doesn't refuse, with the name
 * cut short (and trimmed) where needed so the whole stays within 100
 * characters. A cut never splits a character in two.
 */
export function nextFreeName(name: string, taken: (candidate: string) => boolean): string {
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    let base = name.slice(0, DECK_NAME_MAX_LENGTH - suffix.length);
    if (/[\uD800-\uDBFF]$/.test(base)) base = base.slice(0, -1);
    const candidate = `${base.trimEnd()}${suffix}`;
    if (!taken(candidate)) return candidate;
  }
}

/**
 * What a move does when something of the same kind beside the destination
 * already has the name: `replace` deletes that one first, `keepBoth` moves in
 * under the next free "Name (n)".
 */
export const OnClash = z.enum(["replace", "keepBoth"]);
export type OnClash = z.infer<typeof OnClash>;

/** Where something sits: a Folder's ID, or null for the Root. */
export const PlaceId = z.string().min(1).nullable();

/**
 * The body of a 409 `name_clash`: a move found something of the same kind and
 * name beside the destination. `replaceAllowed` is false when that something
 * is a Folder holding the moved item.
 */
export const NameClashError = z.object({
  error: z.object({ code: z.literal("name_clash"), message: z.string() }),
  clash: z.object({ id: z.string(), name: z.string(), replaceAllowed: z.boolean() }),
});
export type NameClashError = z.infer<typeof NameClashError>;

/**
 * A Deck as the API answers it. `folderId` is the Folder it sits in, null at
 * the Root. `createdAt` is an ISO 8601 time. `cardCount` counts its live Cards.
 * `desiredRetention` is its own, or null while it follows Settings. `macros`
 * are its own Macros, [] for none, which its Cards use on top of Settings'.
 */
export const DeckResponse = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  folderId: z.string().nullable(),
  createdAt: z.iso.datetime(),
  cardCount: z.number().int().nonnegative(),
  desiredRetention: z.number().int().nullable(),
  macros: z.array(Macro),
});
export type DeckResponse = z.infer<typeof DeckResponse>;

/** The body of `GET /api/decks`: the User's Decks that aren't deleted, in no set order. */
export const DeckListResponse = z.array(DeckResponse);
export type DeckListResponse = z.infer<typeof DeckListResponse>;

/**
 * The body of `POST /api/decks`: a name, an optional description, and the
 * Folder to create it in (the Root when missing or null).
 */
export const CreateDeckRequest = z.strictObject({
  name: DeckName,
  description: DeckDescription.optional().transform((description) => description ?? null),
  folderId: PlaceId.optional().transform((folderId) => folderId ?? null),
});
export type CreateDeckRequest = z.input<typeof CreateDeckRequest>;

/**
 * The body of `PATCH /api/decks/:id`: a new name, a new description, a Folder
 * to move it to (null for the Root), a Desired retention of its own (null to
 * follow Settings), its own Macros (the whole list, replaced as given), or
 * any of them together. `onClash` says what a move does
 * about a name clash, and goes only with `folderId`.
 */
export const UpdateDeckRequest = z
  .strictObject({
    name: DeckName.optional(),
    description: DeckDescription.optional(),
    folderId: PlaceId.optional(),
    onClash: OnClash.optional(),
    desiredRetention: DesiredRetention.nullable().optional(),
    macros: MacroList.optional(),
  })
  .refine(
    (patch) =>
      patch.name !== undefined ||
      patch.description !== undefined ||
      patch.folderId !== undefined ||
      patch.desiredRetention !== undefined ||
      patch.macros !== undefined,
    "Expected a name, a description, a folder, a Desired retention or macros",
  )
  .refine(
    (patch) => patch.onClash === undefined || patch.folderId !== undefined,
    "onClash goes with a move",
  );
export type UpdateDeckRequest = z.input<typeof UpdateDeckRequest>;
