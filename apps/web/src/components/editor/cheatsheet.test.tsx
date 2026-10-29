import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { Cheatsheet } from "./cheatsheet";
import { COMMANDS, GROUPS } from "./latex-commands";

/** The cheatsheet's markup with `query` typed in its search. */
const markup = (query: string) =>
  renderToStaticMarkup(
    <Cheatsheet query={query} onQuery={() => {}} onInsert={() => {}} onClose={() => {}} />,
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
