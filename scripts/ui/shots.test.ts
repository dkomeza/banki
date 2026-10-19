import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { shotFileName, shotName, themes, VIEWPORTS } from "./shots.ts";

describe("shotName", () => {
  test("/ is index", () => {
    assert.equal(shotName("/"), "index");
  });

  test("the leading slash goes and other slashes become underscores", () => {
    assert.equal(shotName("/login"), "login");
    assert.equal(shotName("/decks/abc"), "decks_abc");
    assert.equal(shotName("/decks/abc/cards"), "decks_abc_cards");
    assert.equal(shotName("/decks/"), "decks_");
  });

  test("the query string and hash are dropped", () => {
    assert.equal(shotName("/login?redirect=/decks"), "login");
    assert.equal(shotName("/?tab=all"), "index");
    assert.equal(shotName("/setup?token=abc#top"), "setup");
    assert.equal(shotName("/decks#cards"), "decks");
  });
});

describe("shotFileName", () => {
  test("is <route>@<viewport>-<theme>.png", () => {
    assert.equal(shotFileName("/decks/abc", "phone", "light"), "decks_abc@phone-light.png");
    assert.equal(shotFileName("/", "desktop", "dark"), "index@desktop-dark.png");
  });
});

describe("VIEWPORTS", () => {
  test("phone and tablet are touch devices at 2x, desktop is 1x", () => {
    assert.deepEqual(
      VIEWPORTS.map(({ name, width, height, deviceScaleFactor, isMobile, hasTouch }) => [
        name,
        width,
        height,
        deviceScaleFactor,
        isMobile,
        hasTouch,
      ]),
      [
        ["phone", 390, 844, 2, true, true],
        ["tablet", 820, 1180, 2, true, true],
        ["desktop", 1440, 900, 1, false, false],
      ],
    );
  });
});

describe("themes", () => {
  test("light only while banki.darkTheme is false", () => {
    assert.deepEqual(themes({ name: "@banki/web", banki: { darkTheme: false } }), ["light"]);
  });

  test("light and dark once banki.darkTheme is true", () => {
    assert.deepEqual(themes({ banki: { darkTheme: true } }), ["light", "dark"]);
  });

  test("light only when the switch is missing or isn't true", () => {
    assert.deepEqual(themes({}), ["light"]);
    assert.deepEqual(themes({ banki: {} }), ["light"]);
    assert.deepEqual(themes({ banki: { darkTheme: "true" } }), ["light"]);
    assert.deepEqual(themes(null), ["light"]);
  });
});
