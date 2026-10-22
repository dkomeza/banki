import { Link } from "@tanstack/react-router";
import { House, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { AccountMenu, AccountSheet } from "@/components/account";
import { Logo } from "@/components/logo";

type NavItem = { to: "/"; label: string; icon: LucideIcon };

// Only real destinations. Later screens add theirs here.
const NAV: readonly NavItem[] = [{ to: "/", label: "Home", icon: House }];

/**
 * The frame around every signed-in screen: a sidebar from 1024 px wide, a
 * bottom tab bar below that. Both keep clear of notches and the home
 * indicator through the safe-area insets.
 */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-svh lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
      <Sidebar />
      <div className="pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[calc(4rem+env(safe-area-inset-bottom))] pl-[env(safe-area-inset-left)] lg:p-0">
        <main className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 lg:px-10 lg:py-12">
          {children}
        </main>
      </div>
      <TabBar />
    </div>
  );
}

function Sidebar() {
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
                className="flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm text-sidebar-foreground transition-colors outline-none hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-sidebar-ring focus-visible:outline-solid aria-[current=page]:bg-sidebar-accent aria-[current=page]:font-medium aria-[current=page]:text-sidebar-primary"
              >
                <Icon aria-hidden className="size-4" />
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <AccountMenu />
    </aside>
  );
}

const TAB =
  "flex flex-1 flex-col items-center justify-center gap-0.5 rounded-lg text-xs font-medium text-muted-foreground outline-none transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid";

function TabBar() {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-10 border-t bg-background/95 pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] backdrop-blur lg:hidden"
    >
      <div className="mx-auto flex h-16 max-w-md items-stretch gap-1 px-2 py-1.5">
        {NAV.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: true }}
            className={`${TAB} aria-[current=page]:text-primary`}
          >
            <Icon aria-hidden className="size-5" />
            {label}
          </Link>
        ))}
        <AccountSheet triggerClassName={`${TAB} data-popup-open:text-foreground`} />
      </div>
    </nav>
  );
}
