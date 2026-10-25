import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logHref, logPathOf, servedLogPath } from "./paths";

// Only files under /work/logs/BAN-N/ are served, by a name with no path in it.

const work = mkdtempSync(join(tmpdir(), "banki-dashboard-paths-"));
const logs = join(work, "logs");
mkdirSync(join(logs, "BAN-11"), { recursive: true });
mkdirSync(join(logs, "BAN-12"), { recursive: true });
writeFileSync(join(logs, "BAN-11", "2026-10-24T00-47-00Z-design.jsonl"), "{}\n");
writeFileSync(join(logs, "BAN-12", "other.log"), "x\n");
writeFileSync(join(work, "secret.log"), "s3cr3t\n");
symlinkSync(join(work, "secret.log"), join(logs, "BAN-11", "planted.log"));
symlinkSync(join(logs, "BAN-12", "other.log"), join(logs, "BAN-11", "sideways.log"));
mkdirSync(join(logs, "BAN-11", "dir.log"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

describe("a Stage log's path", () => {
  test("is a log file of the issue's own directory", () => {
    expect(servedLogPath(logs, "BAN-11", "2026-10-24T00-47-00Z-design.jsonl")).toEndWith(
      "/logs/BAN-11/2026-10-24T00-47-00Z-design.jsonl",
    );
  });

  test("can't leave it, by its name", () => {
    for (const file of [
      "../BAN-12/other.log",
      "..",
      "../../secret.log",
      "/etc/passwd",
      "a/b.log",
      ".hidden.log",
      "x..log",
      "notes.txt",
      "",
    ]) {
      expect(logPathOf(logs, "BAN-11", file)).toBeUndefined();
    }
    for (const issue of ["..", "BAN-0", "ban-11", "BAN-11/..", "BAN-1x"]) {
      expect(logPathOf(logs, issue, "a.log")).toBeUndefined();
    }
  });

  test("can't leave it by a link planted in it, nor be a directory or a file not there", () => {
    expect(servedLogPath(logs, "BAN-11", "planted.log")).toBeUndefined();
    expect(servedLogPath(logs, "BAN-11", "sideways.log")).toBeUndefined();
    expect(servedLogPath(logs, "BAN-11", "dir.log")).toBeUndefined();
    expect(servedLogPath(logs, "BAN-11", "gone.jsonl")).toBeUndefined();
    expect(servedLogPath(logs, "BAN-99", "a.jsonl")).toBeUndefined();
  });

  test("links by the file's name, from the path its record holds", () => {
    expect(logHref("BAN-11", "/work/logs/BAN-11/2026-10-24T00-47-00Z-design.jsonl")).toBe(
      "/issues/BAN-11/logs/2026-10-24T00-47-00Z-design.jsonl",
    );
  });
});
