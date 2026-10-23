import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "./auth-client";
import { meQueryOptions } from "./me";
import { settingsQueryOptions } from "./settings";
import { signOut } from "./sign-out";
import { signedInQueryOptions } from "./signed-in";

/** Signs this browser out and goes to `/login`, or says it couldn't. */
export function useSignOut() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  const [failed, setFailed] = useState(false);

  const attempt = async () => {
    setSigningOut(true);
    setFailed(false);
    const ok = await signOut(
      () => authClient.signOut(),
      async () => {
        queryClient.setQueryData(signedInQueryOptions.queryKey, null);
        queryClient.removeQueries({ queryKey: meQueryOptions.queryKey });
        queryClient.removeQueries({ queryKey: settingsQueryOptions().queryKey });
        await navigate({ to: "/login" });
      },
    );
    setSigningOut(false);
    setFailed(!ok);
  };

  return { start: () => void attempt(), signingOut, failed };
}
