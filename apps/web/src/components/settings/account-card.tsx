import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { type FormEvent, useState } from "react";
import { FormError } from "@/components/auth-card";
import { Done, Field, OUTLINE_PILL, PILL, Row, SettingsCard } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import {
  EMAIL_CHANGED,
  type EmailChangeOutcome,
  PASSWORD_CHANGED,
  type PasswordChangeOutcome,
  type PasswordChangeRequest,
  changeEmail,
  changePassword,
  newPasswordProblem,
} from "@/lib/account";
import { reportUnauthorized } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { meQueryOptions } from "@/lib/me";
import { retryAfter } from "@/lib/setup";
import { signedInQueryOptions } from "@/lib/signed-in";
import { useSignOut } from "@/lib/use-sign-out";
import { cn } from "@/lib/utils";

/** The form a Change button opens in place, inside the card, on a muted background. */
const FORM = "flex flex-col gap-4 rounded-xl bg-muted p-4";

type Refusal<T> = Extract<T, { ok: false }>;

/** The Account: the Email and the Password, each with a form to change it, and Sign out. */
export function AccountCard() {
  return (
    <SettingsCard id="account" title="Account">
      <EmailRow />
      <hr />
      <PasswordRow />
      <hr />
      <SignOut />
    </SettingsCard>
  );
}

function FormButtons({
  submit,
  submitting,
  onCancel,
}: {
  submit: string;
  submitting: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="submit" size="lg" className={PILL} disabled={submitting}>
        {submitting ? "Changing…" : submit}
      </Button>
      <Button type="button" variant="ghost" size="lg" className={PILL} onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

function EmailRow() {
  const queryClient = useQueryClient();
  const { data: me } = useSuspenseQuery(meQueryOptions);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<Refusal<EmailChangeOutcome>>();
  const [changedTo, setChangedTo] = useState<string>();

  const close = () => {
    setOpen(false);
    setEmail("");
    setPassword("");
    setRefusal(undefined);
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    const outcome = await changeEmail({ email, password });
    setSubmitting(false);
    if (!outcome.ok) {
      setRefusal(outcome);
      return;
    }
    // The new Email everywhere it shows, without a reload.
    queryClient.setQueryData(meQueryOptions.queryKey, { email: outcome.email });
    queryClient.setQueryData(signedInQueryOptions.queryKey, (before) =>
      before ? { ...before, email: outcome.email } : before,
    );
    setChangedTo(outcome.email);
    close();
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
              aria-label="Change Email"
              onClick={() => {
                setOpen(true);
                setChangedTo(undefined);
              }}
            >
              Change
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
            error={errorFor("password")}
            onChange={(event) => {
              setPassword(event.target.value);
              if (refusal?.field === "password") setRefusal(undefined);
            }}
          />
          {refusal?.field === "form" && <FormError>{refusal.message}</FormError>}
          <FormButtons submit="Change Email" submitting={submitting} onCancel={close} />
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

function PasswordRow() {
  const { data: me } = useSuspenseQuery(meQueryOptions);
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<Refusal<PasswordChangeOutcome>>();
  const [changed, setChanged] = useState(false);

  const close = () => {
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
    setSubmitting(true);
    const outcome = await changePassword(
      { currentPassword: current, newPassword: next },
      { request: requestPasswordChange, onUnauthorized: reportUnauthorized },
    );
    setSubmitting(false);
    if (!outcome.ok) {
      setRefusal(outcome);
      return;
    }
    setChanged(true);
    close();
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
              aria-label="Change Password"
              onClick={() => {
                setOpen(true);
                setChanged(false);
              }}
            >
              Change
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
            hint="8 to 128 characters. Every other device gets signed out; this one stays."
            error={errorFor("new")}
            onChange={(event) => {
              setNext(event.target.value);
              if (refusal?.field === "new") setRefusal(undefined);
            }}
          />
          {refusal?.field === "form" && <FormError>{refusal.message}</FormError>}
          <FormButtons submit="Change Password" submitting={submitting} onCancel={close} />
        </form>
      )}
    </>
  );
}

function SignOut() {
  const { start, signingOut, failed } = useSignOut();
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="outline"
        size="lg"
        className={cn(OUTLINE_PILL, "w-full")}
        disabled={signingOut}
        onClick={start}
      >
        <LogOut aria-hidden />
        Sign out
      </Button>
      {failed && <FormError>Couldn't sign out. Try again.</FormError>}
    </div>
  );
}
