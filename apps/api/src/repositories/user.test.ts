import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { type OpenedDatabase, openDatabase } from "../db/database";
import { applyMigrations } from "../db/migrate";
import { createUserRepository, type UserRepository } from "./user";

let tempDir: string;
let opened: OpenedDatabase;
let users: UserRepository;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "banki-users-"));
  opened = openDatabase(tempDir);
  applyMigrations(opened.db);
  users = createUserRepository(opened.db);
});

afterEach(() => {
  opened.close();
  rmSync(tempDir, { recursive: true, force: true });
});

const create = (email = "user@example.com") =>
  users.createWithPassword({
    userId: `user-${email}`,
    accountId: `account-${email}`,
    email,
    passwordHash: "hash",
  });

const count = (table: string) =>
  opened.db.values<[number]>(sql.raw(`SELECT count(*) FROM ${table}`))[0]?.[0];

describe("createWithPassword", () => {
  test("creates the User and their credential account", () => {
    expect(create()).toBe("created");

    expect(users.find()).toEqual({ id: "user-user@example.com", email: "user@example.com" });
    expect(count("auth_account")).toBe(1);
  });

  test("creates nothing once a User exists", () => {
    create();

    expect(create("other@example.com")).toBe("already_set_up");
    expect([count("user"), count("auth_account")]).toEqual([1, 1]);
  });

  test("creates no User when the credential account can't be created", () => {
    opened.db.run(
      sql.raw(
        "CREATE TRIGGER no_accounts BEFORE INSERT ON auth_account BEGIN SELECT RAISE(ABORT, 'no'); END",
      ),
    );

    expect(() => create()).toThrow();
    expect(users.exists()).toBe(false);
  });
});

const addSession = (id: string) =>
  opened.db.run(
    sql`INSERT INTO auth_session (id, expires_at, token, created_at, updated_at, user_id)
        VALUES (${id}, 0, ${id}, 0, 0, ${"user-user@example.com"})`,
  );
const password = () => opened.db.values<[string]>(sql`SELECT password FROM auth_account`)[0]?.[0];

describe("setPasswordAndSignOutEverywhere", () => {
  test("sets the Password and deletes every auth session", () => {
    create();
    addSession("a");
    addSession("b");

    users.setPasswordAndSignOutEverywhere("user-user@example.com", "new-hash");

    expect(password()).toBe("new-hash");
    expect(count("auth_session")).toBe(0);
  });

  test("changes nothing when the auth sessions can't be deleted", () => {
    create();
    addSession("a");
    opened.db.run(
      sql.raw(
        "CREATE TRIGGER keep_sessions BEFORE DELETE ON auth_session BEGIN SELECT RAISE(ABORT, 'no'); END",
      ),
    );

    expect(() =>
      users.setPasswordAndSignOutEverywhere("user-user@example.com", "new-hash"),
    ).toThrow();
    expect(password()).toBe("hash");
  });
});
