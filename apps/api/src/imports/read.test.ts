import { describe, expect, test } from "bun:test";
import {
  IMAGE_MAX_BYTES,
  IMPORT_JSON_MAX_BYTES,
  IMPORT_UPLOAD_MAX_BYTES,
  type NumberedCard,
} from "@banki/shared";
import { makeZip } from "../testing/zip";
import {
  type ImageStatus,
  type ReadFile,
  type Refused,
  duplicatesOf,
  imageProblems,
  planMacros,
  readUpload,
} from "./read";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

const bytes = (text: string) => new TextEncoder().encode(text);

const card = (front: string, back = "b", more: Partial<NumberedCard> = {}) => ({
  front,
  back,
  tags: [],
  gradingNotes: null,
  ...more,
});

const fileText = (cards: unknown[], macros: unknown[] = []) =>
  JSON.stringify({ $schema: null, format: "banki", version: 1, macros, cards });

const read = (result: ReadFile | Refused): ReadFile => {
  if ("problems" in result) throw new Error(result.problems.map((p) => p.text).join("\n"));
  return result;
};

const problems = (result: ReadFile | Refused) =>
  "problems" in result ? result.problems.map((p) => p.text) : [];

describe("readUpload", () => {
  test("reads pasted JSON into numbered Cards and invalid Cards", () => {
    const result = read(
      readUpload(bytes(fileText([card("a"), { front: "b" }, card("c")])), "paste"),
    );
    expect(result.source).toBe("paste");
    expect(result.total).toBe(3);
    expect(result.cards.map((c) => [c.number, c.front])).toEqual([
      [1, "a"],
      [3, "c"],
    ]);
    expect(result.invalid.map((c) => c.number)).toEqual([2]);
    expect(result.images.size).toBe(0);
  });

  test("a chosen .json is read as JSON", () => {
    expect(read(readUpload(bytes(fileText([card("a")])), "file")).source).toBe("json");
  });

  test("a fenced paste is refused as not JSON, unrepaired", () => {
    const text = `\`\`\`json\n${fileText([card("a")])}\n\`\`\``;
    expect(problems(readUpload(bytes(text), "paste"))[0]).toStartWith("file: Not valid JSON");
  });

  test("a bad envelope or a bad macro refuses the file", () => {
    expect(
      problems(readUpload(bytes(JSON.stringify({ format: "anki" })), "paste")).length,
    ).toBeGreaterThan(0);
    expect(
      problems(readUpload(bytes(fileText([], [{ name: "R", definition: "x" }])), "paste"))[0],
    ).toStartWith("macro 1");
  });

  test("over 1,000 cards, valid or not, is refused whole", () => {
    const cards = Array.from({ length: 1_001 }, (_, i) => (i % 2 ? card(`c${i}`) : {}));
    expect(problems(readUpload(bytes(fileText(cards)), "paste"))).toEqual([
      'file: "cards" holds 1,001 cards, and an import can take up to 1,000: split the file',
    ]);
    expect("cards" in readUpload(bytes(fileText(cards.slice(0, 1_000))), "paste")).toBe(true);
  });

  test("JSON over 20 MB is refused, pasted or chosen", () => {
    const big = new Uint8Array(IMPORT_JSON_MAX_BYTES + 1).fill(0x20);
    expect(problems(readUpload(big, "paste"))[0]).toContain("can be up to 20.0 MB");
    expect(problems(readUpload(big, "file"))[0]).toContain("can be up to 20.0 MB");
  });

  test("an upload over 500 MB is refused before it is read", () => {
    const huge = new Uint8Array(IMPORT_UPLOAD_MAX_BYTES + 1);
    expect(problems(readUpload(huge, "file"))[0]).toContain("an import can be up to 500.0 MB");
  });

  describe("a zip", () => {
    test("reads its one .json at any depth, and the images beside it that Cards refer to", () => {
      const zip = makeZip([
        { name: "__MACOSX/deck/._cards.json", data: "junk" },
        { name: "deck/.hidden.json", data: "junk" },
        {
          name: "deck/cards.json",
          data: fileText([card("a", "![](images/a.png)"), card("b", "![](images/gone.png)")]),
        },
        { name: "deck/images/a.png", data: PNG, stored: true },
        { name: "deck/images/unused.png", data: PNG },
        { name: "images/a.png", data: "not beside the json" },
      ]);
      const result = read(readUpload(zip, "file"));
      expect(result.source).toBe("zip");
      expect(result.cards).toHaveLength(2);
      expect([...result.images.keys()]).toEqual(["a.png"]);
      expect(result.images.get("a.png")).toEqual({ status: "ok", bytes: PNG });
    });

    test("an image over 5 MB or of another format is a problem, not a refusal", () => {
      const zip = makeZip([
        {
          name: "cards.json",
          data: fileText([card("a", "![](images/big.png) ![](images/menu.heic)")]),
        },
        { name: "images/big.png", data: new Uint8Array(IMAGE_MAX_BYTES + 1) },
        { name: "images/menu.heic", data: "ftypheic" },
      ]);
      const result = read(readUpload(zip, "file"));
      expect(result.images.get("big.png")?.status).toBe("too_large");
      expect(result.images.get("menu.heic")?.status).toBe("unsupported");
    });

    test("with no .json, or two, it is refused", () => {
      expect(problems(readUpload(makeZip([{ name: "images/a.png", data: PNG }]), "file"))).toEqual([
        "file: The zip holds no .json Card file",
      ]);
      expect(
        problems(
          readUpload(
            makeZip([
              { name: "a.json", data: fileText([]) },
              { name: "b/c.json", data: fileText([]) },
            ]),
            "file",
          ),
        ),
      ).toEqual(["file: The zip holds 2 .json files, and an import reads one: a.json, b/c.json"]);
    });

    test("one that unpacks to over 500 MB is refused before it is unpacked", () => {
      const zip = makeZip([
        { name: "a.json", data: fileText([]), claim: IMPORT_UPLOAD_MAX_BYTES },
        { name: "b.bin", data: "x", claim: 10 },
      ]);
      expect(problems(readUpload(zip, "file"))[0]).toStartWith("file: The zip unpacks to 500.1 MB");
    });

    test("its .json over 20 MB is refused", () => {
      const zip = makeZip([{ name: "a.json", data: "{}", claim: IMPORT_JSON_MAX_BYTES + 1 }]);
      expect(problems(readUpload(zip, "file"))[0]).toContain("can be up to 20.0 MB");
    });

    test("a damaged one is refused with what is wrong", () => {
      const zip = makeZip([{ name: "a.json", data: fileText([]) }]);
      expect(problems(readUpload(zip.subarray(0, zip.length - 10), "file"))[0]).toStartWith(
        "file: This zip can't be read",
      );
    });
  });
});

