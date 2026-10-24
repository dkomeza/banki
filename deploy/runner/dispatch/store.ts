import {
  appendFileSync,
  closeSync,
  existsSync,
  linkSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { isRecord } from "../lib/parse";
import type { Reading } from "./gate";
import { type ActiveRecord, isActive, isStageRecord, type StageRecord } from "./lifecycle";

// What the Runner's volume keeps for the Dispatcher (ADR-0013), in
// /work/dispatcher: the gate's last reading, the Stages running or paused
// (one file each, with their supervisor's pid and their runs), and the
// Stages that ended, for their costs. Nothing about the issues themselves:
// that is read from Linear and GitHub each time.

export const DISPATCHER = "/work/dispatcher";
/** How old a lock must be before it counts as left by a tick that died. */
const STALE_LOCK_MS = 15 * 60_000;
/** How long a lock without a readable pid counts as held. */
const UNREADABLE_LOCK_MS = 10_000;

export type GateFile = { reading?: Reading; error?: string; at: string };

export type Store = ReturnType<typeof store>;

const readJson = (path: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
};

/** An fs error's code, such as EEXIST. */
const codeOf = (error: unknown) =>
  error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;

function isGateFile(value: unknown): value is GateFile {
  return isRecord(value) && typeof value.at === "string";
}

export function store(dir = DISPATCHER) {
  const active = join(dir, "active");
  const stagesFile = join(dir, "stages.jsonl");
  const gateFile = join(dir, "gate.json");
  const ensure = () => mkdirSync(active, { recursive: true });
  const activeFile = (issue: string) => join(active, `${issue}.json`);

  /** Writes a file whole, so a reader never sees half of it. */
  function writeAtomic(path: string, text: string): void {
    ensure();
    const tmp = `${path}.${process.pid}.tmp`;
    const fd = openSync(tmp, "w", 0o600);
    try {
      writeSync(fd, text);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, path);
  }

  return {
    dir,

    activeRecords(): ActiveRecord[] {
      if (!existsSync(active)) return [];
      return readdirSync(active)
        .filter((name) => name.endsWith(".json"))
        .toSorted()
        .map((name) => readJson(join(active, name)))
        .filter(isActive);
    },

    activeRecord(issue: string): ActiveRecord | undefined {
      const found = readJson(activeFile(issue));
      return isActive(found) ? found : undefined;
    },

    saveActive(record: ActiveRecord): void {
      writeAtomic(activeFile(record.issue), `${JSON.stringify(record, null, 2)}\n`);
    },

    removeActive(issue: string): void {
      rmSync(activeFile(issue), { force: true });
    },

    /** Records a Stage that ended, and drops its active record. */
    finish(record: StageRecord): void {
      ensure();
      appendFileSync(stagesFile, `${JSON.stringify(record)}\n`, { mode: 0o600 });
      rmSync(activeFile(record.issue), { force: true });
    },

    stageRecords(): StageRecord[] {
      let text: string;
      try {
        text = readFileSync(stagesFile, "utf8");
      } catch {
        return [];
      }
      return text.split("\n").flatMap((line) => {
        if (line.trim() === "") return [];
        try {
          const found: unknown = JSON.parse(line);
          return isStageRecord(found) ? [found] : [];
        } catch {
          return [];
        }
      });
    },

    gate(): GateFile | undefined {
      const value = readJson(gateFile);
      return isGateFile(value) ? value : undefined;
    },

    saveGate(gate: GateFile): void {
      writeAtomic(gateFile, `${JSON.stringify(gate, null, 2)}\n`);
    },

    /**
     * Takes the Dispatcher's lock, so a tick and `run-now` never start two
     * Stages on one issue, or the cap's worth twice. Returns the function
     * that releases it, or undefined while someone else holds it.
     */
    lock(): (() => void) | undefined {
      ensure();
      const path = join(dir, "lock");
      for (let attempt = 0; attempt < 2; attempt++) {
        // Written whole beside it, then linked into place, which fails if the
        // lock exists: so no one ever sees it without its pid.
        const tmp = `${path}.${process.pid}.tmp`;
        writeAtomic(tmp, String(process.pid));
        try {
          linkSync(tmp, path);
          return () => rmSync(path, { force: true });
        } catch (error) {
          if (codeOf(error) !== "EEXIST") throw error;
        } finally {
          rmSync(tmp, { force: true });
        }
        let holder = Number.NaN;
        let modified = 0;
        try {
          holder = Number.parseInt(readFileSync(path, "utf8"), 10);
          modified = statSync(path).mtimeMs;
        } catch {
          continue;
        }
        const age = Date.now() - modified;
        // A lock with no pid in it, from a Dispatcher before this one, is held until it is a few seconds old.
        const held = Number.isNaN(holder)
          ? age < UNREADABLE_LOCK_MS
          : processAlive(holder) && age < STALE_LOCK_MS;
        if (held) return undefined;
        rmSync(path, { force: true });
      }
      return undefined;
    },
  };
}

/** Whether a process is alive. */
export function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return codeOf(error) === "EPERM";
  }
}

/**
 * Whether a Stage's supervisor is still running: its pid is alive and, where
 * /proc says, is still a `runner supervise` of that issue, so a pid the
 * container reused after a restart doesn't count.
 */
export function supervisorAlive(record: ActiveRecord): boolean {
  if (record.pid === null || !processAlive(record.pid)) return false;
  const cmdline = join("/proc", String(record.pid), "cmdline");
  if (!existsSync(cmdline)) return true;
  try {
    const argv = readFileSync(cmdline, "utf8").split("\0");
    return argv.includes("supervise") && argv.includes(record.issue);
  } catch {
    return false;
  }
}
