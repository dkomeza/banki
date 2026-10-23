import { QueryClient } from "@tanstack/react-query";
import { describe, expect, test, vi } from "vitest";
import { accountLockFor, applyEmailChange } from "./account-store";
import { meQueryOptions } from "./me";
import { signedInQueryKey } from "./signed-in-key";

/** A promise and the function that settles it. */
function deferred<T>() {
  const settlers: Array<(value: T) => void> = [];
  const promise = new Promise<T>((resolve) => {
    settlers.push(resolve);
  });
  return { promise, settle: (value: T) => settlers.forEach((settle) => settle(value)) };
}

describe("the app's account lock", () => {
  test("is one per query client, so leaving Settings and coming back keeps it", async () => {
    const queryClient = new QueryClient();
    const change = deferred<void>();
    const card = accountLockFor(queryClient);
    const leave = card.subscribe(() => {});
    const running = card.run("password", () => change.promise);

    // The card unmounts, and a new one mounts.
    leave();
    const back = accountLockFor(queryClient);
    back.subscribe(() => {});

    expect(back).toBe(card);
    expect(back.current()).toBe("password");
    const signOut = vi.fn(async () => {});
    await expect(back.run("sign-out", signOut)).resolves.toBe(false);
    expect(signOut).not.toHaveBeenCalled();

    change.settle();
    await running;
    await expect(back.run("sign-out", signOut)).resolves.toBe(true);
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  test("is separate for another query client", () => {
    expect(accountLockFor(new QueryClient())).not.toBe(accountLockFor(new QueryClient()));
  });
});

describe("applyEmailChange", () => {
  test("puts the new Email in the cache, where the sidebar and the card read it", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(meQueryOptions.queryKey, { email: "old@example.com" });
    queryClient.setQueryData(signedInQueryKey, { email: "old@example.com" });

    await applyEmailChange(queryClient, "new@example.com");

    expect(queryClient.getQueryData(meQueryOptions.queryKey)).toEqual({ email: "new@example.com" });
    expect(queryClient.getQueryData(signedInQueryKey)).toEqual({
      email: "new@example.com",
    });
  });

  test("a read of the old Email still on its way can't overwrite the new one", async () => {
    const queryClient = new QueryClient();
    const read = deferred<{ email: string }>();
    void queryClient
      .fetchQuery({ queryKey: meQueryOptions.queryKey, queryFn: () => read.promise })
      .catch(() => {});

    await applyEmailChange(queryClient, "new@example.com");
    read.settle({ email: "old@example.com" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(queryClient.getQueryData(meQueryOptions.queryKey)).toEqual({ email: "new@example.com" });
  });
});
