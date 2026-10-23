import { describe, expect, test } from "bun:test";
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { appJwt, appJwtClaims, importAppKey } from "./jwt";

// The GitHub App's JWT (RS256, signed with WebCrypto). The keys are made here,
// in the two PEM forms GitHub has handed out: PKCS#1 (`BEGIN RSA PRIVATE KEY`,
// what a new App key download is) and PKCS#8.

const NOW = new Date("2026-10-23T12:00:00.000Z");
const NOW_S = NOW.getTime() / 1000;

function keyPair(type: "pkcs1" | "pkcs8") {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type, format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  return { privateKey, publicKey };
}

const decode = (part: string): unknown => JSON.parse(Buffer.from(part, "base64url").toString());

describe("the App JWT's claims", () => {
  test("are issued by the App, backdated a minute for clock drift, and expire 10 minutes after that", () => {
    expect(appJwtClaims("123456", NOW)).toEqual({
      iss: "123456",
      iat: NOW_S - 60,
      exp: NOW_S + 9 * 60,
    });
  });

  test("count whole seconds", () => {
    const claims = appJwtClaims("1", new Date(NOW.getTime() + 999));

    expect(claims.iat).toBe(NOW_S - 60);
  });
});

describe.each(["pkcs1", "pkcs8"] as const)("a JWT signed with a %s key", (type) => {
  test("is RS256 and verifies with the App's public key", async () => {
    const { privateKey, publicKey } = keyPair(type);

    const jwt = await appJwt("42", await importAppKey(privateKey), NOW);

    const [header = "", payload = "", signature = ""] = jwt.split(".");
    expect(decode(header)).toEqual({ alg: "RS256", typ: "JWT" });
    expect(decode(payload)).toEqual({ iss: "42", iat: NOW_S - 60, exp: NOW_S + 540 });
    expect(
      verify(
        "sha256",
        Buffer.from(`${header}.${payload}`),
        createPublicKey(publicKey),
        Buffer.from(signature, "base64url"),
      ),
    ).toBe(true);
  });
});

describe("importing the App's key", () => {
  test("accepts a PEM with surrounding whitespace and CRLF line ends", async () => {
    const { privateKey } = keyPair("pkcs1");

    await importAppKey(`\n${privateKey.replaceAll("\n", "\r\n")}\n`);
  });

  test("refuses what isn't an RSA private key, without echoing it", async () => {
    const notAKey = [
      "-----BEGIN CERTIFICATE-----",
      "c2VjcmV0LWJ5dGVz",
      "-----END CERTIFICATE-----",
    ];

    const error = await importAppKey(notAKey.join("\n")).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain("not a PEM private key");
    expect(String(error)).not.toContain("c2VjcmV0LWJ5dGVz");
  });

  test("refuses a broken key, without echoing it", async () => {
    const broken = ["-----BEGIN RSA PRIVATE KEY-----", "c2VjcmV0", "-----END RSA PRIVATE KEY-----"];

    const error = await importAppKey(broken.join("\n")).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain("c2VjcmV0");
  });
});
