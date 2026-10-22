// PROTOTYPE (BAN-9), round 2: variants d and e.
// The user's mix: variant c's Settings page (the Study day bar first, the
// Timezone combobox and Day start select that move it, cards in a grid that
// later sections join), in a's Paper & ink tokens and Geist, with Sign out in
// the Account card, and a Notion-style section index on desktop (a column of
// dashes; hover or focus shows the names). The two variants differ only in
// the shell:
//   d: a's shell. Settings is a nav item; the account menu/sheet stays.
//   e: no account menu/sheet. The sidebar foot shows who is signed in and
//      links to Settings; the tab bar is Home + Settings.

import { Link, useRouterState } from "@tanstack/react-router";
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Globe,
  House,
  LoaderCircle,
  LogOut,
  Settings,
  UserRound,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { THEME_ICONS, useSignOut } from "@/components/account";
import { Logo } from "@/components/logo";
import { THEME_CHOICES, useThemeChoice } from "@/lib/theme";
import { cn } from "@/lib/utils";
import {
  type AccountForms,
  type Field,
  type Prefs,
  PASSWORD_DONE,
  TimezoneCombobox,
  dayStartEffect,
  formatHour,
  offsetOf,
  saveErrorText,
  useAccountForms,
  useEmail,
  useProtoState,
  useStudyDayPrefs,
} from "./shared";
import { ShellA } from "./variant-a";

/** Settings is wider than Home: the index column plus the cards grid. */
function useMainWidth() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return path === "/settings" ? "max-w-5xl" : "max-w-3xl";
}

export function ShellD({ children }: { children: ReactNode }) {
  return (
    <ShellA variant="d" mainClassName={useMainWidth()}>
      {children}
    </ShellA>
  );
}

