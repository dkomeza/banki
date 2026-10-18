import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@banki/shared";
import { useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useLocation, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { AuthCard, FormError } from "@/components/auth-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { checkSignedIn, setupStatusQueryOptions } from "@/lib/signed-in";
import { type SetupOutcome, submitSetup, tryAgainIn } from "@/lib/setup";

export const Route = createFileRoute("/setup")({
  component: SetupPage,
});

type SetupError = { message: string; signInLink?: boolean };
type SetupFailure = Exclude<SetupOutcome, { ok: true }>;

function SetupPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // Read raw, so the router's search parsing can't turn the token into anything else.
  const tokenFromLink = new URLSearchParams(useLocation().searchStr).get("token") ?? "";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [token, setToken] = useState(tokenFromLink);
  const [error, setError] = useState<SetupError>();
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
      setError({
        message: `The Password must be ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters.`,
      });
      return;
    }
    if (password !== confirmation) {
      setError({ message: "The Passwords don't match." });
      return;
    }

    setSubmitting(true);
    setError(undefined);
    const outcome = await submitSetup({ token: token.trim(), email, password });
    setSubmitting(false);

    if (outcome.ok) {
      queryClient.setQueryData(setupStatusQueryOptions.queryKey, { setUp: true });
      await checkSignedIn(queryClient).catch(() => false);
      await navigate({ to: "/" });
      return;
    }
    if (outcome.reason === "already_set_up") {
      queryClient.setQueryData(setupStatusQueryOptions.queryKey, { setUp: true });
    }
    setError(setupError(outcome));
  };

  return (
    <AuthCard
      title="Set up Banki"
      description="Pick the Email and Password you'll sign in with. The Setup token is in the server's logs."
    >
      <form className="flex flex-col gap-4" onSubmit={(event) => void onSubmit(event)}>
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            maxLength={PASSWORD_MAX_LENGTH}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="confirmation">Confirm password</Label>
          <Input
            id="confirmation"
            type="password"
            autoComplete="new-password"
            required
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="token">Setup token</Label>
          <Input
            id="token"
            autoComplete="off"
            spellCheck={false}
            required
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
        </div>
        {error && (
          <FormError>
            {error.message}{" "}
            {error.signInLink && (
              <Link to="/login" className="underline">
                Sign in
              </Link>
            )}
          </FormError>
        )}
        <Button type="submit" disabled={submitting}>
          {submitting ? "Setting up…" : "Set up"}
        </Button>
      </form>
    </AuthCard>
  );
}

const SETUP_ERRORS: Record<Exclude<SetupFailure["reason"], "rate_limited">, SetupError> = {
  invalid_setup_token: {
    message:
      "That Setup token is wrong. Use the link or token from the server's latest logs (docker compose logs api); a restart replaces it.",
  },
  already_set_up: { message: "Banki is already set up.", signInLink: true },
  invalid_request: { message: "Check the Email, the Password and the Setup token." },
  network: { message: "Can't reach Banki. Check your connection and try again." },
};

function setupError(failure: SetupFailure): SetupError {
  return failure.reason === "rate_limited"
    ? { message: tryAgainIn(failure.retryAfterSeconds) }
    : SETUP_ERRORS[failure.reason];
}
