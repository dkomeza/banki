import type { PlaceDeletedError } from "@banki/shared";
import { Hono } from "hono";
import { apiError } from "../http/errors";
import type { SignedInEnv } from "../http/require-signed-in";
import type { DeletionRepository } from "../repositories/deletions";

const NOT_FOUND = apiError("not_found", "Deletion not found");

/**
 * The signed-in User's Deletions, under `/api/deletions`: `GET /` lists those
 * not removed, newest first, `POST /:id/restore` restores one, and `DELETE
 * /:id` removes one at once (Delete permanently). An unknown Deletion, one
 * restored or removed already, and another User's all answer 404 `not_found`.
 * A Card's Deletion whose Deck is deleted answers 409 `place_deleted`, naming
 * the Deck.
 */
export function deletionRoutes({ deletions }: { deletions: DeletionRepository }) {
  return new Hono<SignedInEnv>()
    .get("/", (c) => c.json(deletions.list(c.var.user.id), 200))
    .post("/:id/restore", (c) => {
      const restored = deletions.restore(c.var.user.id, c.req.param("id"));
      if (restored === "not_found") return c.json(NOT_FOUND, 404);
      if ("placeDeleted" in restored) {
        const { name } = restored.placeDeleted;
        const body: PlaceDeletedError = {
          error: { code: "place_deleted", message: `Restore ${name} first` },
          deck: restored.placeDeleted,
        };
        return c.json(body, 409);
      }
      return c.json(restored, 200);
    })
    .delete("/:id", (c) => {
      if (!deletions.remove(c.var.user.id, c.req.param("id"))) return c.json(NOT_FOUND, 404);
      return c.body(null, 204);
    });
}
