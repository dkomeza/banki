import { describe, expect, test } from "bun:test";
import { redact } from "./redact";

// Fake values, built at runtime so secret scanners don't flag them.
const SECRET = ["fake", "client", "secret"].join("-");
const TOKEN = ["ghs", "faketokenvalue"].join("_");
const KEY = [
  "-----BEGIN RSA PRIVATE KEY-----",
  "MIIEfakekeyline1",
  "-----END RSA PRIVATE KEY-----",
];

describe("redact", () => {
  test("replaces every secret it is given, wherever it appears", () => {
    expect(redact(`a ${SECRET} b ${TOKEN} c ${SECRET}`, [SECRET, TOKEN])).toBe(
      "a [redacted] b [redacted] c [redacted]",
    );
  });

  test("replaces each line of a multi-line key on its own", () => {
    expect(redact("saw MIIEfakekeyline1 in the body", [KEY.join("\n")])).toBe(
      "saw [redacted] in the body",
    );
  });

  test("leaves short values alone, which would match ordinary words", () => {
    expect(redact("HTTP 401 abc", ["abc", ""])).toBe("HTTP 401 abc");
  });
});
