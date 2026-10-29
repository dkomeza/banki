import {
  ApiError,
  IMAGE_FORMATS,
  IMAGE_FORMAT_MESSAGE,
  IMAGE_MAX_BYTES,
  IMAGE_SIGNATURE_BYTES,
  ImageUploadResponse,
  imageFormatOf,
  imageTooLargeMessage,
} from "@banki/shared";
import { type ApiClient, api } from "./api";
import { CANT_REACH } from "./decks";

/** What the file picker offers: the types an Image may have. */
export const IMAGE_ACCEPT = Object.values(IMAGE_FORMATS)
  .map((format) => format.contentType)
  .join(",");

/** Where the API serves the Image a reference's `images/<file>` names (ADR-0019). */
export const imageUrl = (file: string) => `/api/images/${file}`;

/**
 * The `src` an image in a Card's Markdown loads: an Image's reference,
 * `images/<file>`, resolves to where the API serves it (ADR-0019), and any
 * other URL stays as written.
 */
export function imageSrc(url: string): string {
  const file = imageFileOf(url);
  return file === undefined ? url : imageUrl(file);
}

/** The Image file a URL names, `images/<file>`, or undefined for any other URL. */
export const imageFileOf = (url: string) => /^images\/([\w-]+\.[A-Za-z0-9]+)$/.exec(url)?.[1];

/**
 * Why `file` can't be an Image, the same message the API would give, or
 * undefined when it may be uploaded: over 5 MB, or not a PNG, JPEG, WebP or
 * GIF by its first bytes, whatever its name or type says.
 */
export async function imageFileProblem(file: Blob): Promise<string | undefined> {
  if (file.size > IMAGE_MAX_BYTES) return imageTooLargeMessage(file.size);
  const head = new Uint8Array(await file.slice(0, IMAGE_SIGNATURE_BYTES).arrayBuffer());
  return imageFormatOf(head) === undefined ? IMAGE_FORMAT_MESSAGE : undefined;
}

/**
 * Whether the Image `file` names is known not to exist, asked after its
 * thumbnail failed to load: only a 404 says so. Another failure (offline, a
 * 5xx, a sign-in being refreshed) isn't taken for a missing Image.
 */
export async function isImageMissing(
  file: string,
  fetch: typeof globalThis.fetch = (input, init) => globalThis.fetch(input, init),
): Promise<boolean> {
  try {
    return (await fetch(imageUrl(file), { method: "HEAD" })).status === 404;
  } catch {
    return false;
  }
}

export type UploadOutcome = { ok: true; reference: string } | { ok: false; message: string };

/**
 * Uploads `file` as an Image with `POST /api/images`, unless the browser
 * refuses it first ({@link imageFileProblem}), and answers its reference,
 * `images/<id>.<ext>`, or the message to show.
 */
export async function uploadImage(file: Blob, client: ApiClient = api): Promise<UploadOutcome> {
  const problem = await imageFileProblem(file);
  if (problem !== undefined) return { ok: false, message: problem };
  let res: Response;
  try {
    res = await client.api.images.$post(undefined, {
      init: { body: file, headers: { "content-type": "application/octet-stream" } },
    });
  } catch {
    return { ok: false, message: CANT_REACH };
  }
  const body: unknown = await res.json().catch(() => undefined);
  if (res.ok) {
    const uploaded = ImageUploadResponse.safeParse(body);
    if (uploaded.success) return { ok: true, reference: uploaded.data.reference };
  }
  const error = ApiError.safeParse(body);
  if (error.success && (res.status === 413 || res.status === 415)) {
    return { ok: false, message: error.data.error.message };
  }
  return { ok: false, message: "Banki couldn't upload the image. Try again." };
}

/**
 * `insert` as it goes in at a point on a line of its own, `before` and
 * `after` being the characters either side of the point ("" at an end): with
 * a line break before or after it where the point is mid-line.
 */
export function onOwnLine(before: string, after: string, insert: string): string {
  const lead = before === "" || before === "\n" ? "" : "\n";
  const trail = after === "" || after === "\n" ? "" : "\n";
  return `${lead}${insert}${trail}`;
}
