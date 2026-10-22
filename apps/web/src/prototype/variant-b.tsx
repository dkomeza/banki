// PROTOTYPE (BAN-9), variant b: "Ruled card, grouped rows".
// Bet: a new direction (cool index-card white, blue ruling, a red header rule,
// Atkinson Hyperlegible Next, compact). The account menu/sheet goes away: the
// nav is Home + Settings, and Settings holds Account, this device's theme and
// Sign out. Desktop swaps the sidebar for a top bar. The page is grouped list
// rows that show their value and open an editor in place; a section index
// sits beside them on desktop. Timezone is a searchable combobox, Day start a
// stepper.

import { Link } from "@tanstack/react-router";
import {
  Check,
  ChevronRight,
  CircleAlert,
  Globe,
  House,
  LoaderCircle,
  LogOut,
  Minus,
  Plus,
  Settings,
} from "lucide-react";
import { type ReactNode, useId, useState } from "react";
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

const SEARCH = { variant: "b" } as never;
const NAV = [
  { to: "/", label: "Home", icon: House },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function ShellB({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-svh">
      <header className="sticky top-0 z-20 hidden h-14 border-b bg-card/95 backdrop-blur lg:block">
        <div className="mx-auto flex h-full max-w-5xl items-center gap-8 px-10">
          <div className="flex items-center gap-2">
            <Logo className="size-6" />
            <span className="text-base font-bold">Banki</span>
          </div>
          <nav aria-label="Main" className="flex h-full items-stretch gap-1">
            {NAV.map(({ to, label }) => (
              <Link
                key={to}
                to={to}
                search={SEARCH}
                activeOptions={{ exact: true, includeSearch: false }}
                className="flex items-center border-b-2 border-transparent px-3 text-sm text-muted-foreground no-underline hover:text-foreground aria-[current=page]:border-primary aria-[current=page]:font-semibold aria-[current=page]:text-foreground"
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 pt-6 pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:px-8 lg:px-10 lg:pt-10 lg:pb-16">
        {children}
      </main>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-10 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        <div className="mx-auto flex h-16 max-w-sm items-stretch gap-1 px-2 py-1.5">
          {NAV.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              search={SEARCH}
              activeOptions={{ exact: true, includeSearch: false }}
              className="flex flex-1 flex-col items-center justify-center gap-0.5 rounded-md text-xs font-medium text-muted-foreground no-underline aria-[current=page]:text-primary"
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

type GroupDef = { id: string; title: string };

export function SettingsB() {
  const state = useProtoState();
  const prefs = useStudyDayPrefs(state);
  const forms = useAccountForms(state, useEmail());
  const full = state === "full";
  const groups: GroupDef[] = [
    { id: "study-days", title: "Study days" },
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
    <div className="lg:grid lg:grid-cols-[11rem_minmax(0,40rem)] lg:gap-12">
      <nav aria-label="Settings sections" className="hidden lg:block">
        <div className="sticky top-24 flex flex-col gap-3">
          <h1 className="text-2xl font-bold">Settings</h1>
          <ul className="flex flex-col border-l-2 border-[var(--rule)]">
            {groups.map((g, i) => (
              <li key={g.id}>
                <a
                  href={`#${g.id}`}
                  className={cn(
                    "-ml-0.5 block border-l-2 py-1.5 pl-3 text-sm no-underline",
                    i === 0
                      ? "border-[var(--margin)] font-semibold text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {g.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </nav>
      <div className="flex flex-col gap-7">
        <h1 className="text-2xl font-bold lg:hidden">Settings</h1>
        <StudyDays prefs={prefs} initialTzOpen={state === "tz-open"} />
        {full && <Future />}
        <Account forms={forms} />
        <ThisDevice />
      </div>
    </div>
  );
}

/** An index card: the title on the red header rule, rows on blue rules. */
function Group({
  id,
  title,
  footer,
  children,
}: {
  id: string;
  title: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-24">
      <div className="overflow-hidden rounded-md border bg-card shadow-[0_1px_0_var(--border)]">
        <h2
          id={`${id}-h`}
          className="border-b-2 border-[var(--margin)] px-4 pt-3 pb-1.5 text-[0.95rem] font-bold"
        >
          {title}
        </h2>
        <div className="divide-y divide-[var(--rule)]">{children}</div>
      </div>
      {footer && <div className="px-4 pt-2 text-sm text-muted-foreground">{footer}</div>}
    </section>
  );
}

const ROW =
  "flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left text-[0.95rem] lg:min-h-11";

function DisclosureRow({
  label,
  value,
  open,
  onToggle,
  status,
  children,
}: {
  label: string;
  value: ReactNode;
  open: boolean;
  onToggle: () => void;
  status?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className={cn(open && "bg-muted/60")}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
        className={cn(ROW, "hover:bg-muted/60")}
      >
        <span className="font-medium">{label}</span>
        {status}
        <span className="ml-auto min-w-0 truncate text-right text-muted-foreground">{value}</span>
        <ChevronRight
          aria-hidden
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
        />
      </button>
      {open && (
        <div id={id} className="flex flex-col gap-3 px-4 pt-1 pb-4">
          {children}
        </div>
      )}
    </div>
  );
}

function SaveState({ prefs, field }: { prefs: Prefs; field: Field }) {
  const s = prefs.save;
  if (!s || s.field !== field || s.kind === "error") return null;
  return s.kind === "saving" ? (
    <LoaderCircle aria-label="Saving" className="size-4 animate-spin text-muted-foreground" />
  ) : (
    <Check aria-label="Saved" className="size-4 text-primary" />
  );
}

function SaveError({ prefs, field }: { prefs: Prefs; field: Field }) {
  const s = prefs.save;
  if (!s || s.field !== field || s.kind !== "error") return null;
  return (
    <div role="alert" className="flex items-start gap-2 px-4 pb-3 text-sm text-destructive">
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      <p className="min-w-0 flex-1">
        {saveErrorText(s, prefs)}{" "}
        <button type="button" onClick={prefs.retry} className="font-semibold underline underline-offset-2">
          Try again
        </button>
      </p>
    </div>
  );
}

const COMBO = {
  input:
    "h-11 w-full rounded-md border border-input bg-card px-3 text-base outline-none focus:border-ring focus:outline-2 focus:outline-offset-1 focus:outline-ring lg:h-10 lg:text-sm",
  list: "mt-1 max-h-64 divide-y divide-[var(--rule)] overflow-y-auto rounded-md border bg-card",
  option: "flex min-h-11 cursor-default items-center justify-between gap-3 px-3 text-sm lg:min-h-9 aria-selected:font-semibold aria-selected:text-primary",
  optionActive: "bg-accent",
  offset: "shrink-0 text-xs text-muted-foreground tabular-nums",
  empty: "px-3 py-2 text-sm text-muted-foreground",
};

function StudyDays({ prefs, initialTzOpen }: { prefs: Prefs; initialTzOpen: boolean }) {
  const [tzOpen, setTzOpen] = useState(initialTzOpen);
  const labelId = useId();
  return (
    <Group id="study-days" title="Study days" footer={dayStartEffect(prefs.dayStart)}>
      <DisclosureRow
        label="Timezone"
        value={
          <>
            {prefs.timezone.replaceAll("_", " ")}{" "}
            <span className="hidden text-xs sm:inline">{offsetOf(prefs.timezone)}</span>
          </>
        }
        status={<SaveState prefs={prefs} field="timezone" />}
        open={tzOpen}
        onToggle={() => setTzOpen((o) => !o)}
      >
        <p id={labelId} className="text-sm text-muted-foreground">
          Banki counts your days in this timezone on every device. Search by city, region or offset.
        </p>
        <TimezoneCombobox
          value={prefs.timezone}
          onChange={(tz) => {
            prefs.setTimezone(tz);
            setTzOpen(false);
          }}
          classes={COMBO}
          initialQuery={initialTzOpen ? "lon" : undefined}
          labelledBy={labelId}
        />
      </DisclosureRow>
      <SaveError prefs={prefs} field="timezone" />
      {prefs.mismatch && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-accent/70 px-4 py-3 text-sm">
          <Globe aria-hidden className="size-4 shrink-0 text-primary" />
          <p className="min-w-0 flex-1">
            This device is in {prefs.deviceTimezone} ({offsetOf(prefs.deviceTimezone)}).
          </p>
          <button
            type="button"
            onClick={() => prefs.setTimezone(prefs.deviceTimezone)}
            className="h-11 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground lg:h-8"
          >
            Use {prefs.deviceTimezone}
          </button>
        </div>
      )}
      <div className={ROW}>
        <span className="font-medium" id="ds-label">
          Day start
        </span>
        <SaveState prefs={prefs} field="dayStart" />
        <Stepper prefs={prefs} />
      </div>
      <SaveError prefs={prefs} field="dayStart" />
    </Group>
  );
}

function Stepper({ prefs }: { prefs: Prefs }) {
  const h = prefs.dayStart;
  const btn =
    "flex size-11 items-center justify-center rounded-md text-primary hover:bg-accent disabled:opacity-40 lg:size-8";
  return (
    <div role="group" aria-labelledby="ds-label" className="ml-auto flex items-center rounded-md border">
      <button type="button" aria-label="An hour earlier" className={btn} onClick={() => prefs.setDayStart((h + 23) % 24)}>
        <Minus aria-hidden className="size-4" />
      </button>
      <output aria-live="polite" className="w-24 text-center text-sm font-semibold tabular-nums">
        {formatHour(h)}
      </output>
      <button type="button" aria-label="An hour later" className={btn} onClick={() => prefs.setDayStart((h + 1) % 24)}>
        <Plus aria-hidden className="size-4" />
      </button>
    </div>
  );
}

function FormField({
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
    <div className="flex flex-col gap-1">
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
        className="h-11 rounded-md border border-input bg-card px-3 text-base outline-none focus:border-ring focus:outline-2 focus:outline-offset-1 focus:outline-ring aria-invalid:border-destructive lg:h-10 lg:text-sm"
      />
      {(error || hint) && (
        <p id={`${id}-d`} className={cn("text-sm", error ? "text-destructive" : "text-muted-foreground")}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

function FormButtons({ submit, onCancel }: { submit: string; onCancel: () => void }) {
  return (
    <div className="flex gap-2 pt-1">
      <button
        type="submit"
        className="h-11 flex-1 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground sm:flex-none lg:h-9"
      >
        {submit}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="h-11 flex-1 rounded-md border px-4 text-sm font-semibold sm:flex-none lg:h-9"
      >
        Cancel
      </button>
    </div>
  );
}

function Account({ forms }: { forms: AccountForms }) {
  const e = forms.email;
  const p = forms.password;
  return (
    <Group id="account" title="Account">
      <DisclosureRow label="Email" value={e.current} open={e.open} onToggle={e.open ? e.cancel : e.start}>
        <form
          className="flex flex-col gap-3"
          onSubmit={(ev) => {
            ev.preventDefault();
            e.submit();
          }}
        >
          <FormField label="New Email" type="email" value={e.newEmail} onChange={e.setNewEmail} autoComplete="email" />
          <FormField
            label="Current Password"
            type="password"
            value={e.password}
            onChange={e.setPassword}
            error={e.error}
            autoComplete="current-password"
          />
          <FormButtons submit="Change Email" onCancel={e.cancel} />
        </form>
      </DisclosureRow>
      {e.done && (
        <p role="status" className="flex items-center gap-2 px-4 py-3 text-sm">
          <Check aria-hidden className="size-4 text-primary" /> Email changed. Sign in with {e.done} from now on.
        </p>
      )}
      <DisclosureRow
        label="Password"
        value={p.done ? "Changed just now" : "Change"}
        open={p.open}
        onToggle={p.open ? p.cancel : p.start}
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(ev) => {
            ev.preventDefault();
            p.submit();
          }}
        >
          <FormField
            label="Current Password"
            type="password"
            value={p.current}
            onChange={p.setCurrent}
            error={p.error?.field === "current" ? p.error.text : null}
            autoComplete="current-password"
          />
          <FormField
            label="New Password"
            type="password"
            value={p.next}
            onChange={p.setNext}
            hint="8 to 128 characters. Every other device gets signed out."
            error={p.error?.field === "new" ? p.error.text : null}
            autoComplete="new-password"
          />
          <FormButtons submit="Change Password" onCancel={p.cancel} />
        </form>
      </DisclosureRow>
      {p.done && (
        <p role="status" className="flex items-start gap-2 bg-accent/70 px-4 py-3 text-sm">
          <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" /> {PASSWORD_DONE}
        </p>
      )}
    </Group>
  );
}

function ThisDevice() {
  const [choice, setChoice] = useThemeChoice();
  const { start, signingOut, failed } = useSignOut();
  return (
    <Group id="this-device" title="This device" footer="The theme is kept on this device only.">
      <div className={cn(ROW, "flex-wrap")}>
        <span className="font-medium" id="theme-label">
          Theme
        </span>
        <div role="radiogroup" aria-labelledby="theme-label" className="ml-auto flex rounded-md border p-0.5">
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
                  "flex h-10 items-center gap-1.5 rounded px-2.5 text-sm lg:h-8",
                  on ? "bg-primary font-semibold text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon aria-hidden className="size-4" />
                {label}
              </button>
            );
          })}
        </div>
      </div>
      <button
        type="button"
        onClick={start}
        disabled={signingOut}
        className={cn(ROW, "font-semibold text-destructive hover:bg-muted/60")}
      >
        <LogOut aria-hidden className="size-4" />
        Sign out
      </button>
      {failed && (
        <p role="alert" className="px-4 pb-3 text-sm text-destructive">
          Couldn't sign out. Try again.
        </p>
      )}
    </Group>
  );
}

function Future() {
  return (
    <>
      <Group id="grading" title="Grading">
        <DisclosureRow label="OpenRouter API key" value="sk-or-…3f9a" open={false} onToggle={() => {}}>
          {null}
        </DisclosureRow>
        <DisclosureRow label="Model" value="claude-sonnet-4.5" open={false} onToggle={() => {}}>
          {null}
        </DisclosureRow>
      </Group>
      <Group id="new-decks" title="New decks" footer="Each deck can change its own.">
        <DisclosureRow label="Desired retention" value="90%" open={false} onToggle={() => {}}>
          {null}
        </DisclosureRow>
        <DisclosureRow label="Answer mode" value="Write the answer" open={false} onToggle={() => {}}>
          {null}
        </DisclosureRow>
        <DisclosureRow label="Math macros" value="3 macros" open={false} onToggle={() => {}}>
          {null}
        </DisclosureRow>
      </Group>
    </>
  );
}
