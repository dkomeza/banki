import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  dataDirFate,
  dataDirName,
  decideUp,
  parseStackFile,
  parseStackProcesses,
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
  test("names the folder after the process that creates it", () => {
    assert.equal(dataDirName(1234, new Date(0)), "data-1234-0");
  });
});

describe("parseStackProcesses", () => {
  test("reads back the process groups a stack started", () => {
    assert.deepEqual(parseStackProcesses('{"api":101,"web":102}'), { api: 101, web: 102 });
    assert.deepEqual(parseStackProcesses('{"api":101}'), { api: 101 });
  });

  test("ignores anything that isn't a process group ID", () => {
    assert.deepEqual(parseStackProcesses('{"api":"101","web":-1}'), {});
    assert.deepEqual(parseStackProcesses("{"), {});
    assert.deepEqual(parseStackProcesses("null"), {});
  });
});

describe("dataDirFate", () => {
  const nothingRuns = {
    creatorRunning: () => false,
    processes: {},
    isStackProcess: () => false,
  };

  test("keeps the folder of a ui run that is still going, such as a ui shoot", () => {
    assert.deepEqual(
      dataDirFate("data-42-abc", {
        creatorRunning: (pid) => pid === 42,
        processes: { api: 101, web: 102 },
        isStackProcess: () => true,
      }),
      { action: "keep" },
    );
  });

  test("stops a handed-over stack whose stack.json is lost before removing its folder", () => {
    // ui up exits after handing its stack over, so its creator is gone while
    // its API and Vite still run.
    assert.deepEqual(
      dataDirFate("data-42-abc", {
        creatorRunning: () => false,
        processes: { api: 101, web: 102 },
        isStackProcess: () => true,
      }),
      { action: "remove", stop: [101, 102] },
    );
  });

  test("stops only the recorded processes that are still the stack's API and Vite", () => {
    assert.deepEqual(
      dataDirFate("data-42-abc", {
        creatorRunning: () => false,
        processes: { api: 101, web: 102 },
        isStackProcess: (pgid, role) => pgid === 102 && role === "web",
      }),
      { action: "remove", stop: [102] },
    );
  });

  test("removes a folder nothing uses any more", () => {
    assert.deepEqual(dataDirFate("data-42-abc", nothingRuns), { action: "remove", stop: [] });
    assert.deepEqual(dataDirFate("data-xyz", nothingRuns), { action: "remove", stop: [] });
  });

  test("leaves anything that isn't a data folder alone", () => {
    for (const name of ["shots", "stack.json", "playwright-cli", "database-1-a"]) {
      assert.equal(dataDirFate(name, nothingRuns), undefined, name);
    }
  });
});
