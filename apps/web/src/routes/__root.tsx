import type { QueryClient } from "@tanstack/react-query";
import { Outlet, createRootRouteWithContext, redirect, useRouter } from "@tanstack/react-router";
import { FullScreen } from "@/components/auth-card";
import { Button } from "@/components/ui/button";
import { guardRedirect } from "@/lib/guard";
import { signedInQueryOptions, setupStatusQueryOptions } from "@/lib/signed-in";

export type RouterContext = { queryClient: QueryClient };

export const Route = createRootRouteWithContext<RouterContext>()({
  // The route guard: Setup first, then signing in (see guardRedirect).
  beforeLoad: async ({ context: { queryClient }, location }) => {
    const { setUp } = await queryClient.ensureQueryData(setupStatusQueryOptions);
    const signedIn = setUp && (await queryClient.ensureQueryData(signedInQueryOptions)) !== null;
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
    <FullScreen>
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <p role="alert" className="text-balance">
          Can't reach Banki. Check your connection and try again.
        </p>
        <Button size="lg" onClick={() => void router.invalidate()}>
          Try again
        </Button>
      </div>
    </FullScreen>
  );
}