describe("planMacros", () => {
  const settings = [{ name: "\\R", definition: "\\mathbb{R}" }];
  const own = [{ name: "\\eps", definition: "\\varepsilon" }];

  test("leaves out the identical, adds the new, keeps the Deck's where they differ", () => {
    expect(
      planMacros(
        [
          { name: "\\R", definition: "\\mathbb{R}" },
          { name: "\\m", definition: "m." },
          { name: "\\eps", definition: "\\epsilon" },
        ],
        settings,
        own,
      ),
    ).toEqual([
      { name: "\\m", definition: "m.", outcome: "added" },
      { name: "\\eps", definition: "\\epsilon", outcome: "kept", deckDefinition: "\\varepsilon" },
    ]);
  });

  test("a definition over 1,000 characters, or one past the Deck's 100, isn't added", () => {
    const full = Array.from({ length: 99 }, (_, i) => ({
      name: `\\o${"x".repeat(i + 1)}`,
      definition: "o",
    }));
    const plan = planMacros(
      [
        { name: "\\long", definition: "x".repeat(1_001) },
        { name: "\\a", definition: "a" },
        { name: "\\b", definition: "b" },
      ],
      [],
      full,
    );
    expect(plan.map((entry) => [entry.name, entry.outcome])).toEqual([
      ["\\long", "not_added"],
      ["\\a", "added"],
      ["\\b", "not_added"],
    ]);
  });
});

describe("imageProblems", () => {
  const cards = [
    { number: 1, ...card("![](images/a.png)", "![](images/a.png) ![](images/old.png)") },
    { number: 2, ...card("x", "![](images/big.png) ![](images/none.png)") },
  ];
  const images = new Map<string, ImageStatus>([
    ["a.png", "staged"],
    ["big.png", { problem: "too_large", message: "big" }],
  ]);

  test("names each Card's missing, oversized or unsupported image, once, but not an existing Image", () => {
    expect(imageProblems(cards, images, true, (file) => file === "old.png")).toEqual([
      { card: 2, reference: "images/big.png", problem: "too_large", message: "big" },
      {
        card: 2,
        reference: "images/none.png",
        problem: "missing",
        message: "The zip has no images/none.png.",
      },
    ]);
  });

  test("without a zip, every reference but an existing Image is missing", () => {
    expect(
      imageProblems(cards.slice(0, 1), new Map(), false, () => false).map((p) => p.reference),
    ).toEqual(["images/a.png", "images/old.png"]);
  });
});

describe("duplicatesOf", () => {
  test("marks Cards repeating the Deck or an earlier Card of the file, the first winning", () => {
    const cards = [
      { number: 1, ...card("el mercado") },
      { number: 2, ...card("La Cuenta") },
      { number: 4, ...card("*El* mercado") },
      { number: 5, ...card("pesar") },
    ];
    expect(duplicatesOf(cards, [{ id: "c1", front: "la cuenta" }])).toEqual([
      null,
      { cardId: "c1", front: "la cuenta" },
      { number: 1, front: "el mercado" },
      null,
    ]);
  });
});
