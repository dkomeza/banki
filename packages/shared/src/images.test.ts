import { describe, expect, test } from "bun:test";
import { frontKey } from "./front-key";
import {
  IMAGE_MAX_BYTES,
  imageFormatOf,
  imageMarkdown,
  imageReferencesIn,
  imageTooLargeMessage,
} from "./images";

const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(
    parts.flatMap((part) =>
      typeof part === "string" ? Array.from(new TextEncoder().encode(part)) : part,
    ),
  );

describe("imageFormatOf", () => {
  test("recognizes PNG, JPEG, WebP and GIF by their first bytes", () => {
    expect(imageFormatOf(bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))).toBe("png");
    expect(imageFormatOf(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(imageFormatOf(bytes("RIFF", [1, 2, 3, 4], "WEBPVP8 "))).toBe("webp");
    expect(imageFormatOf(bytes("GIF89a", [1, 0]))).toBe("gif");
    expect(imageFormatOf(bytes("GIF87a", [1, 0]))).toBe("gif");
  });

  test("refuses anything else, whatever it would be called", () => {
    expect(imageFormatOf(bytes('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeUndefined();
    expect(imageFormatOf(bytes([0, 0, 0, 0x18], "ftypheic"))).toBeUndefined();
    expect(imageFormatOf(bytes([0, 0, 0, 0x1c], "ftypavif"))).toBeUndefined();
    expect(imageFormatOf(bytes("RIFF", [1, 2, 3, 4], "WAVEfmt "))).toBeUndefined();
    expect(imageFormatOf(bytes("%PDF-1.7"))).toBeUndefined();
    expect(imageFormatOf(bytes([0x89], "PN"))).toBeUndefined();
    expect(imageFormatOf(new Uint8Array())).toBeUndefined();
  });
});

describe("imageTooLargeMessage", () => {
  test("names the image's size, rounded up, and the limit", () => {
    expect(imageTooLargeMessage(7.25 * 1024 * 1024)).toBe(
      "This image is 7.3 MB, and images can be up to 5 MB.",
    );
    expect(imageTooLargeMessage(IMAGE_MAX_BYTES + 1)).toBe(
      "This image is 5.1 MB, and images can be up to 5 MB.",
    );
  });
});

describe("imageReferencesIn", () => {
  test("finds each reference in order, with where it is and the file it names", () => {
    const markdown = "A\n![](images/a1.png)\ntext ![a cat](images/b-2.jpg) end\n![](images/a1.png)";
    expect(imageReferencesIn(markdown)).toEqual([
      { start: 2, end: 20, file: "a1.png" },
      { start: 26, end: 50, file: "b-2.jpg" },
      { start: 55, end: 73, file: "a1.png" },
    ]);
  });

  test("takes a reference to an Image that doesn't exist, but nothing outside images/", () => {
    expect(imageReferencesIn("![](images/typo.pgn)").map((r) => r.file)).toEqual(["typo.pgn"]);
    expect(
      imageReferencesIn(
        "![](https://example.com/a.png) ![](images/../x.png) ![](images/a/b.png) [](images/c.png) ![](images/noext)",
      ),
    ).toEqual([]);
  });

  test("reads the Markdown imageMarkdown writes", () => {
    expect(imageReferencesIn(imageMarkdown("images/x.webp"))).toEqual([
      { start: 0, end: 18, file: "x.webp" },
    ]);
  });
});

test("an Image reference counts as Front text, so Fronts that differ only in their Images aren't alike", () => {
  expect(frontKey("Name it ![](images/a.png)")).not.toBe(frontKey("Name it ![](images/b.png)"));
  expect(frontKey("Name it ![](images/a.png)")).not.toBe(frontKey("Name it"));
});
