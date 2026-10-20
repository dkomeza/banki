import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { PNG } from "pngjs";
import { differingFraction } from "./diff.ts";

/** A PNG of one colour, with the pixels in `dots` (x, y) black. */
function png(width: number, height: number, dots: [number, number][] = []): Buffer {
  const image = new PNG({ width, height });
  image.data.fill(255);
  for (const [x, y] of dots) {
    const i = (y * width + x) * 4;
    image.data[i] = image.data[i + 1] = image.data[i + 2] = 0;
  }
  return PNG.sync.write(image);
}

describe("differingFraction", () => {
  test("is 0 for identical images", () => {
    assert.equal(differingFraction(png(10, 10), png(10, 10)), 0);
  });

  test("is the fraction of pixels that differ", () => {
    // Two isolated dots on a flat background aren't anti-aliasing, so both count.
    assert.equal(
      differingFraction(
        png(10, 10),
        png(10, 10, [
          [2, 2],
          [7, 7],
        ]),
      ),
      2 / 100,
    );
  });

  test("is 1 when the sizes differ", () => {
    assert.equal(differingFraction(png(10, 10), png(10, 11)), 1);
    assert.equal(differingFraction(png(10, 10), png(11, 10)), 1);
  });
});
