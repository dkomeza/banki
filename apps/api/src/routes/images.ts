import { IMAGE_MAX_BYTES } from "@banki/shared";
import { Hono } from "hono";
import { apiError } from "../http/errors";
import type { SignedInEnv } from "../http/require-signed-in";
import { type ImageRefusal, type ImageRepository, tooLarge } from "../repositories/images";

const NOT_FOUND = apiError("not_found", "Image not found");

/**
 * The types a browser may send across origins without asking first, as an
 * HTML form can: an upload in one of them is refused, so no other site can
 * make the User's browser upload something.
 */
const FORM_TYPES = new Set([
  "application/x-www-form-urlencoded",
  "multipart/form-data",
  "text/plain",
]);

/** An Image is never changed, only deleted, so the browser may keep it as long as it likes. */
const CACHE_CONTROL = "private, max-age=31536000, immutable";

/**
 * The request's body, read as it arrives and no further than `max` bytes:
 * one over that is refused without being kept, by its `Content-Length` before
 * anything is read when it has one, otherwise by counting what arrives.
 */
async function readUpTo(request: Request, max: number): Promise<Uint8Array | ImageRefusal> {
  const length = Number(request.headers.get("content-length") ?? Number.NaN);
  if (length > max) return tooLarge(length);
  if (request.body === null) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of request.body) {
    total += chunk.byteLength;
    // Past the limit, it keeps counting, for the message, but keeps nothing.
    if (total <= max) chunks.push(chunk);
  }
  if (total > max) return tooLarge(total);
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}

/**
 * The signed-in User's Images, under `/api/images`. `POST /` takes one image
 * as the request's body (`application/octet-stream`) and answers 201 with its
 * reference, `images/<id>.<ext>`; one over 5 MB answers 413
 * `image_too_large`, and one that isn't a PNG, JPEG, WebP or GIF by its bytes
 * 415 `unsupported_image_format`, each with a message to show. `GET
 * /<id>.<ext>` serves an Image as it was uploaded; an unknown one, another
 * User's, one swept and one whose extension isn't its format's answer 404.
 */
export function imageRoutes({ images }: { images: ImageRepository }) {
  return new Hono<SignedInEnv>()
    .post("/", async (c) => {
      const type = c.req.header("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
      if (FORM_TYPES.has(type)) {
        return c.json(apiError("invalid_request", "Send the image as the request's body"), 400);
      }
      const body = await readUpTo(c.req.raw, IMAGE_MAX_BYTES);
      const stored = "refused" in body ? body : images.store(c.var.user.id, body);
      if ("reference" in stored) return c.json(stored, 201);
      if (stored.refused === "too_large") {
        return c.json(apiError("image_too_large", stored.message), 413);
      }
      return c.json(apiError("unsupported_image_format", stored.message), 415);
    })
    .get("/:file", async (c) => {
      const found = images.find(c.var.user.id, c.req.param("file"));
      const file = found === undefined ? undefined : Bun.file(found.path);
      if (found === undefined || file === undefined || !(await file.exists())) {
        return c.json(NOT_FOUND, 404);
      }
      return c.body(file.stream(), 200, {
        "content-type": found.contentType,
        "content-length": String(file.size),
        "cache-control": CACHE_CONTROL,
      });
    });
}
