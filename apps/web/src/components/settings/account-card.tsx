import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { type FormEvent, useRef, useState, useSyncExternalStore } from "react";
import { FormError } from "@/components/auth-card";
import { Done, Field, OUTLINE_PILL, PILL, Row, SettingsCard } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import {
  EMAIL_CHANGED,
  type EmailChangeOutcome,
  PASSWORD_CHANGED,
  type PasswordChangeOutcome,
  type OperationLock,
  type PasswordChangeRequest,
  changeEmail,
  changePassword,
  newPasswordProblem,
} from "@/lib/account";
import { type AccountOperation, accountLockFor, applyEmailChange } from "@/lib/account-store";
import { reportUnauthorized } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { meQueryOptions } from "@/lib/me";
import { retryAfter } from "@/lib/setup";
import { useSignOut } from "@/lib/use-sign-out";
import { cn } from "@/lib/utils";

/** The form a Change button opens in place, inside the card, on a muted background. */
const FORM = "flex flex-col gap-4 rounded-xl bg-muted p-4";

type Refusal<T> = Extract<T, { ok: false }>;

/** The Account: the Email and the Password, each with a form to change it, and Sign out. */
export function AccountCard() {
  // One operation at a time, app-wide (see accountLockFor): a Password
  // change's answer sets a fresh session cookie, which would undo a sign-out
  // made meanwhile, even one made after leaving Settings and coming back.
  const lock = accountLockFor(useQueryClient());
  const busy = useSyncExternalStore(lock.subscribe, lock.current);
  const operations = { lock, busy };
  return (
    <SettingsCard id="account" title="Account">
      <EmailRow {...operations} />
      <hr />
      <PasswordRow {...operations} />
      <hr />
      <SignOut {...operations} />
    </SettingsCard>
  );
}

/** The app's account operation lock, and the operation under way, if any. */
type Operations = { lock: OperationLock<AccountOperation>; busy: AccountOperation | null };

/**
 * Numbers a form's submits, so a completion can tell whether the form still
 * holds its attempt: not once it was closed (or closed and opened again).
 */
function useAttempts() {
  const latest = useRef(0);
  return {
    start: () => ++latest.current,
    isCurrent: (attempt: number) => attempt === latest.current,
    forget: () => {
      latest.current += 1;
    },
  };
}

function FormButtons({
  submit,
  submitting,
  busy,
  onCancel,
}: {
  submit: string;
  /** This form's change is under way. */
  submitting: boolean;
  /** Any of the card's operations is under way. */
  busy: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="submit" size="lg" className={PILL} disabled={busy}>
        {submitting ? "Changing…" : submit}
      </Button>
      {/* Disabled while a change is under way: it goes through either way. */}
      <Button
        type="button"
        variant="ghost"
        size="lg"
        className={PILL}
        disabled={busy}
        onClick={onCancel}
      >
        Cancel
      </Button>
    </div>
  );
}

function EmailRow({ lock, busy }: Operations) {
  const queryClient = useQueryClient();
  const { data: me } = useSuspenseQuery(meQueryOptions);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const submitting = busy === "email";
  const [refusal, setRefusal] = useState<Refusal<EmailChangeOutcome>>();
  const [changedTo, setChangedTo] = useState<string>();
  const attempt = useAttempts();

  const close = () => {
    attempt.forget();
    setOpen(false);
    setEmail("");
    setPassword("");
    setRefusal(undefined);
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    await lock.run("email", async () => {
      const mine = attempt.start();
      const outcome = await changeEmail({ email, password });
      // The new Email everywhere it shows, even if this form is gone by now.
      if (outcome.ok) await applyEmailChange(queryClient, outcome.email);
      // A refusal or a confirmation only for the form that asked.
      if (!attempt.isCurrent(mine)) return;
      if (!outcome.ok) {
        setRefusal(outcome);
        return;
      }
      setChangedTo(outcome.email);
      close();
    });
  };

  const errorFor = (field: Refusal<EmailChangeOutcome>["field"]) =>
    refusal?.field === field ? refusal.message : undefined;

  return (
    <>
      <Row
        label="Email"
        value={me.email}
        action={
          !open && (
            <Button
              variant="outline"
              size="lg"
              className={OUTLINE_PILL}
              // A change started before the card was last opened may still be under way.
              aria-label={submitting ? "Changing Email" : "Change Email"}
              disabled={busy !== null}
              onClick={() => {
                setOpen(true);
                setChangedTo(undefined);
              }}
            >
              {submitting ? "Changing…" : "Change"}
            </Button>
          )
        }
      />
      {changedTo !== undefined && <Done>{EMAIL_CHANGED(changedTo)}</Done>}
      {open && (
        <form className={FORM} noValidate onSubmit={(event) => void onSubmit(event)}>
          <Field
            label="New Email"
            type="email"
            autoComplete="email"
            required
            autoFocus
            value={email}
            readOnly={submitting}
            error={errorFor("email")}
            onChange={(event) => {
              setEmail(event.target.value);
              if (refusal?.field === "email") setRefusal(undefined);
            }}
          />
          <Field
            label="Current Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            readOnly={submitting}
            error={errorFor("password")}
            onChange={(event) => {
              setPassword(event.target.value);
              if (refusal?.field === "password") setRefusal(undefined);
            }}
          />
          {refusal?.field === "form" && <FormError>{refusal.message}</FormError>}
          <FormButtons
            submit="Change Email"
            submitting={submitting}
            busy={busy !== null}
            onCancel={close}
          />
        </form>
      )}
    </>
  );
}

