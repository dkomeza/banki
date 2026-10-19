import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  ATTACH_BUDGET,
  attachments,
  classify,
  comparedEvidence,
  fallbackEvidence,
  prFileName,
  renderFragment,
  spliceBody,
} from "./evidence.ts";

const light = ["light"] as const;
const both = ["light", "dark"] as const;

/** Each route's path is itself, except /decks/$deckId. */
const pathOf = (route: string) => (route === "/decks/$deckId" ? "/decks/deck-1" : route);

describe("classify", () => {
  test("sorts routes into new, changed, removed and unchanged", () => {
    const diffs = new Map([
      ["/", [0, 0, 0]],
      ["/login", [0, 0.02, 0.5]],
      ["/setup", [0, 0, 0]],
    ]);
    assert.deepEqual(
      classify({
        before: ["/", "/login", "/setup", "/old"],
        after: ["/", "/login", "/setup", "/decks"],
        diffs,
      }),
      {
        newRoutes: ["/decks"],
        changed: [{ route: "/login", score: 0.5 }],
        removed: ["/old"],
        unchanged: ["/", "/setup"],
      },
    );
  });

  test("one differing pixel in one pair is a change", () => {
    const diffs = new Map([["/", [0, 1e-7, 0]]]);
    assert.deepEqual(classify({ before: ["/"], after: ["/"], diffs }).changed, [
      { route: "/", score: 1e-7 },
    ]);
  });

  test("a route on both sides needs its diffs", () => {
    assert.throws(() => classify({ before: ["/"], after: ["/"], diffs: new Map() }), /\//);
  });
});

describe("prFileName", () => {
  test("is the shot name, viewport, theme and side", () => {
    assert.equal(prFileName("/login", "phone", "light", "before"), "login@phone-light-before.png");
    assert.equal(prFileName("/", "desktop", "dark", "after"), "index@desktop-dark-after.png");
  });
});

describe("comparedEvidence", () => {
  test("shows new routes first, then changed ones by descending score", () => {
    const evidence = comparedEvidence(
      {
        newRoutes: ["/n1", "/n2"],
        changed: [
          { route: "/a", score: 0.1 },
          { route: "/b", score: 0.9 },
          { route: "/c", score: 0.5 },
        ],
        removed: [],
        unchanged: [],
      },
      { pathOf, themes: [...light] },
    );
    assert.deepEqual(
      evidence.shown.map(({ route, before }) => [route, before]),
      [
        ["/n1", false],
        ["/n2", false],
        ["/b", true],
        ["/c", true],
        ["/a", true],
      ],
    );
    assert.deepEqual(evidence.notShown, []);
  });

  test("routes past the budget go on the not-shown list, new first then by score", () => {
    // Light only: a new route is 3 files, a changed one 6. 2 × 3 + 7 × 6 = 48; the next doesn't fit.
    const changed = Array.from({ length: 10 }, (_, i) => ({
      route: `/c${i}`,
      score: (i + 1) / 100,
    }));
    const evidence = comparedEvidence(
      { newRoutes: ["/n1", "/n2"], changed, removed: [], unchanged: [] },
      { pathOf, themes: [...light] },
    );
    assert.deepEqual(
      evidence.shown.map(({ route }) => route),
      ["/n1", "/n2", "/c9", "/c8", "/c7", "/c6", "/c5", "/c4", "/c3"],
    );
    assert.deepEqual(evidence.notShown, ["/c2", "/c1", "/c0"]);
    assert.ok(attachments(evidence, [...light]).length <= ATTACH_BUDGET);
  });

  test("new routes beyond the budget come first on the not-shown list", () => {
    // Light and dark: a new route is 6 files, so 8 fit (48) and the ninth doesn't.
    const newRoutes = Array.from({ length: 10 }, (_, i) => `/n${i}`);
    const evidence = comparedEvidence(
      { newRoutes, changed: [{ route: "/c", score: 1 }], removed: [], unchanged: [] },
      { pathOf, themes: [...both] },
    );
    assert.equal(evidence.shown.length, 8);
    assert.deepEqual(evidence.notShown, ["/n8", "/n9", "/c"]);
    assert.equal(attachments(evidence, [...both]).length, 48);
  });

  test("keeps the scores' route-tree order on a tie", () => {
    const evidence = comparedEvidence(
      {
        newRoutes: [],
        changed: [
          { route: "/x", score: 0.2 },
          { route: "/y", score: 0.2 },
        ],
        removed: [],
        unchanged: [],
      },
      { pathOf, themes: [...light] },
    );
    assert.deepEqual(
      evidence.shown.map(({ route }) => route),
      ["/x", "/y"],
    );
  });
});

describe("attachments", () => {
  test("are a changed route's pairs and a new route's after shots, at each viewport and theme", () => {
    const evidence = comparedEvidence(
      {
        newRoutes: ["/decks/$deckId"],
        changed: [{ route: "/login", score: 0.3 }],
        removed: [],
        unchanged: ["/"],
      },
      { pathOf, themes: [...both] },
    );
    assert.deepEqual(
      attachments(evidence, [...both]).map(({ file }) => file),
      [
        "decks_deck-1@phone-light-after.png",
        "decks_deck-1@tablet-light-after.png",
        "decks_deck-1@desktop-light-after.png",
        "decks_deck-1@phone-dark-after.png",
        "decks_deck-1@tablet-dark-after.png",
        "decks_deck-1@desktop-dark-after.png",
        "login@phone-light-before.png",
        "login@phone-light-after.png",
        "login@tablet-light-before.png",
        "login@tablet-light-after.png",
        "login@desktop-light-before.png",
        "login@desktop-light-after.png",
        "login@phone-dark-before.png",
        "login@phone-dark-after.png",
        "login@tablet-dark-before.png",
        "login@tablet-dark-after.png",
        "login@desktop-dark-before.png",
        "login@desktop-dark-after.png",
      ],
    );
  });
});

describe("renderFragment", () => {
  test("a changed route gets a light table of its before and after shots", () => {
    const evidence = comparedEvidence(
      {
        newRoutes: [],
        changed: [{ route: "/login", score: 0.3 }],
        removed: [],
        unchanged: ["/", "/setup"],
      },
      { pathOf, themes: [...light] },
    );
    assert.equal(
      renderFragment(evidence, [...light]),
      `<!-- ui-shots -->
#### /login

| | Before | After |
| --- | --- | --- |
| Phone | ![/login, phone, before](./.ui/pr/login@phone-light-before.png) | ![/login, phone, after](./.ui/pr/login@phone-light-after.png) |
| Tablet | ![/login, tablet, before](./.ui/pr/login@tablet-light-before.png) | ![/login, tablet, after](./.ui/pr/login@tablet-light-after.png) |
| Desktop | ![/login, desktop, before](./.ui/pr/login@desktop-light-before.png) | ![/login, desktop, after](./.ui/pr/login@desktop-light-after.png) |

Unchanged: \`/\`, \`/setup\`
<!-- /ui-shots -->`,
    );
  });

  test("the dark table goes in a collapsed details below the light one", () => {
    const evidence = comparedEvidence(
      { newRoutes: [], changed: [{ route: "/", score: 1 }], removed: [], unchanged: [] },
      { pathOf, themes: [...both] },
    );
    const fragment = renderFragment(evidence, [...both]);
    assert.match(
      fragment,
      /\| Desktop \| !\[\/, desktop, before\]\(\.\/\.ui\/pr\/index@desktop-light-before\.png\) \| !\[\/, desktop, after\]\(\.\/\.ui\/pr\/index@desktop-light-after\.png\) \|\n\n<details>\n<summary>Dark<\/summary>\n\n\| \| Before \| After \|\n/,
    );
    assert.match(
      fragment,
      /!\[\/, phone, dark, after\]\(\.\/\.ui\/pr\/index@phone-dark-after\.png\)/,
    );
    assert.match(fragment, /\n<\/details>\n/);
  });

  test("a new route gets an After column only", () => {
    const evidence = comparedEvidence(
      { newRoutes: ["/decks/$deckId"], changed: [], removed: [], unchanged: [] },
      { pathOf, themes: [...light] },
    );
    assert.equal(
      renderFragment(evidence, [...light]),
      `<!-- ui-shots -->
#### /decks/$deckId (new)

| | After |
| --- | --- |
| Phone | ![/decks/$deckId, phone, after](./.ui/pr/decks_deck-1@phone-light-after.png) |
| Tablet | ![/decks/$deckId, tablet, after](./.ui/pr/decks_deck-1@tablet-light-after.png) |
| Desktop | ![/decks/$deckId, desktop, after](./.ui/pr/decks_deck-1@desktop-light-after.png) |
<!-- /ui-shots -->`,
    );
  });

  test("removed, unchanged and not-shown routes get a line each", () => {
    const changed = Array.from({ length: 10 }, (_, i) => ({ route: `/c${i}`, score: 1 }));
    const evidence = comparedEvidence(
      { newRoutes: [], changed, removed: ["/old", "/older"], unchanged: ["/"] },
      { pathOf, themes: [...light] },
    );
    const fragment = renderFragment(evidence, [...light]);
    assert.match(
      fragment,
      /\n\nAlso changed \(not shown\): `\/c8`, `\/c9`\n\nRemoved: `\/old`, `\/older`\n\nUnchanged: `\/`\n<!-- \/ui-shots -->$/,
    );
  });

  test("a removed route alone is a visual change", () => {
    const evidence = comparedEvidence(
      { newRoutes: [], changed: [], removed: ["/old"], unchanged: ["/"] },
      { pathOf, themes: [...light] },
    );
    assert.equal(
      renderFragment(evidence, [...light]),
      "<!-- ui-shots -->\nRemoved: `/old`\n\nUnchanged: `/`\n<!-- /ui-shots -->",
    );
    assert.deepEqual(attachments(evidence, [...light]), []);
  });

  test("no changed, new or removed route says No visual changes, with nothing to attach", () => {
    const evidence = comparedEvidence(
      { newRoutes: [], changed: [], removed: [], unchanged: ["/", "/login"] },
      { pathOf, themes: [...light] },
    );
    assert.equal(
      renderFragment(evidence, [...light]),
      "<!-- ui-shots -->\nNo visual changes.\n\nUnchanged: `/`, `/login`\n<!-- /ui-shots -->",
    );
    assert.deepEqual(attachments(evidence, [...light]), []);
  });
});

describe("fallbackEvidence", () => {
  test("shows every route after only, in route-tree order, under a note", () => {
    const evidence = fallbackEvidence({
      base: "0123456789ab",
      reason: "banki seed exited with code 1:\nerror: unknown command seed",
      routes: ["/", "/login"],
      pathOf,
      themes: [...light],
    });
    const fragment = renderFragment(evidence, [...light]);
    assert.ok(
      fragment.startsWith(
        "<!-- ui-shots -->\nNo before shots: the base `0123456789ab` couldn't start (banki seed exited with code 1:). After only.\n\n#### /\n\n| | After |\n",
      ),
      fragment,
    );
    assert.match(fragment, /#### \/login\n\n\| \| After \|/);
    assert.doesNotMatch(fragment, /\(new\)/);
    assert.deepEqual(
      attachments(evidence, [...light]).map(({ file }) => file),
      [
        "index@phone-light-after.png",
        "index@tablet-light-after.png",
        "index@desktop-light-after.png",
        "login@phone-light-after.png",
        "login@tablet-light-after.png",
        "login@desktop-light-after.png",
      ],
    );
  });

  test("routes past the budget go on the Also shot line", () => {
    const routes = Array.from({ length: 20 }, (_, i) => `/r${i}`);
    const evidence = fallbackEvidence({
      base: "0123456789ab",
      reason: "x",
      routes,
      pathOf,
      themes: [...both],
    });
    assert.equal(attachments(evidence, [...both]).length, 48);
    assert.match(
      renderFragment(evidence, [...both]),
      /\n\nAlso shot \(not shown\): `\/r8`, `\/r9`, .*`\/r19`\n<!-- \/ui-shots -->$/,
    );
  });
});

describe("spliceBody", () => {
  const fragment = "<!-- ui-shots -->\nNew shots\n<!-- /ui-shots -->";

  test("replaces whatever is between the markers, in place", () => {
    const body =
      "## Summary\n\nx\n\n## Evidence\n\n<!-- ui-shots -->\nOld shots\n<!-- /ui-shots -->\n\nTests pass.\n";
    assert.equal(
      spliceBody(body, fragment),
      "## Summary\n\nx\n\n## Evidence\n\n<!-- ui-shots -->\nNew shots\n<!-- /ui-shots -->\n\nTests pass.\n",
    );
  });

  test("with no markers, inserts the section at the top of ## Evidence", () => {
    const body = "## Summary\n\nx\n\n## Evidence\n\n- Tests pass.\n\n## Merge Danger\n\nLow\n";
    assert.equal(
      spliceBody(body, fragment),
      `## Summary\n\nx\n\n## Evidence\n\n${fragment}\n\n- Tests pass.\n\n## Merge Danger\n\nLow\n`,
    );
  });

  test("inserts into an empty ## Evidence at the end", () => {
    assert.equal(spliceBody("## Evidence\n", fragment), `## Evidence\n\n${fragment}\n`);
  });

  test("with no ## Evidence, adds one after ## Summary", () => {
    const body = "## Summary\n\nx\n\n### Detail\n\ny\n\n## Merge Danger\n\nLow\n";
    assert.equal(
      spliceBody(body, fragment),
      `## Summary\n\nx\n\n### Detail\n\ny\n\n## Evidence\n\n${fragment}\n\n## Merge Danger\n\nLow\n`,
    );
  });

  test("adds ## Evidence after a ## Summary that ends the body", () => {
    assert.equal(
      spliceBody("## Summary\n\nx\n", fragment),
      `## Summary\n\nx\n\n## Evidence\n\n${fragment}\n`,
    );
  });

  test("with neither heading, adds ## Evidence at the end", () => {
    assert.equal(
      spliceBody("Some text.\n", fragment),
      `Some text.\n\n## Evidence\n\n${fragment}\n`,
    );
    assert.equal(spliceBody("", fragment), `## Evidence\n\n${fragment}\n`);
  });

  test("a ### Evidence heading isn't the Evidence section", () => {
    assert.equal(
      spliceBody("### Evidence\n", fragment),
      `### Evidence\n\n## Evidence\n\n${fragment}\n`,
    );
  });

  test("reads a body with CRLF line endings", () => {
    assert.equal(
      spliceBody("## Evidence\r\n\r\n- Tests pass.\r\n", fragment),
      `## Evidence\n\n${fragment}\n\n- Tests pass.\n`,
    );
  });

  test("an opening marker with no closing one is refused", () => {
    assert.throws(() => spliceBody("<!-- ui-shots -->\nx\n", fragment), /<!-- \/ui-shots -->/);
  });
});
