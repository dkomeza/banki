import type { QueryClient } from "@tanstack/react-query";
import { type OperationLock, createOperationLock } from "./account";
import { meQueryOptions } from "./me";
import { type SignedIn, signedInQueryKey } from "./signed-in-key";

/** What the Account card does that talks to the server, one at a time. */
export type AccountOperation = "email" | "password" | "sign-out";

const locks = new WeakMap<QueryClient, OperationLock<AccountOperation>>();

/**
 * The signed-in app's one account operation lock, per query client. It
 * outlives the Account card: leaving Settings during a Password change and
 * coming back still finds the change under way, so Sign out stays disabled
 * until it settles (its answer sets a fresh session cookie, which would undo
 * a sign-out made meanwhile).
 */
export function accountLockFor(queryClient: QueryClient): OperationLock<AccountOperation> {
  let lock = locks.get(queryClient);
  if (lock === undefined) {
    lock = createOperationLock<AccountOperation>();
    locks.set(queryClient, lock);
  }
  return lock;
}

/**
 * Shows a changed Email everywhere it appears (the Account card, the sidebar
 * foot), without a reload, whether or not the card is still open. Reads of
 * the old Email still on their way are cancelled first, so they can't land
 * afterwards and put it back.
 */
export async function applyEmailChange(queryClient: QueryClient, email: string) {
  await Promise.all([
    queryClient.cancelQueries({ queryKey: meQueryOptions.queryKey }),
    queryClient.cancelQueries({ queryKey: signedInQueryKey }),
  ]);
  queryClient.setQueryData(meQueryOptions.queryKey, { email });
  queryClient.setQueryData<SignedIn>(signedInQueryKey, (before) =>
    before ? { ...before, email } : before,
  );
}
