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
      origin: "http://localhost:5173",
      authSecret: undefined,
      commit: "dev",
    });
  });

  test("reads every setting from the environment", () => {
    expect(
      parseConfig({
        DATA_DIR: "/srv/banki",
        PORT: "8080",
        LOG_FORMAT: "pretty",
        LOG_LEVEL: "debug",
        ORIGIN: "https://banki.example.com",
        AUTH_SECRET: "a".repeat(32),
        COMMIT: "0123456789abcdef0123456789abcdef01234567",
      }),
    ).toEqual({
      dataDir: "/srv/banki",
      port: 8080,
      logFormat: "pretty",
      logLevel: "debug",
      origin: "https://banki.example.com",
      authSecret: "a".repeat(32),
      commit: "0123456789abcdef0123456789abcdef01234567",
    });
  });

  test("resolves a relative DATA_DIR against the working directory", () => {
    expect(parseConfig({ DATA_DIR: ".data" }).dataDir).toBe(resolve(process.cwd(), ".data"));
  });

  test("treats an empty variable as unset", () => {
    expect(
      parseConfig({
        DATA_DIR: "",
        PORT: "",
        LOG_FORMAT: "",
        LOG_LEVEL: "",
        ORIGIN: "",
        AUTH_SECRET: "",
        COMMIT: "",
      }),
    ).toEqual(parseConfig({}));
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

  describe("ORIGIN", () => {
    test.each([
      ["http://localhost:8080", "http://localhost:8080"],
      ["https://banki.example.com/", "https://banki.example.com"],
      ["HTTPS://Banki.Example.com:443", "https://banki.example.com"],
      ["http://192.168.1.10:9000", "http://192.168.1.10:9000"],
    ])("accepts %p as %p", (value, origin) => {
      expect(parseConfig({ ORIGIN: value }).origin).toBe(origin);
    });

    test.each([
      "localhost:8080",
      "ftp://banki.example.com",
      "https://banki.example.com/banki",
      "https://banki.example.com//",
      "https://banki.example.com/?x=1",
      "https://banki.example.com?x=1",
      "https://banki.example.com/#top",
      "https://user:pass@banki.example.com",
      "not a url",
    ])("rejects ORIGIN=%p", (value) => {
      expect(() => parseConfig({ ORIGIN: value })).toThrow(/→ at ORIGIN/);
    });
  });

  describe("AUTH_SECRET", () => {
    test("accepts 32 characters", () => {
      expect(parseConfig({ AUTH_SECRET: "x".repeat(32) }).authSecret).toBe("x".repeat(32));
    });

    test("rejects anything shorter than 32 characters", () => {
      expect(() => parseConfig({ AUTH_SECRET: "x".repeat(31) })).toThrow(/→ at AUTH_SECRET/);
    });
  });

  describe("COMMIT", () => {
    test("defaults to dev when unset or empty", () => {
      expect(parseConfig({}).commit).toBe("dev");
      expect(parseConfig({ COMMIT: "" }).commit).toBe("dev");
    });

    test("is the commit the image was built from when set", () => {
      const sha = "0123456789abcdef0123456789abcdef01234567";
      expect(parseConfig({ COMMIT: sha }).commit).toBe(sha);
    });
  });
});
