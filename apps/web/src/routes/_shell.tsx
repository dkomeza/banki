import { Outlet, createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { fillFirstTimezone } from "@/lib/settings";

// A pathless layout around every signed-in screen. /login, /setup and the
// "Can't reach Banki" error stay full-screen, outside it.
export const Route = createFileRoute("/_shell")({
  // The first fill: until a Timezone is stored, every signed-in load offers
  // this browser's zone. It never holds the page up.
  loader: ({ context: { queryClient } }) => {
    void fillFirstTimezone(queryClient);
  },
  component: () => (
    <Shell>
      <Outlet />
    </Shell>
  ),
});
