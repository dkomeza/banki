import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  dataDirName,
  decideUp,
  isStrayDataDir,
  parseStackFile,
  type StackFile,
} from "./stack-file.ts";

const signedIn: StackFile = {
  mode: "signed-in",
  url: "http://localhost:5174",
  apiPort: 5175,
  webPort: 5174,
  pids: { api: 101, web: 102 },
  dataDir: "/wt/.ui/data-99-abc",
  logs: { api: "/wt/.ui/data-99-abc/api.log", web: "/wt/.ui/data-99-abc/web.log" },
  signedInState: "/wt/.ui/data-99-abc/signed-in.json",
};

const beforeSetup: StackFile = {
  mode: "before-setup",
  url: signedIn.url,
  apiPort: signedIn.apiPort,
  webPort: signedIn.webPort,
  pids: signedIn.pids,
  dataDir: signedIn.dataDir,
  logs: signedIn.logs,
  setupUrl: "http://localhost:5174/setup?token=tok",
};

describe("parseStackFile", () => {
  test("reads back what was written, in either mode", () => {
    assert.deepEqual(parseStackFile(JSON.stringify(signedIn)), signedIn);
    assert.deepEqual(parseStackFile(JSON.stringify(beforeSetup)), beforeSetup);
  });

  test("is undefined for anything else", () => {
    assert.equal(parseStackFile(""), undefined);
    assert.equal(parseStackFile("{"), undefined);
    assert.equal(parseStackFile("null"), undefined);
    assert.equal(parseStackFile(JSON.stringify({ ...signedIn, mode: "signed-out" })), undefined);
    assert.equal(parseStackFile(JSON.stringify({ ...signedIn, pids: { api: "1" } })), undefined);
    assert.equal(parseStackFile(JSON.stringify({ ...signedIn, signedInState: 1 })), undefined);
    const { setupUrl: _, ...noSetupUrl } = beforeSetup;
    assert.equal(parseStackFile(JSON.stringify(noSetupUrl)), undefined);
  });
});

describe("decideUp", () => {
  test("starts a stack when none is recorded", () => {
    assert.deepEqual(decideUp(undefined, false, "signed-in"), { action: "start" });
  });

  test("reuses a running stack in the same mode", () => {
    assert.deepEqual(decideUp(signedIn, true, "signed-in"), { action: "reuse", stack: signedIn });
    assert.deepEqual(decideUp(beforeSetup, true, "before-setup"), {
      action: "reuse",
      stack: beforeSetup,
    });
  });

  test("refuses a running stack in another mode", () => {
    assert.deepEqual(decideUp(signedIn, true, "before-setup"), {
      action: "mode-mismatch",
      running: "signed-in",
    });
    assert.deepEqual(decideUp(beforeSetup, true, "signed-in"), {
      action: "mode-mismatch",
      running: "before-setup",
    });
  });

  test("replaces a recorded stack that is no longer running, whatever its mode", () => {
    assert.deepEqual(decideUp(signedIn, false, "signed-in"), {
      action: "replace-stale",
      stack: signedIn,
    });
    assert.deepEqual(decideUp(signedIn, false, "before-setup"), {
      action: "replace-stale",
      stack: signedIn,
    });
  });
});

describe("dataDirName", () => {
  test("names the folder after the process that owns it", () => {
    assert.match(dataDirName(1234, new Date(0)), /^data-1234-0$/);
    assert.equal(
      isStrayDataDir(dataDirName(1234, new Date()), () => false),
      true,
    );
    assert.equal(
      isStrayDataDir(dataDirName(1234, new Date()), () => true),
      false,
    );
  });
});

describe("isStrayDataDir", () => {
  test("a data folder whose process is gone is stray", () => {
    assert.equal(
      isStrayDataDir("data-42-abc", (pid) => pid !== 42),
      true,
    );
  });

  test("a data folder of a running ui shoot is left alone", () => {
    assert.equal(
      isStrayDataDir("data-42-abc", (pid) => pid === 42),
      false,
    );
  });

  test("a data folder with no owner in its name is stray", () => {
    assert.equal(
      isStrayDataDir("data-xyz", () => true),
      true,
    );
  });

  test("anything that isn't a data folder is not", () => {
    for (const name of ["shots", "stack.json", "playwright-cli", "database-1-a"]) {
      assert.equal(
        isStrayDataDir(name, () => false),
        false,
        name,
      );
    }
  });
});
