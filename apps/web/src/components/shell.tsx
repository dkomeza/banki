import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "@tanstack/react-router";
import { ChevronRight, House, type LucideIcon, Settings, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { Logo } from "@/components/logo";
import { Toaster } from "@/components/ui/sonner";
import { meQueryOptions } from "@/lib/me";

type NavItem = { to: "/" | "/settings"; label: string; icon: LucideIcon };

// Only real destinations. Later screens add theirs here.
const NAV: readonly NavItem[] = [
  { to: "/", label: "Home", icon: House },
  { to: "/settings", label: "Settings", icon: Settings },
];

/**
 * The frame around every signed-in screen: a sidebar from 1024 px wide, a
 * bottom tab bar below that. Both keep clear of notches and the home
 * indicator through the safe-area insets. Each page sets its own width
 * inside (see Page).
 */
export function Shell({ children }: { children: ReactNode }) {
  // PROTOTYPE (BAN-26, Variant c): the study screen takes the whole window below 1024 px.
  const studying = useLocation({ select: (l) => l.pathname.endsWith("/study") });
  return (
    <div className="min-h-svh lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
      <Sidebar />
      <div
        className={
          studying
            ? "pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] lg:p-0"
            : "pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[calc(4rem+env(safe-area-inset-bottom))] pl-[env(safe-area-inset-left)] lg:p-0"
        }
      >
        <main>{children}</main>
      </div>
      {!studying && <TabBar />}
      <Toaster />
    </div>
  );
}

function Sidebar() {
  const pathname = useLocation({ select: (l) => l.pathname });
  return (
    <aside className="sticky top-0 hidden h-svh flex-col gap-6 border-r border-sidebar-border bg-sidebar pt-[max(1.25rem,env(safe-area-inset-top))] pr-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))] text-sidebar-foreground lg:flex">
      <div className="flex items-center gap-2.5 px-2">
        <Logo className="size-7" />
        <span className="text-lg font-semibold tracking-tight">Banki</span>
      </div>
      <nav aria-label="Main" className="flex-1">
        <ul className="flex flex-col gap-0.5">
          {NAV.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <Link
                to={to}
                activeOptions={{ exact: true }}
                {...activeProps(to, pathname)}
                className="flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm text-sidebar-foreground no-underline transition-colors motion-reduce:transition-none outline-none hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-sidebar-ring focus-visible:outline-solid aria-[current=page]:bg-sidebar-accent aria-[current=page]:font-medium aria-[current=page]:text-sidebar-primary"
              >
                <Icon aria-hidden className="size-4" />
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <SignedInAs />
    </aside>
  );
}

/** The sidebar's foot: who is signed in, linking to Settings, where the account lives. */
function SignedInAs() {
  const me = useQuery(meQueryOptions);
  const email = me.data?.email;
  return (
    <Link
      to="/settings"
      aria-label={email === undefined ? "Settings" : `Signed in as ${email}. Settings`}
      className="flex w-full items-center gap-2.5 rounded-lg p-2 text-left text-sm text-sidebar-foreground no-underline transition-colors motion-reduce:transition-none outline-none hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-sidebar-ring focus-visible:outline-solid"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary">
        <UserRound aria-hidden className="size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-xs text-muted-foreground">Signed in as</span>
        <span className="truncate">{email ?? " "}</span>
      </span>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

function TabBar() {
  const pathname = useLocation({ select: (l) => l.pathname });
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-10 border-t bg-background/95 pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] backdrop-blur lg:hidden"
    >
      <div className="mx-auto flex h-16 max-w-xs items-stretch gap-1 px-2 py-1.5">
        {NAV.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: true }}
            {...activeProps(to, pathname)}
            className="flex flex-1 flex-col items-center justify-center gap-0.5 rounded-lg text-xs font-medium text-muted-foreground no-underline transition-colors motion-reduce:transition-none outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid aria-[current=page]:text-primary"
          >
            <Icon aria-hidden className="size-5" />
            {label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

/** A deck, folder or card page belongs to Home, so Home stays current on it. */
function activeProps(to: NavItem["to"], pathname: string) {
  const inHome = ["/decks/", "/folders/", "/cards/"].some((prefix) => pathname.startsWith(prefix));
  return to === "/" && inHome ? { "aria-current": "page" as const } : {};
}
