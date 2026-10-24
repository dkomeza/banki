import { describe, expect, test } from "bun:test";
import { parseArgs, USAGE } from "./args";

// `runner <command>`, as `docker compose … exec runner runner …` passes it.

describe("runner's arguments", () => {
  test("stage <kind> BAN-N runs one Stage", () => {
    expect(parseArgs(["stage", "implement", "BAN-94"])).toEqual({
      command: "stage",
      kind: "implement",
      issue: "BAN-94",
    });
  });

  test("take every kind of Stage there is a prompt for", () => {
    for (const kind of ["design", "implement", "review-round", "acceptance-fix"]) {
      expect(parseArgs(["stage", kind, "BAN-1"])).toMatchObject({ command: "stage", kind });
    }
  });

  test("take the issue in any case, and name it as Linear does", () => {
    expect(parseArgs(["stage", "design", "ban-7"])).toMatchObject({ issue: "BAN-7" });
  });

  test("refuse a kind with no prompt, naming the kinds", () => {
    expect(parseArgs(["stage", "deploy", "BAN-1"])).toEqual({
      command: "error",
      message: "No Stage deploy: it is one of design, implement, review-round, acceptance-fix.",
    });
  });

  test("refuse what isn't an issue of the BAN team", () => {
    for (const issue of ["94", "BAN-", "BAN-0", "BAN-01", "XYZ-3", "BAN-3/../x", "--help"]) {
      expect(parseArgs(["stage", "implement", issue])).toEqual({
        command: "error",
        message: `${JSON.stringify(issue)} isn't an issue, such as BAN-94.`,
      });
    }
  });

  test("refuse a missing or extra argument with the usage", () => {
    for (const argv of [["stage"], ["stage", "design"], ["stage", "design", "BAN-1", "now"]]) {
      expect(parseArgs(argv)).toEqual({ command: "error", message: USAGE });
    }
  });

  test("refuse an unknown command with the usage", () => {
    expect(parseArgs(["deploy", "BAN-1"])).toEqual({
      command: "error",
      message: `No command deploy.\n\n${USAGE}`,
    });
  });

  test("run-now BAN-N starts the issue's next Stage, --force skipping the Ceiling", () => {
    expect(parseArgs(["run-now", "ban-12"])).toEqual({
      command: "run-now",
      issue: "BAN-12",
      force: false,
    });
    expect(parseArgs(["run-now", "BAN-12", "--force"])).toEqual({
      command: "run-now",
      issue: "BAN-12",
      force: true,
    });
    expect(parseArgs(["run-now", "--force", "BAN-12"])).toEqual({
      command: "run-now",
      issue: "BAN-12",
      force: true,
    });
  });

  test("run-now refuses a missing issue, a second one, or another flag", () => {
    for (const argv of [
      ["run-now"],
      ["run-now", "BAN-1", "BAN-2"],
      ["run-now", "BAN-1", "--now"],
    ]) {
      expect(parseArgs(argv)).toEqual({ command: "error", message: USAGE });
    }
    expect(parseArgs(["run-now", "12"])).toMatchObject({ command: "error" });
  });

  test("status takes nothing", () => {
    expect(parseArgs(["status"])).toEqual({ command: "status" });
    expect(parseArgs(["status", "BAN-1"])).toEqual({ command: "error", message: USAGE });
  });

  test("supervise is the Dispatcher's: a Stage, an issue, its log, and whether it resumes", () => {
    expect(
      parseArgs(["supervise", "design", "BAN-3", "--log", "/work/logs/BAN-3/x.jsonl"]),
    ).toEqual({
      command: "supervise",
      kind: "design",
      issue: "BAN-3",
      log: "/work/logs/BAN-3/x.jsonl",
      resume: false,
    });
    expect(
      parseArgs(["supervise", "design", "BAN-3", "--log", "/x.jsonl", "--resume"]),
    ).toMatchObject({ resume: true });
    expect(parseArgs(["supervise", "design", "BAN-3"])).toMatchObject({ command: "error" });
    expect(parseArgs(["supervise", "design", "BAN-3", "--log", "/x.jsonl", "--now"])).toMatchObject(
      { command: "error" },
    );
  });

  test("show the usage for no arguments, help, -h or --help", () => {
    for (const argv of [[], ["help"], ["-h"], ["--help"]]) {
      expect(parseArgs(argv)).toEqual({ command: "help" });
    }
  });
});
