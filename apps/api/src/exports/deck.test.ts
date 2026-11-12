import { describe, expect, test } from "bun:test";
import { attachment, exportBaseName } from "./deck";

describe("exportBaseName", () => {
  test("keeps a name a file can hold as it is, non-ASCII included", () => {
    expect(exportBaseName("Español B1 (verbs)")).toBe("Español B1 (verbs)");
    expect(exportBaseName("日本語")).toBe("日本語");
  });

  test("turns each character a file name can't hold into -", () => {
    expect(exportBaseName('a/b\\c:d*e?f"g<h>i|j')).toBe("a-b-c-d-e-f-g-h-i-j");
    expect(exportBaseName("tab\there\u0000")).toBe("tab-here-");
  });

  test("a leading dot becomes -, so an import doesn't skip the file as hidden", () => {
    expect(exportBaseName(".NET tips")).toBe("-NET tips");
    expect(exportBaseName("..")).toBe("-.");
    expect(exportBaseName("v1.2")).toBe("v1.2");
  });

  test("a name left blank becomes Deck", () => {
    expect(exportBaseName("")).toBe("Deck");
    expect(exportBaseName("   ")).toBe("Deck");
  });
});

describe("attachment", () => {
  test("gives an ASCII filename and the UTF-8 one, encoded", () => {
    expect(attachment("Español (1).zip")).toBe(
      `attachment; filename="Espa_ol (1).zip"; filename*=UTF-8''Espa%C3%B1ol%20%281%29.zip`,
    );
  });
});
