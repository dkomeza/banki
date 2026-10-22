// PROTOTYPE (BAN-9), variant c: "Sage & marigold, study day first".
// Bet: a new direction (pale sage, deep green ink, marigold for the Study day,
// Bricolage Grotesque, roomy). The account menu/sheet goes: the sidebar's foot
// becomes who is signed in, linking to Settings, and the tab bar is Home +
// Settings. The page leads with the Study day drawn as a 24-hour ribbon that
// the Timezone combobox and the Day start select move; Account and This device
// follow as cards in a grid that later sections join.

import { Link } from "@tanstack/react-router";
import { Check, ChevronDown, CircleAlert, Globe, House, LoaderCircle, LogOut, Settings } from "lucide-react";
import { type ReactNode, useId } from "react";
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

const SEARCH = { variant: "c" } as never;
const NAV = [
  { to: "/", label: "Home", icon: House },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function ShellC({ children }: { children: ReactNode }) {
  const email = useEmail();
  return (
    <div className="min-h-svh lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <div aria-hidden className="fixed inset-y-0 left-0 hidden w-60 bg-sidebar lg:block" />
      <aside className="sticky top-0 z-[1] hidden h-svh flex-col gap-8 bg-sidebar px-4 pt-6 pb-4 lg:flex">
        <div className="flex items-center gap-2.5 px-2">
          <Logo className="size-8" />
          <span className="text-xl font-bold tracking-tight">Banki</span>
        </div>
        <nav aria-label="Main" className="flex-1">
          <ul className="flex flex-col gap-1">
            {NAV.map(({ to, label, icon: Icon }) => (
              <li key={to}>
                <Link
                  to={to}
                  search={SEARCH}
                  activeOptions={{ exact: true, includeSearch: false }}
                  className="flex h-10 items-center gap-3 rounded-full px-3.5 text-[0.95rem] text-foreground no-underline hover:bg-sidebar-accent aria-[current=page]:bg-primary aria-[current=page]:font-semibold aria-[current=page]:text-primary-foreground"
                >
                  <Icon aria-hidden className="size-[1.1rem]" />
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <Link
          to="/settings"
          search={SEARCH}
          className="flex flex-col rounded-2xl px-3.5 py-2.5 text-foreground no-underline hover:bg-sidebar-accent"
        >
          <span className="text-xs text-muted-foreground">Signed in as</span>
          <span className="truncate text-sm font-medium">{email}</span>
        </Link>
      </aside>
      <main className="mx-auto w-full max-w-4xl px-5 pt-8 pb-[calc(7rem+env(safe-area-inset-bottom))] sm:px-8 lg:px-12 lg:pt-14 lg:pb-16">
        {children}
      </main>
      <nav
        aria-label="Main"
        className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-10 mx-auto max-w-xs rounded-full border bg-card/95 p-1.5 shadow-[0_8px_30px_-12px_rgba(20,40,30,0.35)] backdrop-blur lg:hidden"
      >
        <div className="flex items-stretch gap-1">
          {NAV.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              search={SEARCH}
              activeOptions={{ exact: true, includeSearch: false }}
              className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full text-sm font-medium text-muted-foreground no-underline aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground"
            >
              <Icon aria-hidden className="size-[1.1rem]" />
              {label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}

// --- The page -----------------------------------------------------------------

export function SettingsC() {
  const state = useProtoState();
  const prefs = useStudyDayPrefs(state);
  const forms = useAccountForms(state, useEmail());
  return (
    <div className="flex flex-col gap-8 lg:gap-10">
      <h1 className="text-[2.25rem] leading-none font-bold tracking-[-0.03em] lg:text-5xl">Settings</h1>
      <StudyDay prefs={prefs} tzOpen={state === "tz-open"} />
      <div className="grid gap-5 md:grid-cols-2 md:items-start lg:gap-6">
        {state === "full" && <Future />}
        <Account forms={forms} />
        <ThisDevice />
      </div>
    </div>
  );
}

function Card({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn("flex flex-col gap-5 rounded-[1.25rem] bg-card p-5 sm:p-6", className)}>
      <h2 id={id} className="text-xl font-semibold tracking-tight">
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

const COMBO = {
  input:
    "h-12 w-full rounded-xl border border-input bg-background px-4 text-base outline-none focus:border-ring focus:outline-2 focus:outline-offset-1 focus:outline-ring lg:h-11",
  list: "absolute inset-x-0 top-full z-30 mt-2 max-h-80 overflow-y-auto rounded-xl border bg-popover p-1.5 shadow-xl",
  option:
    "flex min-h-11 cursor-default items-center justify-between gap-3 rounded-lg px-3 text-[0.95rem] aria-selected:font-semibold aria-selected:text-primary",
  optionActive: "bg-accent",
  offset: "shrink-0 text-sm text-muted-foreground tabular-nums",
  empty: "px-3 py-2 text-sm text-muted-foreground",
};

/** The hero: the Study day as a 24-hour ribbon, and the two controls that move it. */
function StudyDay({ prefs, tzOpen }: { prefs: Prefs; tzOpen: boolean }) {
  const tzLabel = useId();
  const dsId = useId();
  const err = prefs.save?.kind === "error" ? prefs.save : null;
  return (
    <section
      aria-labelledby="study-day-h"
      className="flex flex-col gap-6 rounded-[1.5rem] bg-card p-5 sm:p-7 lg:p-8"
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
            <span id={tzLabel} className="text-sm font-semibold">
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
            <label htmlFor={dsId} className="text-sm font-semibold">
              Day start
            </label>
            <SaveState prefs={prefs} field="dayStart" />
          </div>
          <div className="relative">
            <select
              id={dsId}
              value={prefs.dayStart}
              onChange={(e) => prefs.setDayStart(Number(e.target.value))}
              className="h-12 w-full appearance-none rounded-xl border border-input bg-background pr-10 pl-4 text-base outline-none focus:border-ring focus:outline-2 focus:outline-offset-1 focus:outline-ring lg:h-11"
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
        <div role="alert" className="flex flex-col gap-3 rounded-xl border border-destructive/40 p-4 text-sm sm:flex-row sm:items-center">
          <CircleAlert aria-hidden className="hidden size-5 shrink-0 text-destructive sm:block" />
          <p className="min-w-0 flex-1 text-destructive">{saveErrorText(err, prefs)}</p>
          <button
            type="button"
            onClick={prefs.retry}
            className="h-11 rounded-full border border-input px-4 font-semibold lg:h-9"
          >
            Try again
          </button>
        </div>
      )}

      {prefs.mismatch && (
        <div className="flex flex-col gap-3 rounded-xl bg-[var(--marigold-soft)] p-4 text-[0.95rem] sm:flex-row sm:items-center">
          <Globe aria-hidden className="hidden size-5 shrink-0 sm:block" />
          <p className="min-w-0 flex-1">
            This device is in <strong className="font-semibold">{prefs.deviceTimezone}</strong> (
            {offsetOf(prefs.deviceTimezone)}). Banki still counts days in {prefs.timezone}.
          </p>
          <button
            type="button"
            onClick={() => prefs.setTimezone(prefs.deviceTimezone)}
            className="h-11 shrink-0 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground lg:h-10"
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

/** Midnight to midnight: the hours before the Day start belong to the day before. */
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
          {dayStart > 0 && (
            <div
              className="flex items-center justify-center bg-[repeating-linear-gradient(135deg,var(--muted)_0_6px,var(--secondary)_6px_12px)]"
              style={{ width: `${pct}%` }}
            />
          )}
          <div className="flex flex-1 items-center bg-[var(--marigold)] px-3 text-sm font-semibold text-[var(--on-marigold)]">
            Today's Study day
          </div>
          <div
            aria-hidden
            className="absolute inset-y-0 w-0.5 bg-foreground"
            style={{ left: `${pct}%` }}
          />
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
          <span aria-hidden className="inline-block size-3 rounded-sm bg-[repeating-linear-gradient(135deg,var(--muted)_0_3px,var(--input)_3px_5px)]" />
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
      <label htmlFor={id} className="text-sm font-semibold">
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
        className="h-12 rounded-xl border border-input bg-background px-4 text-base outline-none focus:border-ring focus:outline-2 focus:outline-offset-1 focus:outline-ring aria-invalid:border-destructive aria-invalid:outline-destructive lg:h-11"
      />
      {(error || hint) && (
        <p id={`${id}-d`} className={cn("text-sm", error ? "font-medium text-destructive" : "text-muted-foreground")}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

const PILL = "h-11 rounded-full px-5 text-sm font-semibold lg:h-10";

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
  return (
    <Card title="Account">
      <Item
        label="Email"
        value={e.current}
        action={
          !e.open && (
            <button type="button" onClick={e.start} className={cn(PILL, "border border-input")}>
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
            <button type="submit" className={cn(PILL, "bg-primary text-primary-foreground")}>
              Change Email
            </button>
            <button type="button" onClick={e.cancel} className={PILL}>
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
            <button type="button" onClick={p.start} className={cn(PILL, "border border-input")}>
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
            <button type="submit" className={cn(PILL, "bg-primary text-primary-foreground")}>
              Change Password
            </button>
            <button type="button" onClick={p.cancel} className={PILL}>
              Cancel
            </button>
          </div>
        </form>
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
  const { start, signingOut, failed } = useSignOut();
  return (
    <Card title="This device">
      <div className="flex flex-col gap-2.5">
        <p id="c-theme" className="text-sm text-muted-foreground">
          Theme, for this device only
        </p>
        <div role="radiogroup" aria-labelledby="c-theme" className="grid grid-cols-3 gap-2">
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
                  "flex h-16 flex-col items-center justify-center gap-1 rounded-xl border text-sm",
                  on ? "border-primary bg-accent font-semibold text-foreground ring-1 ring-primary" : "border-border text-muted-foreground",
                )}
              >
                <Icon aria-hidden className="size-5" />
                {label}
              </button>
            );
          })}
        </div>
      </div>
      <hr />
      <button
        type="button"
        onClick={start}
        disabled={signingOut}
        className={cn(PILL, "flex items-center justify-center gap-2 border border-input text-foreground")}
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

function Future() {
  return (
    <>
      <Card title="Grading">
        <Item
          label="OpenRouter API key"
          value="sk-or-…3f9a"
          action={<button className={cn(PILL, "border border-input")}>Change</button>}
        />
        <hr />
        <Item label="Model" value="anthropic/claude-sonnet-4.5" />
      </Card>
      <Card title="New decks">
        <Item label="Desired retention" value="90%" />
        <Item label="Answer mode" value="Write the answer" />
        <Item
          label="Math macros"
          value="3 macros"
          action={<button className={cn(PILL, "border border-input")}>Edit</button>}
        />
      </Card>
    </>
  );
}
