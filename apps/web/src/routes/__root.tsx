import type { QueryClient } from "@tanstack/react-query";
import { Outlet, createRootRouteWithContext, redirect, useRouter } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { guardRedirect } from "@/lib/guard";
import { sessionQueryOptions, setupStatusQueryOptions } from "@/lib/session";

export type RouterContext = { queryClient: QueryClient };

export const Route = createRootRouteWithContext<RouterContext>()({
  // The route guard: Setup first, then signing in (see guardRedirect).
  beforeLoad: async ({ context: { queryClient }, location }) => {
    const { setUp } = await queryClient.ensureQueryData(setupStatusQueryOptions);
    const signedIn = setUp && (await queryClient.ensureQueryData(sessionQueryOptions)) !== null;
    const search: Record<string, unknown> = location.search;
    const target = guardRedirect({
      pathname: location.pathname,
      href: location.href,
      setUp,
      signedIn,
      redirect: search["redirect"],
    });
    if (target !== undefined) throw redirect({ href: target, replace: true });
  },
  component: () => <Outlet />,
  errorComponent: CantReachBanki,
});

function CantReachBanki() {
  const router = useRouter();
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-4">
      <p role="alert">Can't reach Banki. Check your connection and try again.</p>
      <Button onClick={() => void router.invalidate()}>Try again</Button>
    </main>
  );
}
