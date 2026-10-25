import { z } from "zod";

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
 * ignoring case. Expects a name already trimmed.
 */
export const deckNameKey = (name: string) => name.normalize("NFC").toLowerCase();

/** A Deck as the API answers it. `createdAt` is an ISO 8601 time. */
export const DeckResponse = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type DeckResponse = z.infer<typeof DeckResponse>;

/** The body of `GET /api/decks`: the User's Decks that aren't deleted, in no set order. */
export const DeckListResponse = z.array(DeckResponse);
export type DeckListResponse = z.infer<typeof DeckListResponse>;

/** The body of `POST /api/decks`: a name and an optional description. */
export const CreateDeckRequest = z.strictObject({
  name: DeckName,
  description: DeckDescription.optional().transform((description) => description ?? null),
});
export type CreateDeckRequest = z.input<typeof CreateDeckRequest>;

/** The body of `PATCH /api/decks/:id`: a new name, a new description, or both. */
export const UpdateDeckRequest = z
  .strictObject({ name: DeckName.optional(), description: DeckDescription.optional() })
  .refine(
    (patch) => patch.name !== undefined || patch.description !== undefined,
    "Expected a name or a description",
  );
export type UpdateDeckRequest = z.input<typeof UpdateDeckRequest>;
