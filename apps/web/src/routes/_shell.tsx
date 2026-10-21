import { Outlet, createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/shell";

// A pathless layout around every signed-in screen. /login, /setup and the
// "Can't reach Banki" error stay full-screen, outside it.
export const Route = createFileRoute("/_shell")({
  component: () => (
    <Shell>
      <Outlet />
    </Shell>
  ),
});
