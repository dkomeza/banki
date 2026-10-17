import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { AuthCard, FormError } from "@/components/auth-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { safeRedirect } from "@/lib/redirect";
import { checkSignedIn } from "@/lib/session";
import { retryAfter, tryAgainIn } from "@/lib/setup";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search["redirect"] === "string" ? { redirect: search["redirect"] } : {},
  component: SignInPage,
});

function SignInPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    let retryAfterSeconds: number | undefined;
    try {
      const { error: failure } = await authClient.signIn.email(
        { email: email.trim(), password },
        {
          onError: ({ response }) => {
            retryAfterSeconds = retryAfter(response, "x-retry-after");
          },
        },
      );
      if (failure) {
        setError(signInError(failure.status, retryAfterSeconds));
        return;
      }
      await checkSignedIn(queryClient);
      await navigate({ href: safeRedirect(redirect), replace: true });
    } catch {
      setError("Can't reach Banki. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthCard title="Sign in to Banki" description="Use the Email and Password you set up.">
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
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        {error && <FormError>{error}</FormError>}
        <Button type="submit" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthCard>
  );
}

function signInError(status: number, retryAfterSeconds: number | undefined): string {
  if (status === 429) return tryAgainIn(retryAfterSeconds);
  // 401 for a wrong Email or Password, 400 for an Email that isn't one: the same message,
  // so the form doesn't reveal which Email is set up.
  if (status === 401 || status === 400) return "Wrong email or password";
  if (status === 0) return "Can't reach Banki. Check your connection and try again.";
  return "Banki couldn't sign you in. Try again.";
}