/** better-auth's change-password, keeping any wait a 429 asks for. */
const requestPasswordChange: PasswordChangeRequest = async (body) => {
  let retryAfterSeconds: number | undefined;
  const { error } = await authClient.changePassword(
    // Every other device is signed out; this one gets a fresh cookie and stays.
    { ...body, revokeOtherSessions: true },
    {
      onError: ({ response }) => {
        retryAfterSeconds = retryAfter(response, "x-retry-after");
      },
    },
  );
  return {
    error: error === null ? null : { status: error.status, code: error.code },
    retryAfterSeconds,
  };
};

function PasswordRow({ lock, busy }: Operations) {
  const { data: me } = useSuspenseQuery(meQueryOptions);
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const submitting = busy === "password";
  const [refusal, setRefusal] = useState<Refusal<PasswordChangeOutcome>>();
  const [changed, setChanged] = useState(false);
  const attempt = useAttempts();

  const close = () => {
    attempt.forget();
    setOpen(false);
    setCurrent("");
    setNext("");
    setRefusal(undefined);
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const problem = newPasswordProblem(next);
    if (problem !== undefined) {
      setRefusal({ ok: false, field: "new", message: problem });
      return;
    }
    await lock.run("password", async () => {
      const mine = attempt.start();
      const outcome = await changePassword(
        { currentPassword: current, newPassword: next },
        { request: requestPasswordChange, onUnauthorized: reportUnauthorized },
      );
      if (!attempt.isCurrent(mine)) return;
      if (!outcome.ok) {
        setRefusal(outcome);
        return;
      }
      setChanged(true);
      close();
    });
  };

  const errorFor = (field: Refusal<PasswordChangeOutcome>["field"]) =>
    refusal?.field === field ? refusal.message : undefined;

  return (
    <>
      <Row
        label="Password"
        value={<span aria-label="Hidden">••••••••••</span>}
        action={
          !open && (
            <Button
              variant="outline"
              size="lg"
              className={OUTLINE_PILL}
              aria-label={submitting ? "Changing Password" : "Change Password"}
              disabled={busy !== null}
              onClick={() => {
                setOpen(true);
                setChanged(false);
              }}
            >
              {submitting ? "Changing…" : "Change"}
            </Button>
          )
        }
      />
      {changed && <Done>{PASSWORD_CHANGED}</Done>}
      {open && (
        <form className={FORM} noValidate onSubmit={(event) => void onSubmit(event)}>
          {/* For password managers: whose Password this is. */}
          <input type="email" autoComplete="username" hidden readOnly value={me.email} />
          <Field
            label="Current Password"
            type="password"
            autoComplete="current-password"
            required
            autoFocus
            value={current}
            readOnly={submitting}
            error={errorFor("current")}
            onChange={(event) => {
              setCurrent(event.target.value);
              if (refusal?.field === "current") setRefusal(undefined);
            }}
          />
          <Field
            label="New Password"
            type="password"
            autoComplete="new-password"
            required
            value={next}
            readOnly={submitting}
            hint="8 to 128 characters. Every other device gets signed out; this one stays."
            error={errorFor("new")}
            onChange={(event) => {
              setNext(event.target.value);
              if (refusal?.field === "new") setRefusal(undefined);
            }}
          />
          {refusal?.field === "form" && <FormError>{refusal.message}</FormError>}
          <FormButtons
            submit="Change Password"
            submitting={submitting}
            busy={busy !== null}
            onCancel={close}
          />
        </form>
      )}
    </>
  );
}

function SignOut({ lock, busy }: Operations) {
  const { signOut, failed } = useSignOut();
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="outline"
        size="lg"
        className={cn(OUTLINE_PILL, "w-full")}
        // Not while a change is under way: a Password change's answer would
        // sign this browser back in.
        disabled={busy !== null}
        onClick={() => void lock.run("sign-out", signOut)}
      >
        <LogOut aria-hidden />
        Sign out
      </Button>
      {failed && <FormError>Couldn't sign out. Try again.</FormError>}
    </div>
  );
}
