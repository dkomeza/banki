import { describe, expect, it } from "vitest";
import { renderAnkiCard, sanitizeCardHtml } from "@/lib/anki-template";

const model = {
  css: ".card { color: navy } @import url(https://bad.test/x.css);",
  flds: [{ name: "Text", ord: 0 }, { name: "Extra", ord: 1 }],
  tmpls: [{ name: "Cloze", ord: 0, qfmt: "{{cloze:Text}}", afmt: "{{FrontSide}}<hr>{{cloze:Text}} {{#Extra}}{{Extra}}{{/Extra}}" }],
};

describe("Anki template renderer", () => {
  it("renders cloze prompts and answers while preserving math", () => {
    const card = renderAnkiCard(model, ["Euler: {{c1::\\(e^{i\\pi}+1=0\\)::identity}}", "∑ √ ∞"], 0);
    expect(card?.frontHtml).toContain("[identity]");
    expect(card?.frontHtml).not.toContain("\\(e^{i\\pi}+1=0\\)");
    expect(card?.backHtml).toContain("\\(e^{i\\pi}+1=0\\)");
    expect(card?.backHtml).toContain("<mark class=\"cloze\">");
    expect(card?.backHtml).toContain("∑ √ ∞");
    expect(card?.frontHtml).not.toContain("@import");
  });

  it("removes scripts and unsafe event handlers", () => {
    const clean = sanitizeCardHtml('<img src="x.png" onerror="alert(1)"><script>alert(1)</script>');
    expect(clean).toContain("<img");
    expect(clean).not.toContain("onerror");
    expect(clean).not.toContain("script");
  });
});
