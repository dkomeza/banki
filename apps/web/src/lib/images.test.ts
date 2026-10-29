import { describe, expect, test, vi } from "vitest";
import { createApiClient } from "./api";
import { CANT_REACH } from "./decks";
import { imageFileOf, imageFileProblem, isImageMissing, onOwnLine, uploadImage } from "./images";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const pngFile = (size = PNG.byteLength) => {
  const bytes = new Uint8Array(size);
  bytes.set(PNG);
  return new File([bytes], "a.png", { type: "image/png" });
};
const svgAsPng = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], "a.png", {
  type: "image/png",
});

/** A client answering every request with `res()`, recording each request. */
const answering = (res: () => Response) => {
  const sent: { url: string; init: RequestInit | undefined }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: input instanceof Request ? input.url : input.toString(), init });
    return res();
  });
  return { client: createApiClient(fetch), sent };
};

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("imageFileProblem", () => {
  test("takes an image of up to 5 MB by its bytes", async () => {
    expect(await imageFileProblem(pngFile())).toBeUndefined();
    expect(await imageFileProblem(pngFile(5 * 1024 * 1024))).toBeUndefined();
  });

  test("refuses one over 5 MB, or of another format, with the API's message", async () => {
    expect(await imageFileProblem(pngFile(5 * 1024 * 1024 + 1))).toBe(
      "This image is 5.1 MB, and images can be up to 5 MB.",
    );
    expect(await imageFileProblem(svgAsPng)).toBe("Images can be PNG, JPEG, WebP or GIF.");
  });
});

/** A fetch answering every request with an empty response of status `code`. */
const status = (code: number) => vi.fn(async () => new Response(null, { status: code }));

describe("isImageMissing", () => {
  test("is true for a 404 only", async () => {
    const missing = status(404);
    expect(await isImageMissing("x.png", missing)).toBe(true);
    expect(missing).toHaveBeenCalledWith("/api/images/x.png", { method: "HEAD" });
    expect(await isImageMissing("x.png", status(500))).toBe(false);
    expect(await isImageMissing("x.png", status(401))).toBe(false);
    expect(
      await isImageMissing(
        "x.png",
        vi.fn(async () => {
          throw new TypeError("Failed to fetch");
        }),
      ),
    ).toBe(false);
  });
});

describe("uploadImage", () => {
  test("sends the file as the body and answers its reference", async () => {
    const { client, sent } = answering(() => json({ reference: "images/x.png" }, 201));
    const file = pngFile();

    expect(await uploadImage(file, client)).toEqual({ ok: true, reference: "images/x.png" });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toMatch(/\/api\/images$/);
    expect(sent[0]?.init?.body).toBe(file);
  });

  test("refuses a file the browser can tell is wrong without sending it", async () => {
    const { client, sent } = answering(() => json({ reference: "images/x.png" }, 201));

    expect(await uploadImage(svgAsPng, client)).toEqual({
      ok: false,
      message: "Images can be PNG, JPEG, WebP or GIF.",
    });
    expect(await uploadImage(pngFile(6 * 1024 * 1024), client)).toMatchObject({ ok: false });
    expect(sent).toEqual([]);
  });

  test("answers the API's own message for a refusal, and a general one otherwise", async () => {
    const refused = answering(() =>
      json({ error: { code: "image_too_large", message: "This image is 9.0 MB" } }, 413),
    );
    expect(await uploadImage(pngFile(), refused.client)).toEqual({
      ok: false,
      message: "This image is 9.0 MB",
    });

    const broken = answering(() => json({ error: { code: "internal_error", message: "x" } }, 500));
    expect(await uploadImage(pngFile(), broken.client)).toEqual({
      ok: false,
      message: "Banki couldn't upload the image. Try again.",
    });

    const offline = createApiClient(
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    expect(await uploadImage(pngFile(), offline)).toEqual({ ok: false, message: CANT_REACH });
  });
});

describe("onOwnLine", () => {
  const ref = "![](images/a.png)";

  test("breaks the line before or after it where the point is mid-line", () => {
    expect(onOwnLine("", "", ref)).toBe(ref);
    expect(onOwnLine("a", "b", ref)).toBe(`\n${ref}\n`);
    expect(onOwnLine("b", "", ref)).toBe(`\n${ref}`);
    expect(onOwnLine("", "a", ref)).toBe(`${ref}\n`);
  });

  test("adds no line breaks where there are some already", () => {
    expect(onOwnLine("\n", "\n", ref)).toBe(ref);
    expect(onOwnLine("a", "\n", ref)).toBe(`\n${ref}`);
    expect(onOwnLine("\n", "a", ref)).toBe(`${ref}\n`);
  });
});

describe("imageFileOf", () => {
  test("names the file of an Image reference, and nothing for any other URL", () => {
    expect(imageFileOf("images/0b1c.png")).toBe("0b1c.png");
    expect(imageFileOf("https://example.com/a.png")).toBeUndefined();
    expect(imageFileOf("images/../secret")).toBeUndefined();
  });
});
