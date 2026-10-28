import { readFileSync } from "node:fs";
import { z } from "zod";

const PackageJson = z.object({ version: z.string().min(1) });

/**
 * The api's version, read at runtime from its own `package.json`, which
 * release-please bumps with each Release. The image keeps that file beside
 * `src/`, so a build reports the version it was built at.
 */
export function readVersion(): string {
  const file = readFileSync(new URL("../package.json", import.meta.url), "utf8");
  return PackageJson.parse(JSON.parse(file)).version;
}