const SEARCH_E = { variant: "e" } as never;
const NAV = [
  { to: "/", label: "Home", icon: House },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function ShellE({ children }: { children: ReactNode }) {
  const email = useEmail();
  const width = useMainWidth();
  return (
    <div className="min-h-svh lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-svh flex-col gap-6 border-r border-sidebar-border bg-sidebar pt-5 pr-3 pb-3 pl-3 text-sidebar-foreground lg:flex">
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
                  search={SEARCH_E}
                  activeOptions={{ exact: true, includeSearch: false }}
                  className="flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm text-sidebar-foreground no-underline transition-colors hover:bg-sidebar-accent aria-[current=page]:bg-sidebar-accent aria-[current=page]:font-medium aria-[current=page]:text-sidebar-primary"
                >
                  <Icon aria-hidden className="size-4" />
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <Link
          to="/settings"
          search={SEARCH_E}
          aria-label={`Signed in as ${email}. Settings`}
          className="flex w-full items-center gap-2.5 rounded-lg p-2 text-left text-sm text-sidebar-foreground no-underline transition-colors hover:bg-sidebar-accent"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary">
            <UserRound aria-hidden className="size-4" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-xs text-muted-foreground">Signed in as</span>
            <span className="truncate">{email}</span>
          </span>
          <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        </Link>
      </aside>
      <div data-main-area className="pb-[calc(4rem+env(safe-area-inset-bottom))] lg:p-0">
        <main className={cn("mx-auto w-full px-5 py-8 sm:px-8 lg:px-10 lg:py-12", width)}>{children}</main>
      </div>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-10 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        <div className="mx-auto flex h-16 max-w-xs items-stretch gap-1 px-2 py-1.5">
          {NAV.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              search={SEARCH_E}
              activeOptions={{ exact: true, includeSearch: false }}
              className="flex flex-1 flex-col items-center justify-center gap-0.5 rounded-lg text-xs font-medium text-muted-foreground no-underline transition-colors aria-[current=page]:text-primary"
            >
              <Icon aria-hidden className="size-5" />
              {label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}

// --- The page -----------------------------------------------------------------

type SectionDef = { id: string; title: string };

export function SettingsPaper({ variant = "d" }: { variant?: "d" | "e" }) {
  const e = variant === "e";
  const state = useProtoState();
  const prefs = useStudyDayPrefs(state);
  const forms = useAccountForms(state, useEmail());
  const full = state === "full" || state === "index-open";
  const sections: SectionDef[] = [
    { id: "study-day", title: "Study day" },
    ...(full
      ? [
          { id: "grading", title: "Grading" },
          { id: "new-decks", title: "New decks" },
        ]
      : []),
    { id: "account", title: "Account" },
    { id: "this-device", title: "This device" },
  ];
  return (
    <div className="lg:grid lg:grid-cols-[2rem_minmax(0,1fr)] lg:gap-8">
      {e ? (
        <SectionIndexE sections={sections} forceOpen={state === "index-open"} />
      ) : (
        <SectionIndex sections={sections} forceOpen={state === "index-open"} />
      )}
      <div className="flex flex-col gap-8 lg:gap-10">
        <h1 className="text-[2.25rem] leading-none font-semibold tracking-[-0.035em] lg:text-5xl">Settings</h1>
        <StudyDay prefs={prefs} tzOpen={state === "tz-open"} />
        <div
          className={
            e
              ? // Masonry: CSS columns. Cards fill the first column, then the second, in
                // DOM order (the index's order and the Tab order), and never split.
                "gap-x-5 md:columns-2 lg:gap-x-6 [&>section]:mb-5 [&>section]:break-inside-avoid lg:[&>section]:mb-6"
              : "grid gap-5 md:grid-cols-2 md:items-start lg:gap-6"
          }
        >
          {full && <Future />}
          <Account forms={forms} />
          <ThisDevice />
        </div>
      </div>
    </div>
  );
}

/**
 * Notion-style: a column of short dashes, one per section, the one in view in
 * the accent colour. Hovering or focusing it opens the list of names. Each dash
 * is a real link, so Tab walks the sections. Desktop only (≥1024 px).
 */
function SectionIndex({ sections, forceOpen }: { sections: SectionDef[]; forceOpen: boolean }) {
  const [active, setActive] = useState(sections[0]!.id);

  useEffect(() => {
    const update = () => {
      let current = sections[0]!.id;
      for (const s of sections) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= 160) current = s.id;
      }
      const atBottom =
        window.scrollY > 0 &&
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      if (atBottom) current = sections.at(-1)!.id;
      setActive(current);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [sections]);

  const open = forceOpen;
  return (
    <nav aria-label="Settings sections" className="group/idx relative hidden lg:block">
      <div className="sticky top-28">
        <ul
          className={cn(
            "absolute top-0 -left-2 z-20 flex flex-col rounded-xl border border-transparent p-1 transition-[background-color,box-shadow,border-color] duration-150",
            "group-hover/idx:border-border group-hover/idx:bg-popover group-hover/idx:shadow-lg",
            "group-focus-within/idx:border-border group-focus-within/idx:bg-popover group-focus-within/idx:shadow-lg",
            open && "border-border bg-popover shadow-lg",
          )}
        >
          {sections.map((s) => {
            const on = s.id === active;
            return (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  aria-current={on ? "location" : undefined}
                  className="flex h-7 items-center gap-3 rounded-md px-1.5 text-sm whitespace-nowrap text-muted-foreground no-underline outline-none hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring aria-[current=location]:font-medium aria-[current=location]:text-foreground"
                >
                  <span aria-hidden className="flex w-[22px] shrink-0">
                    <span
                      className={cn(
                        "h-[3px] rounded-full transition-colors",
                        on ? "bg-primary" : "bg-input/45",
                      )}
                      style={{ width: `${10 + Math.min(s.title.length, 12)}px` }}
                    />
                  </span>
                  <span
                    className={cn(
                      "pr-3",
                      !open && "sr-only group-hover/idx:not-sr-only group-focus-within/idx:not-sr-only",
                    )}
                  >
                    {s.title}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}

/**
 * Variant e's index. Collapsed: a tight column of dashes (decorative). Hover
 * anywhere in the gutter left of the content, or Tab into it, and a roomy panel
 * of real links opens over the page. Which section is active: each section gets
 * the scroll position its link would jump to, kept in index order and spread
 * out where the page can't scroll far enough to bring a section to the top (so
 * the last sections still each get a turn), and the active one is the last
 * whose position has been passed.
 */
function SectionIndexE({ sections, forceOpen }: { sections: SectionDef[]; forceOpen: boolean }) {
  const ids = sections.map((s) => s.id).join(",");
  const [active, setActive] = useState(sections[0]!.id);
  const [gutter, setGutter] = useState(0);
  const navRef = useRef<HTMLElement>(null);
  const lockUntil = useRef(0);

  useEffect(() => {
    const list = ids.split(",");
    const update = () => {
      if (performance.now() < lockUntil.current) return;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const y = window.scrollY;
      const targets = list.map((id) => {
        const el = document.getElementById(id);
        if (!el) return 0;
        const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
        return Math.min(Math.max(el.getBoundingClientRect().top + y - margin, 0), max);
      });
      // In index order, never earlier than the one before.
      for (let i = 1; i < targets.length; i++) targets[i] = Math.max(targets[i]!, targets[i - 1]!);
      // Spread runs of equal positions between the previous position and theirs.
      for (let i = 1; i < targets.length; ) {
        let j = i;
        while (j + 1 < targets.length && targets[j + 1] === targets[i]) j++;
        if (j > i || targets[i] === targets[i - 1]) {
          const from = targets[i - 1]!;
          const to = targets[i]!;
          const k = j - i + 1;
          if (to > from) for (let n = 0; n < k; n++) targets[i + n] = from + ((to - from) * (n + 1)) / k;
        }
        i = j + 1;
      }
      let current = 0;
      targets.forEach((t, i) => {
        if (t <= y + 1) current = i;
      });
      setActive(list[current]!);
    };
    const measure = () => {
      const nav = navRef.current;
      const area = nav?.closest("[data-main-area]");
      if (nav && area) setGutter(nav.getBoundingClientRect().left - area.getBoundingClientRect().left);
      update();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", measure);
    };
  }, [ids]);

  const dash = (s: SectionDef, on: boolean) => (
    <span
      aria-hidden
      className={cn("block h-[3px] rounded-full transition-colors", on ? "bg-primary" : "bg-input/45")}
      style={{ width: `${10 + Math.min(s.title.length, 12)}px` }}
    />
  );

  return (
    <nav ref={navRef} aria-label="Settings sections" className="group/idx relative hidden lg:block">
      <div className="sticky top-28">
        {/* The hover zone: the whole gutter left of the dashes, a little taller than them. */}
        <div aria-hidden className="absolute -inset-y-8 right-0" style={{ left: -gutter }} />
        <div
          aria-hidden
          className={cn(
            "relative flex flex-col gap-2.5 py-3 transition-opacity group-focus-within/idx:opacity-0 group-hover/idx:opacity-0",
            forceOpen && "opacity-0",
          )}
        >
          {sections.map((s) => (
            <span key={s.id}>{dash(s, s.id === active)}</span>
          ))}
        </div>
        <ul
          className={cn(
            "absolute top-0 -left-3 z-20 flex w-max min-w-48 flex-col gap-1 rounded-xl border bg-popover p-2.5 text-popover-foreground shadow-lg transition-opacity duration-150",
            "pointer-events-none opacity-0 group-focus-within/idx:pointer-events-auto group-focus-within/idx:opacity-100 group-hover/idx:pointer-events-auto group-hover/idx:opacity-100",
            forceOpen && "pointer-events-auto opacity-100",
          )}
        >
          {sections.map((s) => {
            const on = s.id === active;
            return (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  aria-current={on ? "location" : undefined}
                  onClick={() => {
                    lockUntil.current = performance.now() + 400;
                    setActive(s.id);
                  }}
                  className="flex h-9 items-center gap-3.5 rounded-lg pr-5 pl-3 text-sm text-muted-foreground no-underline outline-none hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring aria-[current=location]:font-medium aria-[current=location]:text-foreground"
                >
                  <span className="flex w-[22px] shrink-0">{dash(s, on)}</span>
                  {s.title}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}

const CARD = "flex scroll-mt-28 flex-col gap-5 rounded-[1.25rem] border bg-card p-5 sm:p-6";

function Card({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className={CARD}>
      <h2 id={`${id}-h`} className="text-xl font-semibold tracking-tight">
        {title}
      </h2>
      {children}
    </section>
  );
}

function SaveState({ prefs, field }: { prefs: Prefs; field: Field }) {
  const s = prefs.save;
  if (!s || s.field !== field || s.kind === "error") return null;
  return (
    <span aria-live="polite" className="flex items-center gap-1 text-sm text-muted-foreground">
      {s.kind === "saving" ? (
        <>
          <LoaderCircle aria-hidden className="size-3.5 animate-spin" /> Saving
        </>
      ) : (
        <>
          <Check aria-hidden className="size-3.5 text-primary" /> Saved
        </>
      )}
    </span>
  );
}

const FIELD =
  "h-12 w-full rounded-xl border border-input bg-background px-4 text-base outline-none focus:border-ring focus:outline-2 focus:outline-offset-1 focus:outline-ring lg:h-11 dark:bg-input/20";

const COMBO = {
  input: FIELD,
  list: "absolute inset-x-0 top-full z-30 mt-2 max-h-80 overflow-y-auto rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-xl",
  option:
    "flex min-h-11 cursor-default items-center justify-between gap-3 rounded-lg px-3 text-[0.95rem] aria-selected:font-semibold aria-selected:text-primary lg:min-h-9",
  optionActive: "bg-accent",
  offset: "shrink-0 text-sm text-muted-foreground tabular-nums",
  empty: "px-3 py-2 text-sm text-muted-foreground",
};

function StudyDay({ prefs, tzOpen }: { prefs: Prefs; tzOpen: boolean }) {
  const tzLabel = useId();
  const dsId = useId();
  const err = prefs.save?.kind === "error" ? prefs.save : null;
  return (
    <section
      id="study-day"
      aria-labelledby="study-day-h"
      className="flex scroll-mt-28 flex-col gap-6 rounded-[1.5rem] border bg-card p-5 sm:p-7 lg:p-8"
    >
      <div className="flex flex-col gap-1.5">
        <h2 id="study-day-h" className="text-xl font-semibold tracking-tight lg:text-2xl">
          Your Study day
        </h2>
        <p className="max-w-prose text-[0.95rem] text-muted-foreground">{dayStartEffect(prefs.dayStart)}</p>
      </div>

      <Ribbon dayStart={prefs.dayStart} />

      <div className="grid gap-5 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span id={tzLabel} className="text-sm font-medium">
              Timezone
            </span>
            <SaveState prefs={prefs} field="timezone" />
          </div>
          <TimezoneCombobox
            value={prefs.timezone}
            onChange={prefs.setTimezone}
            classes={COMBO}
            labelledBy={tzLabel}
            initialQuery={tzOpen ? "lon" : undefined}
          />
          <p className="text-sm text-muted-foreground">The same on every device, even when you travel.</p>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label htmlFor={dsId} className="text-sm font-medium">
              Day start
            </label>
            <SaveState prefs={prefs} field="dayStart" />
          </div>
          <div className="relative">
            <select
              id={dsId}
              value={prefs.dayStart}
              onChange={(e) => prefs.setDayStart(Number(e.target.value))}
              className={cn(FIELD, "appearance-none pr-10")}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {formatHour(h)}
                  {h === 4 ? " (default)" : ""}
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden
              className="pointer-events-none absolute top-1/2 right-4 size-4 -translate-y-1/2 text-muted-foreground"
            />
          </div>
        </div>
      </div>

      {err && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-destructive/40 p-4 text-sm sm:flex-row sm:items-center"
        >
          <CircleAlert aria-hidden className="hidden size-5 shrink-0 text-destructive sm:block" />
          <p className="min-w-0 flex-1 text-destructive">{saveErrorText(err, prefs)}</p>
          <button type="button" onClick={prefs.retry} className={cn(PILL, "border border-input bg-background")}>
            Try again
          </button>
        </div>
      )}

      {prefs.mismatch && (
        <div className="flex flex-col gap-3 rounded-xl bg-accent p-4 text-[0.95rem] sm:flex-row sm:items-center">
          <Globe aria-hidden className="hidden size-5 shrink-0 text-primary sm:block" />
          <p className="min-w-0 flex-1">
            This device is in <strong className="font-semibold">{prefs.deviceTimezone}</strong> (
            {offsetOf(prefs.deviceTimezone)}). Banki still counts days in {prefs.timezone}.
          </p>
          <button
            type="button"
            onClick={() => prefs.setTimezone(prefs.deviceTimezone)}
            className={cn(PILL, "shrink-0 bg-primary text-primary-foreground")}
          >
            Use {prefs.deviceTimezone}
          </button>
        </div>
      )}
    </section>
  );
}

const TICKS = [0, 6, 12, 18, 24];
const tickLabel = (h: number) => (h === 0 || h === 24 ? "midnight" : formatHour(h).replace(":00", ""));
const HATCH = "repeating-linear-gradient(135deg, var(--muted) 0 6px, var(--border) 6px 12px)";

function Ribbon({ dayStart }: { dayStart: number }) {
  const pct = (dayStart / 24) * 100;
  return (
    <figure className="flex flex-col gap-2" aria-label={`Study day from ${formatHour(dayStart)}`}>
      <div className="relative pt-8">
        <div
          className="absolute top-0 flex -translate-x-1/2 flex-col items-center"
          style={{ left: `${Math.min(Math.max(pct, 9), 91)}%` }}
        >
          <span className="rounded-full bg-foreground px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap text-background">
            {formatHour(dayStart)}
          </span>
        </div>
        <div className="relative flex h-12 overflow-hidden rounded-xl">
          {dayStart > 0 && <div style={{ width: `${pct}%`, backgroundImage: HATCH }} />}
          <div className="flex flex-1 items-center bg-primary px-3 text-sm font-semibold text-primary-foreground">
            Today's Study day
          </div>
          <div aria-hidden className="absolute inset-y-0 w-0.5 bg-foreground" style={{ left: `${pct}%` }} />
        </div>
      </div>
      <div className="relative h-5 text-xs text-muted-foreground">
        {TICKS.map((h) => (
          <span
            key={h}
            className={cn(
              "absolute top-0",
              h === 0 ? "left-0" : h === 24 ? "right-0" : "-translate-x-1/2",
              (h === 6 || h === 18) && "hidden sm:block",
            )}
            style={h === 0 || h === 24 ? undefined : { left: `${(h / 24) * 100}%` }}
          >
            {tickLabel(h)}
          </span>
        ))}
      </div>
      {dayStart > 0 && (
        <figcaption className="flex items-center gap-2 text-sm text-muted-foreground">
          <span
            aria-hidden
            className="inline-block size-3 rounded-sm"
            style={{ backgroundImage: "repeating-linear-gradient(135deg, var(--muted) 0 3px, var(--input) 3px 5px)" }}
          />
          Before {formatHour(dayStart)} counts toward yesterday
        </figcaption>
      )}
    </figure>
  );
}

function Input({
  label,
  type,
  value,
  onChange,
  error,
  hint,
  autoComplete,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  hint?: string;
  autoComplete?: string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-d`}
        onChange={(e) => onChange(e.target.value)}
        className={cn(FIELD, "aria-invalid:border-destructive aria-invalid:outline-destructive")}
      />
      {(error || hint) && (
        <p id={`${id}-d`} className={cn("text-sm", error ? "font-medium text-destructive" : "text-muted-foreground")}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

const PILL = "h-11 rounded-full px-5 text-sm font-medium transition-colors lg:h-10";
const OUTLINE = "border border-input bg-background hover:bg-muted dark:bg-input/20";

function Item({ label, value, action }: { label: string; value: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="truncate text-[1.05rem] font-medium">{value}</p>
      </div>
      {action}
    </div>
  );
}

function Account({ forms }: { forms: AccountForms }) {
  const e = forms.email;
  const p = forms.password;
  const { start, signingOut, failed } = useSignOut();
  return (
    <Card id="account" title="Account">
      <Item
        label="Email"
        value={e.current}
        action={
          !e.open && (
            <button type="button" onClick={e.start} className={cn(PILL, OUTLINE)}>
              Change
            </button>
          )
        }
      />
      {e.done && <Done>Email changed. Sign in with {e.done} from now on.</Done>}
      {e.open && (
        <form
          className="flex flex-col gap-4 rounded-xl bg-muted p-4"
          onSubmit={(ev) => {
            ev.preventDefault();
            e.submit();
          }}
        >
          <Input label="New Email" type="email" value={e.newEmail} onChange={e.setNewEmail} autoComplete="email" />
          <Input
            label="Current Password"
            type="password"
            value={e.password}
            onChange={e.setPassword}
            error={e.error}
            autoComplete="current-password"
          />
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={cn(PILL, "bg-primary text-primary-foreground hover:bg-primary/85")}>
              Change Email
            </button>
            <button type="button" onClick={e.cancel} className={cn(PILL, "hover:bg-background/60")}>
              Cancel
            </button>
          </div>
        </form>
      )}
      <hr />
      <Item
        label="Password"
        value="••••••••••"
        action={
          !p.open && (
            <button type="button" onClick={p.start} className={cn(PILL, OUTLINE)}>
              Change
            </button>
          )
        }
      />
      {p.done && <Done>{PASSWORD_DONE}</Done>}
      {p.open && (
        <form
          className="flex flex-col gap-4 rounded-xl bg-muted p-4"
          onSubmit={(ev) => {
            ev.preventDefault();
            p.submit();
          }}
        >
          <Input
            label="Current Password"
            type="password"
            value={p.current}
            onChange={p.setCurrent}
            error={p.error?.field === "current" ? p.error.text : null}
            autoComplete="current-password"
          />
          <Input
            label="New Password"
            type="password"
            value={p.next}
            onChange={p.setNext}
            hint="8 to 128 characters. Every other device gets signed out; this one stays."
            error={p.error?.field === "new" ? p.error.text : null}
            autoComplete="new-password"
          />
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={cn(PILL, "bg-primary text-primary-foreground hover:bg-primary/85")}>
              Change Password
            </button>
            <button type="button" onClick={p.cancel} className={cn(PILL, "hover:bg-background/60")}>
              Cancel
            </button>
          </div>
        </form>
      )}
      <hr />
      <button
        type="button"
        onClick={start}
        disabled={signingOut}
        className={cn(PILL, OUTLINE, "flex items-center justify-center gap-2")}
      >
        <LogOut aria-hidden className="size-4" /> Sign out
      </button>
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          Couldn't sign out. Try again.
        </p>
      )}
    </Card>
  );
}

function Done({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="flex items-start gap-2.5 rounded-xl bg-accent p-3.5 text-[0.95rem]">
      <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
      <span>{children}</span>
    </p>
  );
}

function ThisDevice() {
  const [choice, setChoice] = useThemeChoice();
  return (
    <Card id="this-device" title="This device">
      <div className="flex flex-col gap-2.5">
        <p id="pi-theme" className="text-sm text-muted-foreground">
          Theme, for this device only
        </p>
        <div role="radiogroup" aria-labelledby="pi-theme" className="grid grid-cols-3 gap-2">
          {THEME_CHOICES.map(({ value, label }) => {
            const Icon = THEME_ICONS[value];
            const on = choice === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setChoice(value)}
                className={cn(
                  "flex h-16 flex-col items-center justify-center gap-1 rounded-xl border text-sm transition-colors",
                  on
                    ? "border-primary bg-accent font-medium text-primary ring-1 ring-primary"
                    : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon aria-hidden className="size-5" />
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

function Future() {
  return (
    <>
      <Card id="grading" title="Grading">
        <Item
          label="OpenRouter API key"
          value="sk-or-…3f9a"
          action={<button className={cn(PILL, OUTLINE)}>Change</button>}
        />
        <hr />
        <Item label="Model" value="anthropic/claude-sonnet-4.5" />
      </Card>
      <Card id="new-decks" title="New decks">
        <Item label="Desired retention" value="90%" />
        <Item label="Answer mode" value="Write the answer" />
        <Item label="Math macros" value="3 macros" action={<button className={cn(PILL, OUTLINE)}>Edit</button>} />
      </Card>
    </>
  );
}
