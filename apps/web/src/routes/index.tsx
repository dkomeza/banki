import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { healthQueryOptions, healthStatusLine } from "@/lib/health";
import { meQueryOptions } from "@/lib/me";
import { signedInQueryOptions } from "@/lib/signed-in";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const health = useQuery(healthQueryOptions);
  const me = useQuery(meQueryOptions);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  const signOut = async () => {
    setSigningOut(true);
    try {
      await authClient.signOut();
    } finally {
      queryClient.setQueryData(signedInQueryOptions.queryKey, null);
      queryClient.removeQueries({ queryKey: meQueryOptions.queryKey });
      setSigningOut(false);
      await navigate({ to: "/login" });
    }
  };

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-2 p-4">
      <h1 className="text-4xl font-semibold tracking-tight">Banki</h1>
      <p className="text-muted-foreground" role="status">
        {healthStatusLine(health)}
      </p>
      <p className="text-sm">
        {me.status === "success" && <>Signed in as {me.data.email}</>}
        {me.status === "error" && "Couldn't load who is signed in."}
      </p>
      <Button variant="outline" disabled={signingOut} onClick={() => void signOut()}>
        Sign out
      </Button>
    </main>
  );
}
