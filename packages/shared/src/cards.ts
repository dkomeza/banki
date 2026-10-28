import { z } from "zod";
import { CardTags } from "./tags";

/** The longest a Card's Front or Back may be. */
export const CARD_SIDE_MAX_LENGTH = 20_000;

/**
 * A Card's Front or Back: Markdown with LaTeX, kept exactly as typed (never
 * trimmed), holding something other than whitespace, up to 20,000 characters.
 */
export const CardSide = z
  .string()
  .refine((side) => side.trim() !== "", "Write something on this side")
  .refine(
    (side) => side.length <= CARD_SIDE_MAX_LENGTH,
    `Keep it to ${CARD_SIDE_MAX_LENGTH.toLocaleString("en-GB")} characters`,
  );

/**
 * A Card as the API answers it: its Deck, its Front and Back as typed, its Tags
 * A–Z, and when it was created and last changed, as ISO 8601 times.
 */
export const CardResponse = z.object({
  id: z.string(),
  deckId: z.string(),
  front: z.string(),
  back: z.string(),
  tags: z.array(z.string()),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type CardResponse = z.infer<typeof CardResponse>;

/** The body of `GET /api/decks/:deckId/cards`: the Deck's live Cards, newest first. */
export const CardListResponse = z.array(CardResponse);
export type CardListResponse = z.infer<typeof CardListResponse>;

/** The body of `POST /api/decks/:deckId/cards`: the new Card's Front and Back, and its Tags (none unless given). */
export const CreateCardRequest = z.strictObject({
  front: CardSide,
  back: CardSide,
  tags: CardTags.default([]),
});
export type CreateCardRequest = z.input<typeof CreateCardRequest>;

/**
 * The body of `PATCH /api/cards/:id`: a new Front, a new Back, Tags that
 * replace the Card's, or any of them together.
 */
export const UpdateCardRequest = z
  .strictObject({
    front: CardSide.optional(),
    back: CardSide.optional(),
    tags: CardTags.optional(),
  })
  .refine(
    (patch) => patch.front !== undefined || patch.back !== undefined || patch.tags !== undefined,
    "Expected a front, a back or tags",
  );
export type UpdateCardRequest = z.input<typeof UpdateCardRequest>;
