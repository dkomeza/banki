import { z } from "zod";
import { CARD_BATCH_MAX } from "./cards";

/** How long a Deletion waits in Recently deleted before its Removal: 30 × 24 h. */
export const DELETION_KEPT_MS = 30 * 24 * 60 * 60 * 1000;

/** What a Deletion's top item is: what was deleted, with everything that went with it. */
export const DeletionKind = z.enum(["folder", "deck", "card"]);
export type DeletionKind = z.infer<typeof DeletionKind>;

/**
 * One Deletion in Recently deleted, as `GET /api/deletions` answers it: when it
 * was deleted and will be removed, its top item (a Card's `name` is its
 * Front), where that was (`path`, the Folder names from the Root, for a Deck or
 * Folder; `deck`, for a Card; the other null), and how many folders, decks
 * and cards went with it, the top item not counted.
 */
export const DeletionResponse = z.object({
  id: z.string(),
  deletedAt: z.iso.datetime(),
  removesAt: z.iso.datetime(),
  top: z.object({ kind: DeletionKind, id: z.string(), name: z.string() }),
  path: z.array(z.string()).nullable(),
  deck: z.object({ id: z.string(), name: z.string() }).nullable(),
  counts: z.object({
    folders: z.number().int().nonnegative(),
    decks: z.number().int().nonnegative(),
    cards: z.number().int().nonnegative(),
  }),
});
export type DeletionResponse = z.infer<typeof DeletionResponse>;

/** The body of `GET /api/deletions`: the User's Deletions not removed, newest first. */
export const DeletionListResponse = z.array(DeletionResponse);
export type DeletionListResponse = z.infer<typeof DeletionListResponse>;

/**
 * The body of `POST /api/deletions/:id/restore`: the restored top item, under
 * its new name when it was `renamed` to the next free "Name (n)", and whether
 * it `movedToRoot` because its Folder is deleted.
 */
export const RestoreResponse = z.object({
  kind: DeletionKind,
  id: z.string(),
  name: z.string(),
  movedToRoot: z.boolean(),
  renamed: z.boolean(),
});
export type RestoreResponse = z.infer<typeof RestoreResponse>;

/**
 * The body of a 409 `place_deleted`: a Card's Deletion can't be restored while
 * its Deck is deleted; `deck` names that Deck.
 */
export const PlaceDeletedError = z.object({
  error: z.object({ code: z.literal("place_deleted"), message: z.string() }),
  deck: z.object({ id: z.string(), name: z.string() }),
});
export type PlaceDeletedError = z.infer<typeof PlaceDeletedError>;

/** The body of `DELETE /api/cards/:id`, `/api/decks/:id` and `/api/folders/:id`: the new Deletion. */
export const DeleteResponse = z.object({ deletionId: z.string() });
export type DeleteResponse = z.infer<typeof DeleteResponse>;

/** The body `POST /api/cards/delete` answers: each Card's own Deletion. */
export const DeleteCardsResponse = z.object({
  deletions: z.array(z.object({ cardId: z.string(), deletionId: z.string() })),
});
export type DeleteCardsResponse = z.infer<typeof DeleteCardsResponse>;

/**
 * The body of `POST /api/deletions/restore`: the Deletions to restore together,
 * 1 to 10,000, such as a delete of several Cards' Undo. Every one is restored,
 * or none is.
 */
export const RestoreDeletionsRequest = z.strictObject({
  deletionIds: z.array(z.string().min(1)).min(1).max(CARD_BATCH_MAX),
});
export type RestoreDeletionsRequest = z.input<typeof RestoreDeletionsRequest>;

/** The body `POST /api/deletions/restore` answers: each Deletion's restored top item. */
export const RestoreDeletionsResponse = z.object({ restored: z.array(RestoreResponse) });
export type RestoreDeletionsResponse = z.infer<typeof RestoreDeletionsResponse>;
