// The Drizzle schema: every table the API stores. drizzle-kit diffs it against
// the last snapshot in `drizzle/meta/` to generate a migration (`bun run db:generate`).
//
// better-auth's tables (the User row, auth sessions, credential accounts and
// verifications) are generated from Banki's auth options into `auth-schema.ts`
// by `bun run auth:generate`; never edit that file by hand.
export * from "./auth-schema";
