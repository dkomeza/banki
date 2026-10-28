import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";

// Takes, restores and prunes a Long-lived installation's Snapshots
// (ADR-0017), and clears its database for a Reset. The agent runs it in a one-off container of its own image, with
// only the installation's data volume mounted at /data, no network, a
// read-only root and the volume owner's uid, so it works the same whatever
// the app image, the one that just failed included:
//
//   bun agent/snapshot.ts take <deploymentId>
//   bun agent/snapshot.ts restore <deploymentId>
//   bun agent/snapshot.ts prune
//   bun agent/snapshot.ts clear
//
// Only `banki.db` is copied or cleared: uploads and the key files stay in
// place in the volume.

const DATABASE = "banki.db";
const SNAPSHOTS = "snapshots";

/** How many Snapshots each installation keeps, newest first. */
export const KEEP_SNAPSHOTS = 5;

const snapshotFile = (dataDir: string, deploymentId: number) =>
  join(dataDir, SNAPSHOTS, `${deploymentId}.db`);

/**
 * `VACUUM INTO /data/snapshots/<deploymentId>.db`, with the api stopped.
 * Skipped when that file exists, so a retried deploy keeps the Snapshot it
 * took before its first try changed anything. It is written beside under
 * another name and renamed into place, so a take cut short never passes for
 * a whole one.
 */
export function take(dataDir: string, deploymentId: number): "taken" | "kept" {
  const target = snapshotFile(dataDir, deploymentId);
  if (existsSync(target)) return "kept";
  const source = join(dataDir, DATABASE);
  if (!existsSync(source)) throw new Error(`${source} doesn't exist`);
  mkdirSync(join(dataDir, SNAPSHOTS), { recursive: true });
  const partial = `${target}.partial`;
  rmSync(partial, { force: true });
  const db = new Database(source);
  try {
    db.run("VACUUM INTO ?", [partial]);
  } finally {
    db.close();
  }
  renameSync(partial, target);
  return "taken";
}

/**
 * Puts the Snapshot back as `banki.db`, removing the WAL and shared-memory
 * files, which belong to the database it replaces.
 */
export function restore(dataDir: string, deploymentId: number): void {
  const source = snapshotFile(dataDir, deploymentId);
  if (!existsSync(source)) throw new Error(`${source} doesn't exist`);
  const database = join(dataDir, DATABASE);
  const partial = `${database}.restoring`;
  copyFileSync(source, partial);
  for (const suffix of ["-wal", "-shm"]) rmSync(`${database}${suffix}`, { force: true });
  renameSync(partial, database);
}

/** Removes all but the newest `keep` Snapshots, by Deployment, and any partial take. */
export function prune(dataDir: string, keep = KEEP_SNAPSHOTS): number[] {
  const dir = join(dataDir, SNAPSHOTS);
  if (!existsSync(dir)) return [];
  const names = readdirSync(dir);
  for (const name of names) {
    if (name.endsWith(".partial")) rmSync(join(dir, name), { force: true });
  }
  const ids = names
    .flatMap((name) => {
      const match = /^([1-9][0-9]*)\.db$/.exec(name);
      return match?.[1] === undefined ? [] : [Number(match[1])];
    })
    .toSorted((a, b) => b - a);
  const removed = ids.slice(keep);
  for (const id of removed) rmSync(snapshotFile(dataDir, id), { force: true });
  return removed;
}

/**
 * Deletes `banki.db` and its WAL and shared-memory files, with the api
 * stopped, so the next `banki setup` starts on an empty database: a Reset.
 * Uploads, the key files and `snapshots/` stay. Run again, it does nothing,
 * so a Reset cut short clears again on its retry.
 */
export function clear(dataDir: string): void {
  const database = join(dataDir, DATABASE);
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${database}${suffix}`, { force: true });
}

function deploymentIdOf(arg: string | undefined): number {
  if (arg === undefined || !/^[1-9][0-9]*$/.test(arg)) {
    throw new Error(`expected a Deployment ID, got ${JSON.stringify(arg)}`);
  }
  return Number(arg);
}

/** The command line: one of the four, against `dataDir`. Its one line of output says what it did. */
export function main(args: string[], dataDir = "/data"): string {
  const [command, arg] = args;
  switch (command) {
    case "take":
      return `${take(dataDir, deploymentIdOf(arg))} ${SNAPSHOTS}/${arg}.db`;
    case "restore":
      restore(dataDir, deploymentIdOf(arg));
      return `restored ${SNAPSHOTS}/${arg}.db`;
    case "prune": {
      const removed = prune(dataDir);
      return removed.length === 0 ? "pruned none" : `pruned ${removed.join(", ")}`;
    }
    case "clear":
      clear(dataDir);
      return `cleared ${DATABASE}`;
    default:
      throw new Error(`unknown command ${JSON.stringify(command)}: take, restore, prune or clear`);
  }
}

if (import.meta.main) {
  try {
    console.log(main(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
