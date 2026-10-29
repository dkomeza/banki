import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { CardLine, CardText } from "./card-text";

const html = (text: string) => renderToStaticMarkup(<CardText text={text} />);
const line = (text: string) => renderToStaticMarkup(<CardLine text={text} />);
const live = (text: string) => renderToStaticMarkup(<CardText text={text} interactive />);

/** The HTML with each piece of KaTeX's output as `{math}`, for checking what's around it. */
function outside(markup: string): string {
  const open = '<span class="katex">';
  let out = "";
  let pos = 0;
  for (let start = markup.indexOf(open); start !== -1; start = markup.indexOf(open, pos)) {
    out += `${markup.slice(pos, start)}{math}`;
    // Skip to the span closing this one.
    const tags = /<span[ >]|<\/span>/g;
    tags.lastIndex = start;
    let depth = 0;
    for (let tag = tags.exec(markup); tag !== null; tag = tags.exec(markup)) {
      depth += tag[0] === "</span>" ? -1 : 1;
      if (depth === 0) {
        pos = tags.lastIndex;
        break;
      }
    }
  }
  return out + markup.slice(pos);
}

describe("CardText", () => {
  test("typesets a Formula with KaTeX, as HTML plus hidden MathML", () => {
    const out = html("Let $x^2$ be");
    expect(out).toContain('class="katex"');
    expect(out).toContain('class="katex-mathml"');
    expect(out).toContain('<annotation encoding="application/x-tex">x^2</annotation>');
    expect(outside(out)).toContain("Let <span>{math}</span> be");
  });

  test("typesets a display Formula left-aligned, in a box of its own that scrolls", () => {
    const out = html("$$\n\\sum_{n=0}^\\infty x^n\n$$");
    expect(out).toContain("katex-display fleqn");
    expect(out).toContain('tabindex="-1"');
    expect(out).toContain("overflow-x-auto");
  });

  test("shows broken LaTeX as its source in red with the error after it, and the rest renders", () => {
    const out = html("**Half:** $\\fracc{1}{2}$ and $y$");
    expect(out).toContain('<span class="text-destructive">');
    expect(out).toContain("$\\fracc{1}{2}$");
    expect(out).toContain("Undefined control sequence: \\fracc");
    expect(out).toContain("<strong>Half:</strong>");
    expect(out).toContain('<annotation encoding="application/x-tex">y</annotation>');
  });

  test("typesets mhchem's \\ce and \\pu", () => {
    const out = html("$\\ce{2H2 + O2 -> 2H2O}$ at $\\pu{298 K}$");
    expect(out).not.toContain("text-destructive");
    expect(out.match(/class="katex"/g)).toHaveLength(2);
  });

  test("typesets align, cases and matrices", () => {
    const out = html(
      [
        "$$\\begin{align}a &= b \\\\ c &= d\\end{align}$$",
        "$$f(x) = \\begin{cases} 1 & x > 0 \\\\ 0 & \\text{else}\\end{cases}$$",
        "$$\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}$$",
      ].join("\n"),
    );
    expect(out).not.toContain("text-destructive");
    expect(out.match(/class="katex-display/g)).toHaveLength(3);
  });

  test("runs with trust off: \\href and \\includegraphics don't run", () => {
    const out = html("$\\href{javascript:alert(1)}{x}$ $\\includegraphics{x.png}$");
    expect(out).not.toContain("<a ");
    expect(out).not.toContain("<img");
    expect(out).not.toContain("href=");
  });

  test("keeps a Formula's \\def inside it", () => {
    const out = html("$\\def\\foo{x}\\foo$ and $\\foo$");
    expect(out).toContain("Undefined control sequence: \\foo");
  });

  test("stops a runaway macro at KaTeX's expansion limit", () => {
    const out = html("$\\def\\a{\\a\\a}\\a$");
    expect(out).toContain("text-destructive");
    expect(out).toContain("Too many expansions");
  });

  test("renders raw HTML as text, never as HTML", () => {
    const out = html('<img src=x onerror="alert(1)"> <b>bold</b>\n\n<script>alert(1)</script>');
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<b>");
    expect(out).not.toContain("<script");
    expect(out).toContain("&lt;b&gt;bold&lt;/b&gt;");
    expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  test("makes every newline a line break and a blank line a new paragraph", () => {
    expect(html("one\n  two\n\nthree")).toBe(
      '<div class="card-text flex flex-col gap-2 [overflow-wrap:anywhere]"><p>one<br/>two</p><p>three</p></div>',
    );
  });

  test('shows \\$ as a dollar sign and "$5 and $10" as text', () => {
    expect(html("It costs \\$3")).toContain("<p>It costs $3</p>");
    expect(html("costs $5 and $10")).toContain("<p>costs $5 and $10</p>");
  });

  test("renders Markdown: emphasis, lists, code, tables", () => {
    const out = html(
      [
        "*a* **b** ~~c~~ `$x$`",
        "",
        "- one",
        "- two",
        "",
        "3. three",
        "",
        "```",
        "<code> & $y$",
        "```",
        "",
        "| a | b |",
        "| :-: | - |",
        "| $z$ | 2 |",
      ].join("\n"),
    );
    expect(out).toContain("<em>a</em> <strong>b</strong> <s>c</s>");
    expect(out).toContain(">$x$</code>");
    expect(out).toMatch(/<ul[^>]*><li[^>]*><p>one<\/p><\/li><li[^>]*><p>two<\/p><\/li><\/ul>/);
    expect(out).toMatch(/<ol start="3"/);
    expect(out).toContain("<code>&lt;code&gt; &amp; $y$</code></pre>");
    expect(out).toMatch(/<th style="text-align:center"[^>]*>a<\/th>/);
    expect(out).toContain('<annotation encoding="application/x-tex">z</annotation>');
  });

  test("renders links as underlined text, never a nested link", () => {
    const out = html("[see $x$](https://example.com) <https://example.org>");
    expect(out).not.toContain("<a ");
    expect(out).not.toContain("href");
    expect(outside(out)).toContain(
      '<span class="underline underline-offset-2">see <span>{math}</span></span>',
    );
    expect(out).toContain('<span class="underline underline-offset-2">https://example.org</span>');
  });

  test("renders images lazily, within the card's width", () => {
    const out = html("![a cell](/img/cell.png)");
    expect(out).toContain('<img src="/img/cell.png" alt="a cell" loading="lazy"');
    expect(out).toContain("max-w-full");
  });

  test("loads an Image's reference, images/<file>, from the API", () => {
    const out = html("![](images/5eed.png) ![](notes/images/a.png)");
    expect(out).toContain('<img src="/api/images/5eed.png"');
    expect(out).toContain('<img src="notes/images/a.png"');
  });

  test("renders headings as bold lines, not headings of the page", () => {
    const out = html("# Title\n\nSub\n---");
    expect(out).not.toMatch(/<h\d/);
    expect(out).toContain("font-semibold");
    expect(out).toContain(">Title</p>");
    expect(out).toContain(">Sub</p>");
  });

  test("marks the words searched for in text and code, ignoring case and accents, not in Formulas", () => {
    const out = renderToStaticMarkup(
      <CardText text={"**Árbol** grande, `arbol()` and $arbol$"} words={["arbol"]} />,
    );
    const marks = out.match(/<mark[^>]*>[^<]*<\/mark>/g) ?? [];
    expect(marks.map((mark) => mark.replace(/<[^>]*>/g, ""))).toEqual(["Árbol", "arbol"]);
    expect(out).toContain("<strong><mark");
    expect(out).toContain("<code");
    expect(outside(out)).not.toContain("{math}<mark");
    expect(html("**Árbol**")).not.toContain("<mark");
  });
});

describe("CardLine", () => {
  test("renders the first line with something on it, inline, cut by an ellipsis", () => {
    expect(line("\n\n**Bold** start\nsecond line")).toBe(
      '<span class="card-text block truncate"><strong>Bold</strong> start</span>',
    );
  });

  test("keeps each Formula whole, so the ellipsis never cuts one", () => {
    const out = line("When does $\\sum \\frac{1}{n^p}$ converge?");
    expect(outside(out)).toBe(
      '<span class="card-text block truncate">When does <span class="inline-block">{math}</span> converge?</span>',
    );
  });

  test("typesets a display Formula inline-sized", () => {
    const out = line("$$\\int_0^1 x\\,dx$$\nmore");
    expect(out).toContain('class="katex"');
    expect(out).not.toContain("katex-display");
  });

  test("ends at a line break inside a paragraph, even inside emphasis", () => {
    expect(line("*one\ntwo*")).toBe('<span class="card-text block truncate"><em>one</em></span>');
  });

  test("reads the first line out of a list or a quote", () => {
    expect(line("- first\n- second")).toBe('<span class="card-text block truncate">first</span>');
    expect(line("> quoted\n> more")).toBe('<span class="card-text block truncate">quoted</span>');
  });

  test("shows a broken Formula's red source as text the ellipsis may cut, its message on hover", () => {
    expect(line("The derivative of $\\fracc{1}{x}$")).toBe(
      '<span class="card-text block truncate">The derivative of <span title="Undefined control sequence: \\fracc" class="font-mono text-[0.9em] text-destructive">$\\fracc{1}{x}$</span></span>',
    );
  });

  test("shows an image as its alt text", () => {
    expect(line("![a cell](/cell.png) under a microscope")).toBe(
      '<span class="card-text block truncate">a cell under a microscope</span>',
    );
  });
});

describe("CardText's tables", () => {
  test("keep an empty cell in its column", () => {
    const out = html("|  | ser |\n| --- | --- |\n| yo | soy |\n| a |  |");
    expect(out).toMatch(/<thead><tr><th[^>]*><\/th><th[^>]*>ser<\/th><\/tr><\/thead>/);
    expect(out).toMatch(/<tr><td[^>]*>yo<\/td><td[^>]*>soy<\/td><\/tr>/);
    expect(out).toMatch(/<tr><td[^>]*>a<\/td><td[^>]*><\/td><\/tr>/);
  });

  test("read without outer pipes", () => {
    const out = html("a | b\n--- | ---\n1 | 2");
    expect(out).toMatch(/<tr><td[^>]*>1<\/td><td[^>]*>2<\/td><\/tr>/);
  });
});

describe("CardText, interactive (the study screen's revealed Card)", () => {
  test("renders links as real links, opening in a new tab", () => {
    const out = live("[see $x$](https://example.com) <https://example.org>");
    expect(out).toContain(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer" class="underline underline-offset-2">see ',
    );
    expect(out).toContain(
      '<a href="https://example.org" target="_blank" rel="noopener noreferrer" class="underline underline-offset-2">https://example.org</a>',
    );
  });

  test("keeps a link that isn't to the web as underlined text", () => {
    const out = live("[run](javascript:alert(1)) and [here](notes.md)");
    expect(out).not.toContain("<a ");
    expect(out).not.toContain("href");
  });

  test("gives each Formula its source with its delimiters, as written, to copy", () => {
    const out = live("Let $x^2$ be\n\n$$\n\\sum_n a_n\n$$\n\nand $$y$$ inline");
    expect(out).toContain('data-formula="$x^2$"');
    expect(out).toContain('data-formula="$$\n\\sum_n a_n\n$$"');
    expect(out).toContain('data-formula="$$y$$"');
  });

  test("anywhere else, Formulas have nothing to copy", () => {
    expect(html("Let $x^2$ be\n\n$$\ny\n$$")).not.toContain("data-formula");
    expect(line("Let $x^2$ be")).not.toContain("data-formula");
  });
});
