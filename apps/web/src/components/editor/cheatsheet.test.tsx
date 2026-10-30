import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { Cheatsheet } from "./cheatsheet";
import { COMMANDS, GROUPS } from "./latex-commands";

const MACROS = [
  { name: "\\norm", definition: "\\left\\| #1 \\right\\|" },
  { name: "\\eps", definition: "\\varepsilon" },
];

/** The cheatsheet's markup with `query` typed in its search, and the Deck's `macros`. */
const markup = (query: string, macros: readonly { name: string; definition: string }[] = []) =>
  renderToStaticMarkup(
    <Cheatsheet
      query={query}
      macros={macros}
      onQuery={() => {}}
      onInsert={() => {}}
      onClose={() => {}}
      onLeave={() => {}}
    />,
  );

/** The commands its entries insert, in order. */
const entries = (html: string) =>
  [...html.matchAll(/<button[^>]*class="cheatsheet-tile"[^>]*aria-label="([^"]*?), /g)].map(
    ([, name]) => name?.replaceAll("&amp;", "&"),
  );

describe("the cheatsheet", () => {
  test("is a dialog named by its title, with a labelled search", () => {
    const html = markup("");

    expect(html).toMatch(/role="dialog" aria-labelledby="([^"]+)"/);
    expect(html).toContain("LaTeX cheatsheet");
    expect(html).toMatch(/<span class="sr-only">Search commands<\/span><input[^>]*type="search"/);
  });

  test("lists every command, as buttons grouped in order", () => {
    const html = markup("");
    const sections = [...html.matchAll(/<section data-group="([^"]+)"/g)].map(([, group]) => group);

    expect(sections).toEqual([...GROUPS]);
    expect(entries(html)).toEqual(
      GROUPS.flatMap((group) => COMMANDS.filter((command) => command.group === group)).map(
        ({ name }) => name,
      ),
    );
  });

  test("shows each entry's render, command and meaning", () => {
    const html = markup("");

    expect(html).toMatch(
      /<span aria-hidden="true" class="cheatsheet-render"><span class="katex">.*?<\/span><span class="cheatsheet-name">\\alpha<\/span><span class="cheatsheet-meaning">Alpha<\/span>/,
    );
  });

  test("has a chip per group to jump to, the first current", () => {
    const html = markup("");
    const chips = [...html.matchAll(/class="cheatsheet-chip" data-label="([^"]+)"/g)];

    expect(chips.map(([, group]) => group)).toEqual([...GROUPS]);
    expect(html).toMatch(/aria-current="true" class="cheatsheet-chip" data-label="Greek"/);
  });

  test("finds by meaning as the User types", () => {
    const found = entries(markup("integral"));

    expect(found).toContain("\\int");
    expect(found).not.toContain("\\alpha");
  });

  test("hides the chips while searching", () => {
    expect(markup("integral")).not.toContain("cheatsheet-chip");
  });

  test("says so when nothing is found", () => {
    const html = markup("qwerty");

    expect(entries(html)).toEqual([]);
    expect(html).toContain("Nothing matches “qwerty”.");
  });
});

describe("the cheatsheet's Macros", () => {
  test("come first, in a group of their own with its chip, current", () => {
    const html = markup("", MACROS);
    const sections = [...html.matchAll(/<section data-group="([^"]+)"/g)].map(([, group]) => group);
    const chips = [...html.matchAll(/class="cheatsheet-chip" data-label="([^"]+)"/g)];

    expect(sections).toEqual(["Macros", ...GROUPS]);
    expect(chips.map(([, group]) => group)).toEqual(["Macros", ...GROUPS]);
    expect(html).toMatch(/aria-current="true" class="cheatsheet-chip" data-label="Macros"/);
    expect(entries(html).slice(0, 2)).toEqual(["\\norm", "\\eps"]);
  });

  test("show each Macro's render with sample arguments, its name and its definition", () => {
    const html = markup("", MACROS);

    expect(html).toContain('<annotation encoding="application/x-tex">\\norm{x}</annotation>');
    expect(html).toContain(
      '<span class="cheatsheet-name">\\norm</span><span class="cheatsheet-meaning">\\left\\| #1 \\right\\|</span>',
    );
  });

  test("are found by name and by definition", () => {
    expect(entries(markup("norm", MACROS))).toContain("\\norm");
    expect(entries(markup("varepsilon", MACROS))).toContain("\\eps");
  });

  test("aren't a group without any", () => {
    expect(markup("")).not.toContain('data-group="Macros"');
  });
});
