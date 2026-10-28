import { z } from "zod";

/** The largest an Image may be, in bytes: 5 MB. */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** The formats an Image may have, each with the extension its reference ends in and its type. */
export const IMAGE_FORMATS = {
  png: { extension: "png", contentType: "image/png" },
  jpeg: { extension: "jpg", contentType: "image/jpeg" },
  webp: { extension: "webp", contentType: "image/webp" },
  gif: { extension: "gif", contentType: "image/gif" },
} as const;

export type ImageFormat = keyof typeof IMAGE_FORMATS;

/** How many of a file's first bytes {@link imageFormatOf} needs. */
export const IMAGE_SIGNATURE_BYTES = 12;

const startsWith = (bytes: Uint8Array, signature: readonly number[], at = 0) =>
  signature.every((byte, i) => bytes[at + i] === byte);

const ascii = (text: string) => Array.from(new TextEncoder().encode(text));

/**
 * The format a file's first bytes say it has, whatever its name or claimed
 * type, or undefined when it isn't one an Image may have (an SVG, HEIC, AVIF
 * or anything else).
 */
export function imageFormatOf(bytes: Uint8Array): ImageFormat | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, ascii("GIF87a")) || startsWith(bytes, ascii("GIF89a"))) return "gif";
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return "webp";
  return undefined;
}

/** The message a file of a format an Image may not have is refused with. */
export const IMAGE_FORMAT_MESSAGE = "Images can be PNG, JPEG, WebP or GIF.";

/** "7.3 MB": a size in MB with one decimal, rounded up, so a size over the limit never reads as it. */
const megabytes = (bytes: number) =>
  `${(Math.ceil((bytes / (1024 * 1024)) * 10) / 10).toFixed(1)} MB`;

/** The message an Image over {@link IMAGE_MAX_BYTES} is refused with, naming its size and the limit. */
export const imageTooLargeMessage = (bytes: number) =>
  `This image is ${megabytes(bytes)}, and images can be up to 5 MB.`;

/** The body of `POST /api/images`: the new Image's reference, `images/<id>.<ext>`, to put in a Card. */
export const ImageUploadResponse = z.object({ reference: z.string() });
export type ImageUploadResponse = z.infer<typeof ImageUploadResponse>;

/**
 * A reference to an Image in a Card's Markdown, `![alt](images/<file>)`, where
 * `<file>` is one name with one extension (ADR-0019). It matches references to
 * Images that don't exist too, such as a typo, so they can be shown as missing.
 */
const REFERENCE = /!\[[^\]\n]*\]\(images\/([\w-]+\.[A-Za-z0-9]+)\)/g;

/** One reference in a side's Markdown: where it is, and the file it names. */
export type ImageReference = { start: number; end: number; file: string };

/** Every Image reference in `markdown`, in the order they appear. */
export function imageReferencesIn(markdown: string): ImageReference[] {
  return [...markdown.matchAll(REFERENCE)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    file: match[1] ?? "",
  }));
}

/** The Markdown that refers to an Image, given its reference `images/<id>.<ext>`: alt text empty. */
export const imageMarkdown = (reference: string) => `![](${reference})`;
