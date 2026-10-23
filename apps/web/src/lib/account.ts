import {
  ApiError,
  type ChangeEmailRequest,
  MeResponse,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@banki/shared";
import { type ApiClient, api } from "./api";
import { retryAfter, tryAgainIn } from "./setup";

// What changing the Email or the Password from the Account card says, and
// under which field.

const CANT_REACH = "Can't reach Banki. Check your connection and try again.";
const WRONG_PASSWORD = "That Password isn't right.";

export type EmailChangeOutcome =
  | { ok: true; email: string }
  | { ok: false; field: "email" | "password" | "form"; message: string };

const EMAIL_REFUSALS: Record<string, { field: "email" | "password"; message: string }> = {
  wrong_password: { field: "password", message: WRONG_PASSWORD },
  same_email: { field: "email", message: "That's already your Email" },
  invalid_email: { field: "email", message: "Enter an email address, like name@example.com." },
  email_taken: { field: "email", message: "That Email belongs to someone else." },
};

/** Changes the Email with `POST /api/me/email`, and says how it went. */
export async function changeEmail(
  body: ChangeEmailRequest,
  client: ApiClient = api,
): Promise<EmailChangeOutcome> {
  let res: Response;
  try {
    res = await client.api.me.email.$post({ json: body });
  } catch {
    return { ok: false, field: "form", message: CANT_REACH };
  }
  if (res.ok) return { ok: true, email: MeResponse.parse(await res.json()).email };
  if (res.status === 429) {
    return { ok: false, field: "form", message: tryAgainIn(retryAfter(res, "retry-after")) };
  }
  const parsed = ApiError.safeParse(await res.json().catch(() => undefined));
  const refusal = parsed.success ? EMAIL_REFUSALS[parsed.data.error.code] : undefined;
  return refusal === undefined
    ? { ok: false, field: "form", message: "Banki couldn't change the Email. Try again." }
    : { ok: false, ...refusal };
}

/** What's wrong with a New Password, if anything, before it is sent. */
export function newPasswordProblem(password: string): string | undefined {
  if (password.length < PASSWORD_MIN_LENGTH)
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (password.length > PASSWORD_MAX_LENGTH)
    return `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  return undefined;
}

export type PasswordChangeOutcome =
  | { ok: true }
  | { ok: false; field: "current" | "new" | "form"; message: string };

/** What better-auth's answer to `/change-password` means for the form. */
export function passwordChangeOutcome({
  error,
  retryAfterSeconds,
}: {
  error: { status: number; code?: string | undefined } | null;
  retryAfterSeconds?: number | undefined;
}): PasswordChangeOutcome {
  if (error === null) return { ok: true };
  if (error.status === 429)
    return { ok: false, field: "form", message: tryAgainIn(retryAfterSeconds) };
  if (error.code === "INVALID_PASSWORD")
    return { ok: false, field: "current", message: WRONG_PASSWORD };
  if (error.code === "PASSWORD_TOO_SHORT") {
    return { ok: false, field: "new", message: `Use at least ${PASSWORD_MIN_LENGTH} characters.` };
  }
  if (error.code === "PASSWORD_TOO_LONG") {
    return { ok: false, field: "new", message: `Use at most ${PASSWORD_MAX_LENGTH} characters.` };
  }
  if (error.status === 0) return { ok: false, field: "form", message: CANT_REACH };
  return { ok: false, field: "form", message: "Banki couldn't change the Password. Try again." };
}

/** better-auth's `/change-password`, answering its error (if any) and any wait it asked for. */
export type PasswordChangeRequest = (body: {
  currentPassword: string;
  newPassword: string;
}) => Promise<{
  error: { status: number; code?: string | undefined } | null;
  retryAfterSeconds?: number | undefined;
}>;

/**
 * Changes the Password through `request` and says how it went. A 401 (the
 * sign-in expired or was revoked meanwhile) goes to `onUnauthorized`, the
 * handling every other API call's 401 gets, which sends a signed-out browser
 * to sign in.
 */
export async function changePassword(
  body: { currentPassword: string; newPassword: string },
  {
    request,
    onUnauthorized,
  }: { request: PasswordChangeRequest; onUnauthorized: () => Promise<void> },
): Promise<PasswordChangeOutcome> {
  let answer: Awaited<ReturnType<PasswordChangeRequest>>;
  try {
    answer = await request(body);
  } catch {
    return passwordChangeOutcome({ error: { status: 0 } });
  }
  if (answer.error?.status === 401) await onUnauthorized();
  return passwordChangeOutcome(answer);
}

/**
 * Runs the Account card's operations (changing the Email or the Password,
 * signing out) one at a time. Signing out while a Password change is under way
 * could otherwise be undone by the change's answer, which sets a fresh
 * session cookie.
 */
export function createOperationLock<Kind extends string>() {
  let current: Kind | null = null;
  const listeners = new Set<() => void>();
  const set = (next: Kind | null) => {
    current = next;
    for (const listener of listeners) listener();
  };
  return {
    /** The operation under way, if any. */
    current: () => current,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Runs `operation` unless another is under way; says whether it ran. */
    async run(kind: Kind, operation: () => Promise<unknown>): Promise<boolean> {
      if (current !== null) return false;
      set(kind);
      try {
        await operation();
      } finally {
        set(null);
      }
      return true;
    },
  };
}

export type OperationLock<Kind extends string> = ReturnType<typeof createOperationLock<Kind>>;

export const EMAIL_CHANGED = (email: string) => `Email changed. Sign in with ${email} from now on.`;

export const PASSWORD_CHANGED =
  "Password changed. Every other device is signed out; this one stays signed in.";
