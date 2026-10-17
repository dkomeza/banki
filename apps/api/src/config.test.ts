import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { ConfigError, parseConfig } from "./config";

describe("parseConfig", () => {
  test("falls back to the defaults when nothing is set", () => {
    expect(parseConfig({})).toEqual({
      dataDir: "/data",
      port: 3000,
      logFormat: "json",
      logLevel: "info",
    });
  });

  test("reads every setting from the environment", () => {
    expect(
      parseConfig({
        DATA_DIR: "/srv/banki",
        PORT: "8080",
        LOG_FORMAT: "pretty",
        LOG_LEVEL: "debug",
      }),
    ).toEqual({ dataDir: "/srv/banki", port: 8080, logFormat: "pretty", logLevel: "debug" });
  });

  test("resolves a relative DATA_DIR against the working directory", () => {
    expect(parseConfig({ DATA_DIR: ".data" }).dataDir).toBe(resolve(process.cwd(), ".data"));
  });

  test("treats an empty variable as unset", () => {
    expect(parseConfig({ DATA_DIR: "", PORT: "", LOG_FORMAT: "", LOG_LEVEL: "" })).toEqual(
      parseConfig({}),
    );
  });

  test.each(["0", "65536", "80.5", "abc", "-1"])("rejects PORT=%p", (port) => {
    expect(() => parseConfig({ PORT: port })).toThrow(ConfigError);
  });

  test.each(["1", "65535"])("accepts PORT=%p", (port) => {
    expect(parseConfig({ PORT: port }).port).toBe(Number(port));
  });

  test("rejects an unknown LOG_FORMAT", () => {
    expect(() => parseConfig({ LOG_FORMAT: "xml" })).toThrow(ConfigError);
  });

  test("rejects an unknown LOG_LEVEL", () => {
    expect(() => parseConfig({ LOG_LEVEL: "trace" })).toThrow(ConfigError);
  });

  test("explains every invalid variable in a prettified message", () => {
    expect(() => parseConfig({ PORT: "abc", LOG_LEVEL: "loud" })).toThrow(
      /✖ Expected a whole number\n {2}→ at PORT[\s\S]*→ at LOG_LEVEL/,
    );
  });
});
