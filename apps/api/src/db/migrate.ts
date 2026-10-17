import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { z } from "zod";
import type { Database } from "./database";

/**
 * The committed drizzle-kit migrations, found relative to this module rather
 * than the working directory, so the server can be started from anywhere.
 */
export const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

const MIGRATIONS_TABLE = "__drizzle_migrations";

/** The part of drizzle-kit's `meta/_journal.json` that names each migration. */
const Journal = z.object({
  entries: z.array(z.object({ tag: z.string(), when: z.number() })),
});

/** When each migration recorded in the database was created (its journal `when`). */
function recordedMigrations(db: Database): Set<number> {
  const tableExists =
    db.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ${MIGRATIONS_TABLE}`)
      .length > 0;
  if (!tableExists) return new Set();
  const rows = db.values<[unknown]>(
    sql`SELECT created_at FROM ${sql.identifier(MIGRATIONS_TABLE)}`,
  );
  return new Set(rows.map(([createdAt]) => Number(createdAt)));
}

/**
 * Applies every migration the database doesn't have yet, in one transaction,
 * and returns the tags of the ones it applied (`[]` when it was up to date).
 *
 * Drizzle only applies migrations created after the latest one recorded, so a
 * migration with an older timestamp (one that arrived through a merge after a
 * newer one was applied) would be skipped for good. That throws instead.
 */
export function applyMigrations(db: Database, folder = migrationsFolder): string[] {
  const before = recordedMigrations(db);
  migrate(db, { migrationsFolder: folder });
  const after = recordedMigrations(db);

  const journal = Journal.parse(
    JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8")),
  );

  const skipped = journal.entries.filter((entry) => !after.has(entry.when));
  if (skipped.length > 0) {
    const tags = skipped.map((entry) => entry.tag).join(", ");
    throw new Error(
      `Migrations not applied: ${tags}. Each one's timestamp is older than the latest ` +
        `applied migration, and migrations only run in timestamp order, so it would never ` +
        `run. Regenerate it on top of the current migrations.`,
    );
  }

  return journal.entries.filter((entry) => !before.has(entry.when)).map((entry) => entry.tag);
}
