import { z } from "zod";
import { DECK_NAME_MAX_LENGTH, OnClash, PlaceId } from "./decks";

/** The longest Folder name, after trimming: the same as a Deck's. */
export const FOLDER_NAME_MAX_LENGTH = DECK_NAME_MAX_LENGTH;

/** A Folder's name: trimmed, 1 to 100 characters, as a Deck's is. */
export const FolderName = z
  .string()
  .trim()
  .min(1, "Give the folder a name")
  .max(FOLDER_NAME_MAX_LENGTH, `Keep the name to ${FOLDER_NAME_MAX_LENGTH} characters`);

/**
 * A Folder as the API answers it. `parentId` is the Folder it sits in, null
 * at the Root. `createdAt` is an ISO 8601 time.
 */
export const FolderResponse = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type FolderResponse = z.infer<typeof FolderResponse>;

/**
 * The body of `GET /api/folders`: every Folder of the User's that isn't
 * deleted, in no set order. The client builds the tree from the `parentId`s.
 */
export const FolderListResponse = z.array(FolderResponse);
export type FolderListResponse = z.infer<typeof FolderListResponse>;

/** The body of `POST /api/folders`: a name, and the Folder to create it in (null for the Root). */
export const CreateFolderRequest = z.strictObject({
  name: FolderName,
  parentId: PlaceId.optional().transform((parentId) => parentId ?? null),
});
export type CreateFolderRequest = z.input<typeof CreateFolderRequest>;

/**
 * The body of `PATCH /api/folders/:id`: a new name, a Folder to move it to
 * (null for the Root), or both. `onClash` says what a move does about a name
 * clash, and goes only with `parentId`.
 */
export const UpdateFolderRequest = z
  .strictObject({
    name: FolderName.optional(),
    parentId: PlaceId.optional(),
    onClash: OnClash.optional(),
  })
  .refine(
    (patch) => patch.name !== undefined || patch.parentId !== undefined,
    "Expected a name or a folder",
  )
  .refine(
    (patch) => patch.onClash === undefined || patch.parentId !== undefined,
    "onClash goes with a move",
  );
export type UpdateFolderRequest = z.input<typeof UpdateFolderRequest>;
