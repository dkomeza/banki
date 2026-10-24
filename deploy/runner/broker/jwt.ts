// The GitHub App's JWT (ADR-0012), which the broker trades for installation
// tokens. RS256, signed with WebCrypto: the broker has no npm dependencies.
// The key never leaves this module's CryptoKey, and no error here quotes it.

/** What GitHub wants in an App JWT: the App, backdated for clock drift, at most 10 minutes long. */
export type AppJwtClaims = { iss: string; iat: number; exp: number };

/** How far `iat` is backdated, as GitHub recommends for clocks that drift. */
const BACKDATE_S = 60;
/** GitHub's limit on how long an App JWT may live. */
const LIFETIME_S = 10 * 60;

export function appJwtClaims(appId: string, now: Date): AppJwtClaims {
  const iat = Math.floor(now.getTime() / 1000) - BACKDATE_S;
  return { iss: appId, iat, exp: iat + LIFETIME_S };
}

const ALGORITHM = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

/** An App JWT for `appId`, signed with its key, good from `now`. */
export async function appJwt(appId: string, key: CryptoKey, now: Date): Promise<string> {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify(appJwtClaims(appId, now)));
  const signature = await crypto.subtle.sign(
    ALGORITHM,
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${base64url(new Uint8Array(signature))}`;
}

/**
 * The App's private key, from the PEM GitHub gave: PKCS#1 (`BEGIN RSA PRIVATE
 * KEY`, what it hands out) or PKCS#8 (`BEGIN PRIVATE KEY`). WebCrypto imports
 * PKCS#8 only, so a PKCS#1 key is wrapped first. The CryptoKey can sign, and
 * can't be exported.
 */
export async function importAppKey(pem: string): Promise<CryptoKey> {
  const match =
    /-----BEGIN (RSA )?PRIVATE KEY-----([A-Za-z0-9+/=\s]+)-----END \1PRIVATE KEY-----/.exec(pem);
  if (match === null) {
    throw new Error("The GitHub App key is not a PEM private key. Run deploy/runner/bootstrap.");
  }
  const der = Buffer.from((match[2] ?? "").replaceAll(/\s/g, ""), "base64");
  const pkcs8 = match[1] === undefined ? der : pkcs1ToPkcs8(der);
  try {
    return await crypto.subtle.importKey("pkcs8", pkcs8, ALGORITHM, false, ["sign"]);
  } catch {
    // WebCrypto's own message says nothing about the key's bytes, but it
    // isn't needed either.
    throw new Error("The GitHub App key couldn't be read as an RSA private key.");
  }
}

/** rsaEncryption's AlgorithmIdentifier: the OID 1.2.840.113549.1.1.1 with NULL parameters. */
const RSA_ALGORITHM_ID = [
  0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
];

/** PKCS#8's PrivateKeyInfo around a PKCS#1 RSAPrivateKey: version 0, rsaEncryption, the key. */
function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
  const version = [0x02, 0x01, 0x00];
  const key = [0x04, ...derLength(pkcs1.length), ...pkcs1];
  const body = [...version, ...RSA_ALGORITHM_ID, ...key];
  return new Uint8Array([0x30, ...derLength(body.length), ...body]);
}

/** A DER length: one byte under 128, else 0x80 + the count of big-endian bytes that follow. */
function derLength(length: number): number[] {
  if (length < 0x80) return [length];
  const bytes: number[] = [];
  for (let rest = length; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest % 256);
  return [0x80 + bytes.length, ...bytes];
}

function base64url(data: string | Uint8Array): string {
  return Buffer.from(data).toString("base64url");
}
