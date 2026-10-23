import { SetupStatus } from "@banki/shared";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { api } from "./api";
import { authClient } from "./auth-client";
import { ApiRequestError } from "./query";
import { type SignedIn, signedInQueryKey } from "./signed-in-key";

// Both are cached until something changes them: Setup, signing in or out, or
// a 401 that re-checks the sign-in.

export const setupStatusQueryOptions = queryOptions({
  queryKey: ["setup-status"],
  queryFn: async () => {
    const res = await api.api.setup.$get();
    if (!res.ok) throw new ApiRequestError(res.status);
    return SetupStatus.parse(await res.json());
  },
  staleTime: Infinity,
});

/** The signed-in User, or `null` when this browser is signed out. */
export const signedInQueryOptions = queryOptions({
  queryKey: signedInQueryKey,
  queryFn: async (): Promise<SignedIn> => {
    const { data, error } = await authClient.getSession();
    if (error) throw new ApiRequestError(error.status, error.message);
    return data === null ? null : { email: data.user.email };
  },
  staleTime: Infinity,
});

/** Asks the API again whether this browser is signed in, updating the cache. */
export const checkSignedIn = async (queryClient: QueryClient) =>
  (await queryClient.fetchQuery({ ...signedInQueryOptions, staleTime: 0 })) !== null;
