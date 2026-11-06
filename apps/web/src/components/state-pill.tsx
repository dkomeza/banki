import { useLocation, useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Layers, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Each route's `?state=` names, keyed by its full path as
 * apps/web/src/routeTree.gen.ts names it. Empty on main: only a Variant
 * branch fills it, so the pill never shows in the real app.
 */
export const PREVIEW_STATES: Readonly<Record<string, readonly string[]>> = {};

/**
 * A Variant's state switcher: a pill fixed at the bottom of the page that
 * steps through the current route's `?state=` names, the plain load first.
 * It hides itself from automated browsers, so shots never show it, and folds
 * into a small button in the corner to see what is under it.
 */
export function StatePill() {
  const fullPath = useRouterState({ select: (s) => s.matches.at(-1)?.fullPath });
  const current = useLocation({
    select: (l) => {
      const search: Record<string, unknown> = l.search;
      return typeof search["state"] === "string" ? search["state"] : undefined;
    },
  });
  const navigate = useNavigate();
  const [open, setOpen] = useState(true);

  const named = fullPath === undefined ? undefined : PREVIEW_STATES[fullPath];
  if (named === undefined || named.length === 0 || navigator.webdriver) return null;

  const states = [undefined, ...named];
  const index = Math.max(0, states.indexOf(current));
  // Keeps the rest of the query, such as `/setup`'s Setup token.
  const go = (state: string | undefined) => {
    const url = new URL(window.location.href);
    if (state === undefined) url.searchParams.delete("state");
    else url.searchParams.set("state", state);
    void navigate({ href: url.pathname + url.search + url.hash, replace: true });
  };
  const step = (by: number) => go(states[(index + by + states.length) % states.length]);

  const shell =
    "fixed bottom-[var(--toast-bottom)] z-[100] rounded-full border border-border bg-card text-card-foreground shadow-lg";
  const icon =
    "flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid";

  if (!open) {
    return (
      <button
        type="button"
        aria-label="Show states"
        onClick={() => setOpen(true)}
        className={cn(shell, icon, "right-3 size-10 text-foreground")}
      >
        <Layers aria-hidden className="size-4" />
      </button>
    );
  }

  return (
    <nav
      aria-label="States"
      className={cn(
        shell,
        "left-1/2 flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 items-center gap-1 p-1",
      )}
    >
      <button type="button" aria-label="Previous state" onClick={() => step(-1)} className={icon}>
        <ChevronLeft aria-hidden className="size-4" />
      </button>
      <ul className="flex min-w-0 gap-1 overflow-x-auto [scrollbar-width:none]">
        {states.map((state) => (
          <li key={state ?? ""}>
            <button
              type="button"
              ref={state === current ? showChip : undefined}
              aria-current={state === current ? "true" : undefined}
              onClick={() => go(state)}
              className="h-8 rounded-full px-3 text-sm whitespace-nowrap text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid aria-[current=true]:bg-primary aria-[current=true]:font-medium aria-[current=true]:text-primary-foreground"
            >
              {state ?? "default"}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" aria-label="Next state" onClick={() => step(1)} className={icon}>
        <ChevronRight aria-hidden className="size-4" />
      </button>
      <button
        type="button"
        aria-label="Hide states"
        onClick={() => setOpen(false)}
        className={icon}
      >
        <X aria-hidden className="size-4" />
      </button>
    </nav>
  );
}

// Scrolls the current state's chip into view when the row overflows.
function showChip(chip: HTMLButtonElement | null) {
  chip?.scrollIntoView({ block: "nearest", inline: "center" });
}
