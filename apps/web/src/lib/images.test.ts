import { imageReferencesIn } from "@banki/shared";
import { describe, expect, test, vi } from "vitest";
import { createApiClient } from "./api";
import { CANT_REACH } from "./decks";
import { imageFileProblem, insertOnOwnLine, uploadImage, withoutReference } from "./images";

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

describe("insertOnOwnLine", () => {
  const ref = "![](images/a.png)";

  test("puts it on a line of its own at the cursor, the cursor after it", () => {
    expect(insertOnOwnLine("", 0, ref)).toEqual({ text: ref, cursor: ref.length });
    expect(insertOnOwnLine("ab", 1, ref)).toEqual({ text: `a\n${ref}\nb`, cursor: 2 + ref.length });
    expect(insertOnOwnLine("ab", 2, ref)).toEqual({ text: `ab\n${ref}`, cursor: 3 + ref.length });
    expect(insertOnOwnLine("ab", 0, ref)).toEqual({ text: `${ref}\nab`, cursor: ref.length });
  });

  test("adds no line breaks where there are some already", () => {
    expect(insertOnOwnLine("a\n\nb", 2, ref)).toEqual({
      text: `a\n${ref}\nb`,
      cursor: 2 + ref.length,
    });
  });

  test("puts several in the order they come, one per line", () => {
    const first = insertOnOwnLine("text", 4, "one");
    const second = insertOnOwnLine(first.text, first.cursor, "two");
    expect(second.text).toBe("text\none\ntwo");
  });

  test("keeps a cursor past the end to the end", () => {
    expect(insertOnOwnLine("ab", 99, ref).text).toBe(`ab\n${ref}`);
  });
});

/** `text` without its `n`th Image reference. */
const removing = (text: string, n = 0) => {
  const ref = imageReferencesIn(text)[n];
  if (ref === undefined) throw new Error("no reference");
  return withoutReference(text, ref);
};

describe("withoutReference", () => {
  test("takes its line with it when it was alone on it", () => {
    expect(removing("a\n![](images/x.png)\nb")).toBe("a\nb");
    expect(removing("![](images/x.png)\nb")).toBe("b");
    expect(removing("a\n![](images/x.png)")).toBe("a");
    expect(removing("![](images/x.png)")).toBe("");
    expect(removing("a\n  ![](images/x.png) \nb")).toBe("a\nb");
  });

  test("takes only the reference when other text shares its line", () => {
    expect(removing("see ![](images/x.png) here")).toBe("see  here");
  });

  test("takes the one asked for when the same Image is referred to twice", () => {
    expect(removing("![](images/x.png)\nmid\n![](images/x.png)", 1)).toBe("![](images/x.png)\nmid");
  });
});
