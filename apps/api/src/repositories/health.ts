import { sql } from "drizzle-orm";
import type { Database } from "../db/database";

export type HealthRepository = ReturnType<typeof createHealthRepository>;

export function createHealthRepository(db: Database) {
  return {
    /** Runs a trivial query, throwing when the database can't answer it. */
    ping(): void {
      db.get(sql`select 1`);
    },
  };
}
