import { describe, expect, test, vi } from "vitest";
import { createApiClient } from "./api";
import {
  changeEmail,
  changePassword,
  createOperationLock,
  newPasswordProblem,
  passwordChangeOutcome,
} from "./account";

const answering = (res: () => Response) => createApiClient(vi.fn(async () => res()));
const refusal =
  (status: number, code: string, headers: Record<string, string> = {}) =>
  () =>
    Response.json({ error: { code, message: "…" } }, { status, headers });

describe("changeEmail", () => {
  test("answers the new Email when it changed", async () => {
    const client = answering(() => Response.json({ email: "new@example.com" }));

    await expect(
      changeEmail({ email: "New@Example.com", password: "pw" }, client),
    ).resolves.toEqual({
      ok: true,
      email: "new@example.com",
    });
  });

  test.each([
    ["wrong_password", 403, "password", "That Password isn't right."],
    ["same_email", 409, "email", "That's already your Email"],
    ["invalid_email", 400, "email", "Enter an email address, like name@example.com."],
    ["email_taken", 409, "email", "That Email belongs to someone else."],
  ])("puts %s under the right field", async (code, status, field, message) => {
    const client = answering(refusal(status, code));

    await expect(changeEmail({ email: "x", password: "pw" }, client)).resolves.toEqual({
      ok: false,
      field,
      message,
    });
  });

  test("says how long to wait when rate limited", async () => {
    const client = answering(refusal(429, "rate_limited", { "retry-after": "42" }));

    await expect(changeEmail({ email: "x@example.com", password: "pw" }, client)).resolves.toEqual({
      ok: false,
      field: "form",
      message: "Too many attempts. Try again in 42 seconds.",
    });
  });

  test("says Banki can't be reached when the request fails", async () => {
    const client = createApiClient(
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    await expect(changeEmail({ email: "x@example.com", password: "pw" }, client)).resolves.toEqual({
      ok: false,
      field: "form",
      message: "Can't reach Banki. Check your connection and try again.",
    });
  });
});

describe("newPasswordProblem", () => {
  test("refuses a Password outside 8 to 128 characters", () => {
    expect(newPasswordProblem("1234567")).toBe("Use at least 8 characters.");
    expect(newPasswordProblem("x".repeat(129))).toBe("Use at most 128 characters.");
    expect(newPasswordProblem("12345678")).toBeUndefined();
  });
});

describe("passwordChangeOutcome", () => {
  test("is done when better-auth answered no error", () => {
    expect(passwordChangeOutcome({ error: null })).toEqual({ ok: true });
  });

  test("puts a wrong current Password under that field", () => {
    expect(passwordChangeOutcome({ error: { status: 400, code: "INVALID_PASSWORD" } })).toEqual({
      ok: false,
      field: "current",
      message: "That Password isn't right.",
    });
  });

  test("puts a new Password better-auth refuses under that field", () => {
    expect(passwordChangeOutcome({ error: { status: 400, code: "PASSWORD_TOO_SHORT" } })).toEqual({
      ok: false,
      field: "new",
      message: "Use at least 8 characters.",
    });
  });

  test("says how long to wait when rate limited", () => {
    expect(
      passwordChangeOutcome({ error: { status: 429, code: undefined }, retryAfterSeconds: 1 }),
    ).toEqual({ ok: false, field: "form", message: "Too many attempts. Try again in 1 second." });
  });

  test("says Banki can't be reached otherwise", () => {
    expect(passwordChangeOutcome({ error: { status: 0, code: undefined } })).toEqual({
      ok: false,
      field: "form",
      message: "Can't reach Banki. Check your connection and try again.",
    });
  });
});

describe("changePassword", () => {
  const body = { currentPassword: "old password", newPassword: "new password" };

  test("hands a 401 to the shared unauthorized handling", async () => {
    const onUnauthorized = vi.fn(async () => {});

    const outcome = await changePassword(body, {
      request: async () => ({ error: { status: 401, code: "UNAUTHORIZED" } }),
      onUnauthorized,
    });

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(outcome.ok).toBe(false);
  });

  test("leaves other refusals to the form", async () => {
    const onUnauthorized = vi.fn(async () => {});

    const outcome = await changePassword(body, {
      request: async () => ({ error: { status: 400, code: "INVALID_PASSWORD" } }),
      onUnauthorized,
    });

    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(outcome).toEqual({ ok: false, field: "current", message: "That Password isn't right." });
  });

  test("says Banki can't be reached when the request fails", async () => {
    const outcome = await changePassword(body, {
      request: async () => {
        throw new TypeError("Failed to fetch");
      },
      onUnauthorized: vi.fn(async () => {}),
    });

    expect(outcome).toEqual({
      ok: false,
      field: "form",
      message: "Can't reach Banki. Check your connection and try again.",
    });
  });

  test("is done when better-auth answered no error", async () => {
    await expect(
      changePassword(body, { request: async () => ({ error: null }), onUnauthorized: vi.fn() }),
    ).resolves.toEqual({ ok: true });
  });
});

/** A promise and the function that settles it. */
function deferred() {
  const settlers: Array<() => void> = [];
  const promise = new Promise<void>((resolve) => {
    settlers.push(resolve);
  });
  return { promise, settle: () => settlers.forEach((settle) => settle()) };
}

describe("createOperationLock", () => {
  test("runs one operation at a time, refusing others meanwhile", async () => {
    const lock = createOperationLock<"password" | "sign-out">();
    const change = deferred();
    const signOut = vi.fn(async () => {});

    const running = lock.run("password", () => change.promise);
    expect(lock.current()).toBe("password");
    await expect(lock.run("sign-out", signOut)).resolves.toBe(false);
    expect(signOut).not.toHaveBeenCalled();

    change.settle();
    await expect(running).resolves.toBe(true);
    expect(lock.current()).toBeNull();
    await expect(lock.run("sign-out", signOut)).resolves.toBe(true);
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  test("frees itself when an operation throws", async () => {
    const lock = createOperationLock<"email">();

    await expect(
      lock.run("email", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(lock.current()).toBeNull();
  });

  test("tells subscribers when it is taken and freed", async () => {
    const lock = createOperationLock<"email">();
    const seen: Array<string | null> = [];
    lock.subscribe(() => seen.push(lock.current()));

    await lock.run("email", async () => {});

    expect(seen).toEqual(["email", null]);
  });
});
