import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clear, main, prune, restore, seeded, take } from "./snapshot";

// The Snapshot script against a real SQLite database in WAL mode, as the api
// leaves it in its data volume: a temporary directory stands in for /data.

let data: string;
beforeEach(() => {
  data = mkdtempSync(join(tmpdir(), "banki-snapshot-"));
});
afterEach(() => rmSync(data, { recursive: true, force: true }));

const database = () => join(data, "banki.db");
const snapshots = () => join(data, "snapshots");

/** A database with one row per value, as the api writes it: in WAL mode. */
function writeDatabase(values: string[]) {
  const db = new Database(database(), { create: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("CREATE TABLE IF NOT EXISTS notes (value TEXT)");
  for (const value of values) db.run("INSERT INTO notes (value) VALUES (?)", [value]);
  return db;
}

function valuesIn(file: string): string[] {
  const db = new Database(file, { readonly: true });
  try {
    return db
      .query<{ value: string }, []>("SELECT value FROM notes ORDER BY rowid")
      .all()
      .map((row) => row.value);
  } finally {
    db.close();
  }
}

describe("take", () => {
  test("copies banki.db with VACUUM INTO, the WAL's writes included", () => {
    // Left open, so the writes are still in the WAL, as a killed api leaves them.
    const open = writeDatabase(["first", "second"]);
    try {
      expect(existsSync(`${database()}-wal`)).toBe(true);

      expect(take(data, 7)).toBe("taken");
    } finally {
      open.close();
    }

    expect(valuesIn(join(snapshots(), "7.db"))).toEqual(["first", "second"]);
    expect(readdirSync(snapshots())).toEqual(["7.db"]);
  });

  test("copies only banki.db: uploads and the key files stay in place", () => {
    writeDatabase(["first"]).close();
    writeFileSync(join(data, "auth-secret"), "secret");
    mkdirSync(join(data, "uploads"));

    take(data, 7);

    expect(readdirSync(snapshots())).toEqual(["7.db"]);
    expect(readdirSync(data).toSorted()).toEqual(
      ["auth-secret", "banki.db", "snapshots", "uploads"]
        .concat(existsSync(`${database()}-wal`) ? ["banki.db-shm", "banki.db-wal"] : [])
        .toSorted(),
    );
  });

  test("is skipped when that Deployment's Snapshot exists, so a retry keeps the one taken before its first try", () => {
    writeDatabase(["before"]).close();
    take(data, 7);
    // The first try's new version wrote, then the agent restarted.
    writeDatabase(["after"]).close();

    expect(take(data, 7)).toBe("kept");
    expect(valuesIn(join(snapshots(), "7.db"))).toEqual(["before"]);
  });

  test("replaces a take that was cut short, never keeping it as a whole one", () => {
    writeDatabase(["first"]).close();
    mkdirSync(snapshots());
    writeFileSync(join(snapshots(), "7.db.partial"), "half a database");

    expect(take(data, 7)).toBe("taken");
    expect(valuesIn(join(snapshots(), "7.db"))).toEqual(["first"]);
    expect(readdirSync(snapshots())).toEqual(["7.db"]);
  });

  test("fails without a database", () => {
    expect(() => take(data, 7)).toThrow("banki.db doesn't exist");
  });
});

describe("restore", () => {
  test("puts the Snapshot back over banki.db, undoing the new version's migration and writes", () => {
    writeDatabase(["before"]).close();
    take(data, 7);
    const migrated = writeDatabase(["after"]);
    migrated.run("CREATE TABLE migrated (id INTEGER)");
    migrated.close();

    restore(data, 7);

    expect(valuesIn(database())).toEqual(["before"]);
    const db = new Database(database(), { readonly: true });
    try {
      expect(
        db.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all(),
      ).toEqual([{ name: "notes" }]);
    } finally {
      db.close();
    }
  });

  test("removes the WAL and shared-memory files of the database it replaces", () => {
    writeDatabase(["before"]).close();
    take(data, 7);
    writeFileSync(`${database()}-wal`, "a stale WAL");
    writeFileSync(`${database()}-shm`, "a stale index");

    restore(data, 7);

    expect(existsSync(`${database()}-wal`)).toBe(false);
    expect(existsSync(`${database()}-shm`)).toBe(false);
    expect(valuesIn(database())).toEqual(["before"]);
    expect(existsSync(join(snapshots(), "7.db"))).toBe(true);
  });

  test("fails, touching nothing, when the Snapshot doesn't exist", () => {
    writeDatabase(["current"]).close();

    expect(() => restore(data, 7)).toThrow("7.db doesn't exist");
    expect(valuesIn(database())).toEqual(["current"]);
  });
});

describe("prune", () => {
  test("keeps the newest five Snapshots, by Deployment", () => {
    writeDatabase(["x"]).close();
    for (const id of [3, 12, 9, 40, 100, 7, 1]) take(data, id);

    expect(prune(data).toSorted((a, b) => a - b)).toEqual([1, 3]);
    expect(readdirSync(snapshots()).toSorted()).toEqual(
      ["100.db", "12.db", "40.db", "7.db", "9.db"].toSorted(),
    );
  });

  test("removes a partial take, and leaves other files alone", () => {
    writeDatabase(["x"]).close();
    take(data, 1);
    writeFileSync(join(snapshots(), "2.db.partial"), "half");
    writeFileSync(join(snapshots(), "notes.txt"), "the Maintainer's");

    expect(prune(data)).toEqual([]);
    expect(readdirSync(snapshots()).toSorted()).toEqual(["1.db", "notes.txt"]);
  });

  test("does nothing before the first Snapshot", () => {
    expect(prune(data)).toEqual([]);
  });
});

describe("clear", () => {
  test("deletes banki.db and its WAL and SHM files, and nothing else", () => {
    writeDatabase(["first"]).close();
    take(data, 7);
    writeFileSync(`${database()}-wal`, "a WAL");
    writeFileSync(`${database()}-shm`, "an index");
    writeFileSync(join(data, "auth-secret"), "secret");
    writeFileSync(join(data, "encryption-key"), "key");
    mkdirSync(join(data, "uploads", "ab"), { recursive: true });
    writeFileSync(join(data, "uploads", "ab", "image.png"), "png");

    clear(data, 7);

    expect(readdirSync(data).toSorted()).toEqual(
      ["auth-secret", "encryption-key", "snapshots", "uploads"].toSorted(),
    );
    expect(readdirSync(join(data, "uploads", "ab"))).toEqual(["image.png"]);
    expect(readdirSync(snapshots()).toSorted()).toEqual(["7.db", "reset"]);
    expect(valuesIn(join(snapshots(), "7.db"))).toEqual(["first"]);
  });

  test("marks the Reset under way, from the Snapshot taken before it, until it is seeded", () => {
    writeDatabase(["before"]).close();
    take(data, 7);

    clear(data, 7);

    expect(readFileSync(join(snapshots(), "reset"), "utf8")).toBe("7\n");
    seeded(data);
    expect(existsSync(join(snapshots(), "reset"))).toBe(false);
  });

  test("refuses to clear before the Snapshot is taken, touching nothing", () => {
    writeDatabase(["current"]).close();

    expect(() => clear(data, 7)).toThrow("7.db doesn't exist");
    expect(valuesIn(database())).toEqual(["current"]);
  });

  test("a Reset cut short clears again, keeping the Snapshot it started from", () => {
    writeDatabase(["before"]).close();
    take(data, 7);
    clear(data, 7);
    // banki setup got halfway, then the agent restarted.
    writeDatabase(["half set up"]).close();

    clear(data, 7);

    expect(existsSync(database())).toBe(false);
    expect(readFileSync(join(snapshots(), "reset"), "utf8")).toBe("7\n");
  });
});

/** A Reset by Deployment 7, cut short once it cleared and half set up the database. */
function cutShort() {
  writeDatabase(["before"]).close();
  take(data, 7);
  clear(data, 7);
  writeDatabase(["half set up"]).close();
}

describe("a Reset cut short", () => {
  test("makes the next deploy's take a copy of the Snapshot from before the Reset, and says so", () => {
    cutShort();

    expect(take(data, 8)).toBe("resetting");
    expect(valuesIn(join(snapshots(), "8.db"))).toEqual(["before"]);
    expect(take(data, 8)).toBe("resetting");
  });

  test("is finished by a newer push's deploy, whose clear keeps the first Snapshot", () => {
    cutShort();
    take(data, 8);

    clear(data, 8);

    expect(readFileSync(join(snapshots(), "reset"), "utf8")).toBe("7\n");
  });

  test("ends with a restore, which puts the data from before the Reset back", () => {
    cutShort();
    take(data, 8);

    restore(data, 8);

    expect(valuesIn(database())).toEqual(["before"]);
    expect(existsSync(join(snapshots(), "reset"))).toBe(false);
    expect(take(data, 9)).toBe("taken");
  });

  test("fails a take when the Snapshot it started from is gone", () => {
    cutShort();
    rmSync(join(snapshots(), "7.db"));

    expect(() => take(data, 8)).toThrow("7.db doesn't exist");
  });
});

describe("the command line", () => {
  test("takes, restores, prunes and clears", () => {
    writeDatabase(["x"]).close();

    expect(main(["take", "7"], data)).toBe("taken snapshots/7.db");
    expect(main(["take", "7"], data)).toBe("kept snapshots/7.db");
    expect(main(["restore", "7"], data)).toBe("restored snapshots/7.db");
    expect(main(["prune"], data)).toBe("pruned none");
    expect(main(["clear", "7"], data)).toBe("cleared banki.db");
    expect(existsSync(database())).toBe(false);
    expect(main(["take", "8"], data)).toBe("resetting snapshots/8.db");
    expect(main(["seeded"], data)).toBe("reset done");
  });

  test("refuses anything but a Deployment ID, so no path reaches the file names", () => {
    writeDatabase(["x"]).close();

    for (const arg of [undefined, "", "0", "07", "-1", "1.5", "../banki", "7/../../x"]) {
      expect(() => main(["take", ...(arg === undefined ? [] : [arg])], data)).toThrow(
        "expected a Deployment ID",
      );
    }
    expect(() => main(["drop", "7"], data)).toThrow("unknown command");
  });

  test("runs as a script, as the agent's one-off container runs it", async () => {
    writeDatabase(["x"]).close();
    const proc = Bun.spawn(["bun", join(import.meta.dir, "snapshot.ts"), "take", "7"], {
      cwd: data,
      stdout: "pipe",
      stderr: "pipe",
    });
    // The script's /data is fixed, so the real run is checked for its refusal only.
    const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("/data/banki.db doesn't exist");
  });
});
