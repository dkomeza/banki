import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "./auth-client";
import { dropDeckRetentionSavers } from "./deck-retention";
import { meQueryOptions } from "./me";
import { settingsQueryOptions } from "./settings";
import { dropSettingsSaver } from "./settings-store";
import { signOut } from "./sign-out";
import { signedInQueryOptions } from "./signed-in";

/**
 * Signs this browser out and goes to `/login`, or says it couldn't. Whoever
 * calls `signOut` shows that it is under way (the Account card's operation
 * lock, which also keeps it from overlapping a change).
 */
export function useSignOut() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);

  const attempt = async () => {
    setFailed(false);
    const ok = await signOut(
      () => authClient.signOut(),
      async () => {
        queryClient.setQueryData(signedInQueryOptions.queryKey, null);
        queryClient.removeQueries({ queryKey: meQueryOptions.queryKey });
        // The settings savers too, so the next sign-in starts clean.
        dropSettingsSaver(queryClient);
        dropDeckRetentionSavers(queryClient);
        queryClient.removeQueries({ queryKey: settingsQueryOptions().queryKey });
        await navigate({ to: "/login" });
      },
    );
    setFailed(!ok);
  };

  return { signOut: attempt, failed };
}
