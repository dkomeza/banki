import { describe, expect, test } from "bun:test";
import { frontKey } from "./front-key";

/** Whether two Fronts compare alike. */
const same = (a: string, b: string) => frontKey(a) === frontKey(b);

describe("frontKey", () => {
  test("composes Unicode to NFC", () => {
    expect(same("café", "café")).toBe(true);
    expect(frontKey("é")).toBe("é");
  });

  describe("math", () => {
    test("keeps its content and drops its delimiters, alike in each kind", () => {
      expect(frontKey("$x_1$")).toBe("x_1");
      expect(same("$x_1$", "$$x_1$$")).toBe(true);
      expect(same("$x_1$", "\\(x_1\\)")).toBe(true);
      expect(same("$x_1$", "\\[x_1\\]")).toBe(true);
    });

    test("drops the whitespace inside it", () => {
      expect(same("$\\frac {1}{2}$", "$\\frac{1}{2}$")).toBe(true);
      expect(same("$$\n  a + b\n$$", "$a+b$")).toBe(true);
    });

    test("keeps what is inside as written: its marks and its case", () => {
      expect(same("$x_1$", "$x1$")).toBe(false);
      expect(same("$a*b$", "$ab$")).toBe(false);
      expect(same("$X$", "$x$")).toBe(false);
      expect(frontKey("Solve $\\Delta X$ for **X**")).toBe("solve \\DeltaX for x");
    });

    test("differs from the same characters written as text", () => {
      expect(same("$x_1$", "x_1")).toBe(false);
    });

    test("needs a closing delimiter, else the dollar is text", () => {
      expect(frontKey("costs $5")).toBe("costs $5");
      expect(frontKey("$5 and $10")).toBe("$5 and $10");
      expect(frontKey("$$ x")).toBe("$$ x");
      expect(frontKey("\\(x")).toBe("(x");
    });

    test("opens only on something other than whitespace, and closes only after it", () => {
      expect(frontKey("$ x$")).toBe("$ x$");
      expect(frontKey("$x $")).toBe("$x $");
    });

    test("counts an escaped dollar as a dollar, never as a delimiter", () => {
      expect(frontKey("\\$x\\$")).toBe("$x$");
      expect(same("\\$x\\$", "$x$")).toBe(false);
    });
  });

  describe("Markdown outside math", () => {
    test("drops emphasis, strike and code marks", () => {
      expect(same("**Define** a _group_", "Define a group")).toBe(true);
      expect(same("~~old~~ *new*", "old new")).toBe(true);
      expect(same("`map` over a list", "map over a list")).toBe(true);
    });

    test("drops heading, quote and list markers at a line's start", () => {
      expect(frontKey("# Heading")).toBe("heading");
      expect(frontKey("### Heading")).toBe("heading");
      expect(frontKey("> quoted")).toBe("quoted");
      expect(frontKey("- one\n* two\n+ three\n1. four\n2) five")).toBe("one two three four five");
      expect(frontKey("> - nested")).toBe("nested");
    });

    test("keeps those characters anywhere else", () => {
      expect(frontKey("C# is a language")).toBe("c# is a language");
      expect(frontKey("#hashtag")).toBe("#hashtag");
      expect(frontKey("a > b - c + d")).toBe("a > b - c + d");
      expect(frontKey("1.5 litres")).toBe("1.5 litres");
    });

    test("keeps a link's text", () => {
      expect(same("[derivative](http://example.com/d)", "derivative")).toBe(true);
      expect(same('the [chain rule](https://x.org "Chain") in use', "the chain rule in use")).toBe(
        true,
      );
    });

    test("keeps an image's URL", () => {
      expect(same("![](a.png)", "![](b.png)")).toBe(false);
      expect(same("![](a.png)", "![](a.png)")).toBe(true);
      expect(frontKey("What is ![](Leaf.PNG)?")).toBe("what is ![](Leaf.PNG)?");
    });

    test("counts a backslash-escaped mark as the character itself", () => {
      expect(frontKey("2 \\* 3")).toBe("2 * 3");
      expect(same("2 \\* 3", "2 * 3")).toBe(false);
      expect(frontKey("\\# not a heading")).toBe("# not a heading");
      expect(frontKey("\\[not a link](x)")).toBe("[not a link](x)");
      expect(frontKey("a \\\\ b")).toBe("a \\ b");
    });

    test("compares HTML and everything else as written", () => {
      expect(frontKey("<b>bold</b>")).toBe("<b>bold</b>");
      expect(same("<b>bold</b>", "bold")).toBe(false);
    });
  });

  test("collapses each run of whitespace to one space and trims the ends", () => {
    expect(same("el   desayuno\n", "El desayuno")).toBe(true);
    expect(frontKey(" \t a \n\n b \t")).toBe("a b");
    expect(same("a lot", "alot")).toBe(false);
  });

  test("folds case as Deck names do, keeping accents", () => {
    expect(same("Straße", "STRASSE")).toBe(true);
    expect(same("El Desayuno", "el desayuno")).toBe(true);
    expect(same("si", "sí")).toBe(false);
    expect(same("el", "él")).toBe(false);
  });

  test("is empty for a Front of marks or whitespace alone", () => {
    expect(frontKey("**")).toBe("");
    expect(frontKey(" _ ~ ` \n")).toBe("");
    expect(frontKey("#")).toBe("");
  });

  test("leaves a private-use character that isn't a placeholder alone", () => {
    expect(frontKey("7")).toBe("7");
  });
});
