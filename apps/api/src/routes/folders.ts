import { CreateFolderRequest, UpdateFolderRequest } from "@banki/shared";
import { Hono } from "hono";
import { apiError } from "../http/errors";
import type { SignedInEnv } from "../http/require-signed-in";
import type { FolderRepository } from "../repositories/folders";
import { INVALID_MOVE, json, nameClash } from "./json";

const NOT_FOUND = apiError("not_found", "Folder not found");
const NAME_TAKEN = apiError("folder_name_taken", "There's already a folder with this name here");

/**
 * The signed-in User's Folders. `GET /` lists those that aren't deleted, `POST
 * /` creates one, and `GET`, `PATCH` and `DELETE /:id` read, rename or move,
 * and softly delete one with everything inside it. A deleted Folder, an
 * unknown one and another User's all answer 404 `not_found`, as the Folder or
 * as the destination. A name another Folder beside it has, ignoring case,
 * answers 409 `folder_name_taken` on a create or a rename, and 409
 * `name_clash` on a move without `onClash`. Moving a Folder into itself, or
 * replacing a Folder that holds it, answers `invalid_move`.
 */
export function folderRoutes({ folders }: { folders: FolderRepository }) {
  return new Hono<SignedInEnv>()
    .get("/", (c) => c.json(folders.list(c.var.user.id), 200))
    .post("/", json(CreateFolderRequest, "Invalid folder"), (c) => {
      const created = folders.create(c.var.user.id, c.req.valid("json"));
      if (created === "not_found") return c.json(NOT_FOUND, 404);
      if (created === "taken") return c.json(NAME_TAKEN, 409);
      return c.json(created, 201);
    })
    .get("/:id", (c) => {
      const found = folders.find(c.var.user.id, c.req.param("id"));
      if (found === undefined) return c.json(NOT_FOUND, 404);
      return c.json(found, 200);
    })
    .patch("/:id", json(UpdateFolderRequest, "Invalid folder"), (c) => {
      const updated = folders.update(c.var.user.id, c.req.param("id"), c.req.valid("json"));
      if (updated === "not_found") return c.json(NOT_FOUND, 404);
      if (updated === "taken") return c.json(NAME_TAKEN, 409);
      if (updated === "invalid_move") return c.json(INVALID_MOVE, 400);
      // Replace where it isn't allowed: a conflict with the tree, not a bad request.
      if (updated === "replace_not_allowed") return c.json(INVALID_MOVE, 409);
      if ("clash" in updated) return c.json(nameClash(updated.clash), 409);
      return c.json(updated, 200);
    })
    .delete("/:id", (c) => {
      if (!folders.softDelete(c.var.user.id, c.req.param("id"))) return c.json(NOT_FOUND, 404);
      return c.body(null, 204);
    });
}
