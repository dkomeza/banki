import { describe, expect, it } from "vitest";
import { cleanTex, containsMath, mathInputPreview, normalizeMathMarkup } from "@/lib/math";

describe("math markup", () => {
  it("converts Anki legacy inline and display markers", () => {
    expect(normalizeMathMarkup("A [$]x^2[/$] and [$$]\\sum_i x_i[/$$]")).toBe("A \\(x^2\\) and \\[\\sum_i x_i\\]");
  });

  it("recognizes TeX and unicode math", () => {
    expect(containsMath("Solve \\(x+1=0\\)")).toBe(true);
    expect(containsMath("∑ αᵢ ≤ ∞")).toBe(true);
  });

  it("neutralizes unsafe TeX commands", () => {
    expect(cleanTex("\\input{/etc/passwd}")).toContain("unsupported command");
    expect(cleanTex("\\sqrt{x}")).toBe("\\sqrt{x}");
  });

  it("creates an HTML-safe preview while preserving line breaks", () => {
    expect(mathInputPreview('<img src=x>\n\\(x^2 & y\\)')).toBe("&lt;img src=x&gt;<br>\\(x^2 &amp; y\\)");
  });
});
