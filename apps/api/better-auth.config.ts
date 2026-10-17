import { Database as SQLite } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { createAuth } from "./src/auth/auth";
import { parseConfig } from "./src/config";

// Only better-auth's CLI reads this, to generate `src/db/auth-schema.ts` from
// Banki's auth options (`bun run auth:generate`). It never touches a real
// database or secret.
export const auth = createAuth({
  db: drizzle({ client: new SQLite(":memory:") }),
  config: parseConfig({}),
  secret: "schema-generation-only-secret-0123456789",
});
