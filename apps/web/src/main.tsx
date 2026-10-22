// First, before any module that defines a zod schema: it only configures zod.
// oxlint-disable-next-line import/no-unassigned-import
import "./lib/zod-jitless";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { setUnauthorizedHandler } from "./lib/api";
import { createQueryClient } from "./lib/query";
import { loginHref } from "./lib/redirect";
import { checkSignedIn } from "./lib/signed-in";
import { createUnauthorizedHandler } from "./lib/unauthorized";
import { routeTree } from "./routeTree.gen";
import "./index.css";

const queryClient = createQueryClient();
const router = createRouter({ routeTree, context: { queryClient } });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// A 401 from any API call re-checks the sign-in once and, if this browser is
// signed out, goes to the sign-in page, coming back here afterwards.
setUnauthorizedHandler(
  createUnauthorizedHandler({
    isSignedIn: () => checkSignedIn(queryClient),
    goToSignIn: () => {
      const { pathname, searchStr, hash } = router.state.location;
      const here = `${pathname}${searchStr}${hash ? `#${hash}` : ""}`;
      void router.navigate({ href: loginHref(here) });
    },
  }),
);

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing #root element");

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
