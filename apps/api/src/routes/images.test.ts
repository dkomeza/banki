import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ApiError, ImageUploadResponse } from "@banki/shared";
import { type App, ORIGIN, bootApps, codeOf, get, setUp } from "../testing/app";

const { boot, dataDir } = bootApps();

const uploads = () => join(dataDir(), "uploads");

const ascii = (text: string) => Array.from(new TextEncoder().encode(text));

/** A file of each format an Image may have: its signature and some bytes, EXIF and all. */
const FILES = {
  png: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
  jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 16, ...ascii("Exif"), 0, 0, 1, 2, 3, 4]),
  webp: new Uint8Array([...ascii("RIFF"), 4, 0, 0, 0, ...ascii("WEBPVP8 ")]),
  gif: new Uint8Array([...ascii("GIF89a"), 1, 0, 1, 0]),
};

async function signedIn() {
  const booted = boot();
  return { app: booted.app, cookie: await setUp(booted) };
}

const upload = (
  app: App,
  body: RequestInit["body"],
  cookie?: string,
  headers: Record<string, string> = {},
) =>
  app.request("/api/images", {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      origin: ORIGIN,
      ...(cookie === undefined ? {} : { cookie }),
      ...headers,
    },
    body,
  });

const messageOf = async (res: Response) => ApiError.parse(await res.json()).error.message;

describe("POST /api/images", () => {
  test("stores a PNG, JPEG, WebP or GIF byte for byte and answers its reference", async () => {
    const { app, cookie } = await signedIn();

    for (const [format, bytes] of Object.entries(FILES)) {
      const res = await upload(app, bytes, cookie);

      expect(res.status).toBe(201);
      const { reference } = ImageUploadResponse.parse(await res.json());
      const ext = format === "jpeg" ? "jpg" : format;
      expect(reference).toMatch(new RegExp(`^images/[0-9a-f-]{36}\\.${ext}$`));
      const file = reference.slice("images/".length);
      expect(new Uint8Array(readFileSync(join(uploads(), file)))).toEqual(bytes);
    }
    expect(readdirSync(uploads())).toHaveLength(4);
  });

  test("goes by the bytes, not the claimed type", async () => {
    const { app, cookie } = await signedIn();

    const res = await upload(app, FILES.jpeg, cookie, { "content-type": "image/png" });

    expect(ImageUploadResponse.parse(await res.json()).reference).toEndWith(".jpg");
  });

  test("refuses an SVG renamed .png, or anything else, naming the formats, and stores nothing", async () => {
    const { app, cookie } = await signedIn();

    for (const body of [
      new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
      new Uint8Array([0, 0, 0, 0x18, ...ascii("ftypheic")]),
      new Uint8Array(),
    ]) {
      const res = await upload(app, body, cookie, { "content-type": "image/png" });

      expect(res.status).toBe(415);
      const error = ApiError.parse(await res.json()).error;
      expect(error.code).toBe("unsupported_image_format");
      expect(error.message).toBe("Images can be PNG, JPEG, WebP or GIF.");
    }
    expect(readdirSync(uploads())).toEqual([]);
  });

  test("refuses an image over 5 MB, saying its size and the limit, and stores nothing", async () => {
    const { app, cookie } = await signedIn();
    const big = new Uint8Array(6 * 1024 * 1024);
    big.set(FILES.png);

    const res = await upload(app, big, cookie);

    expect(res.status).toBe(413);
    expect(ApiError.parse(await res.json()).error).toEqual({
      code: "image_too_large",
      message: "This image is 6.0 MB, and images can be up to 5 MB.",
    });
    expect(readdirSync(uploads())).toEqual([]);
  });

  test("refuses one over 5 MB by counting, when it arrives with no Content-Length", async () => {
    const { app, cookie } = await signedIn();
    const chunk = new Uint8Array(1024 * 1024);
    chunk.set(FILES.png);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent === 6) return controller.close();
        sent += 1;
        controller.enqueue(chunk);
      },
    });

    const res = await upload(app, stream, cookie);

    expect(res.status).toBe(413);
    expect(await messageOf(res)).toBe("This image is 6.0 MB, and images can be up to 5 MB.");
    expect(readdirSync(uploads())).toEqual([]);
  });

  test("refuses one whose Content-Length is over 5 MB before reading it", async () => {
    const { app, cookie } = await signedIn();
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(FILES.png);
      },
    });

    const res = await upload(app, stream, cookie, { "content-length": String(8 * 1024 * 1024) });

    expect(res.status).toBe(413);
    expect(await messageOf(res)).toBe("This image is 8.0 MB, and images can be up to 5 MB.");
    expect(pulled).toBeLessThanOrEqual(1);
  });

  test("refuses a body sent as a form or a plain fetch could send it, so no other site can upload", async () => {
    const { app, cookie } = await signedIn();

    for (const type of [
      "multipart/form-data; boundary=x",
      "text/plain",
      "application/x-www-form-urlencoded",
    ]) {
      const res = await upload(app, FILES.png, cookie, { "content-type": type });
      expect(res.status).toBe(400);
    }
    const untyped = await app.request("/api/images", {
      method: "POST",
      headers: { origin: ORIGIN, cookie },
      body: FILES.png,
    });
    expect(untyped.status).toBe(400);
    expect(readdirSync(uploads())).toEqual([]);
  });

  test("needs sign-in", async () => {
    const booted = boot();
    await setUp(booted);

    const res = await upload(booted.app, FILES.png);

    expect(res.status).toBe(401);
    expect(readdirSync(uploads())).toEqual([]);
  });
});

/** An app signed in, with one PNG uploaded, and the path it is served at. */
async function uploaded() {
  const { app, cookie } = await signedIn();
  const res = await upload(app, FILES.png, cookie);
  const { reference } = ImageUploadResponse.parse(await res.json());
  return { app, cookie, path: `/api/${reference}` };
}

describe("GET /api/images/:file", () => {
  test("serves the Image as uploaded, with its own type, cached as never changing", async () => {
    const { app, cookie } = await signedIn();
    for (const [format, type] of [
      ["png", "image/png"],
      ["jpeg", "image/jpeg"],
      ["webp", "image/webp"],
      ["gif", "image/gif"],
    ] as const) {
      const { reference } = ImageUploadResponse.parse(
        await (await upload(app, FILES[format], cookie)).json(),
      );

      const res = await get(app, `/api/${reference}`, cookie);

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe(type);
      expect(res.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(FILES[format]);
    }
  });

  test("needs sign-in", async () => {
    const { app, path } = await uploaded();

    expect((await get(app, path)).status).toBe(401);
  });

  test("is a 404 for an unknown Image, a wrong extension, or one whose file is gone", async () => {
    const { app, cookie, path } = await uploaded();

    expect(
      (await get(app, "/api/images/5eed0000-0000-4000-8000-00000000ffff.png", cookie)).status,
    ).toBe(404);
    expect((await get(app, path.replace(".png", ".jpg"), cookie)).status).toBe(404);
    expect((await get(app, path.replace(".png", ""), cookie)).status).toBe(404);
    const head = (at: string) => app.request(at, { method: "HEAD", headers: { cookie } });
    expect((await head("/api/images/nope.png")).status).toBe(404);
    expect((await head(path)).status).toBe(200);

    const file = path.slice("/api/images/".length);
    rmSync(join(uploads(), file));
    const gone = await get(app, path, cookie);
    expect(gone.status).toBe(404);
    expect(await codeOf(gone)).toBe("not_found");
  });
});
