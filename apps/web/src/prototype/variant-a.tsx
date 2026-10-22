// PROTOTYPE (BAN-9), variant a: "Paper & ink, Settings in the nav".
// Bet: keep BAN-8's tokens and shell as they are; add Settings as a nav item
// beside Home and leave the account menu/sheet (Email, theme, Sign out) where
// it is, with a link to Settings. The page is a classic settings form: each
// section a heading column beside its controls, native selects for the pickers.

import { Link } from "@tanstack/react-router";
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Globe,
  House,
  LoaderCircle,
  type LucideIcon,
  Settings,
} from "lucide-react";
import { type ReactNode, useId } from "react";
import { AccountMenu, AccountSheet } from "@/components/account";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  type AccountForms,
  type Field,
  type Prefs,
  PASSWORD_DONE,
  dayStartEffect,
  formatHour,
  isWide,
  offsetOf,
  saveErrorText,
  useAccountForms,
  useEmail,
  useProtoState,
  useStudyDayPrefs,
  zonesByRegion,
} from "./shared";

type NavItem = { to: "/" | "/settings"; label: string; icon: LucideIcon };
const NAV: readonly NavItem[] = [
  { to: "/", label: "Home", icon: House },
  { to: "/settings", label: "Settings", icon: Settings },
];
const SEARCH = { variant: "a" } as never;

function SettingsLink() {
  return (
    <Link
      to="/settings"
      search={SEARCH}
      className="-mx-2 flex h-11 items-center gap-2.5 rounded-lg px-2 text-sm text-foreground no-underline hover:bg-muted lg:h-9"
    >
      <Settings aria-hidden className="size-4 text-muted-foreground" />
      <span className="flex-1">Settings</span>
      <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
    </Link>
  );
}

export function ShellA({ children }: { children: ReactNode }) {
  const state = useProtoState();
  const open = state === "account-open";
  const wide = isWide();
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
                  search={SEARCH}
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
        <AccountMenu defaultOpen={open && wide} extra={<SettingsLink />} />
      </aside>
      <div className="pb-[calc(4rem+env(safe-area-inset-bottom))] lg:p-0">
        <main className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 lg:px-10 lg:py-12">
          {children}
        </main>
      </div>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-10 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        <div className="mx-auto flex h-16 max-w-md items-stretch gap-1 px-2 py-1.5">
          {NAV.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              search={SEARCH}
              activeOptions={{ exact: true, includeSearch: false }}
              className={`${TAB} no-underline aria-[current=page]:text-primary`}
            >
              <Icon aria-hidden className="size-5" />
              {label}
            </Link>
          ))}
          <AccountSheet
            defaultOpen={open && !wide}
            triggerClassName={`${TAB} data-popup-open:text-foreground`}
            extra={<SettingsLink />}
          />
        </div>
      </nav>
    </div>
  );
}

const TAB =
  "flex flex-1 flex-col items-center justify-center gap-0.5 rounded-lg text-xs font-medium text-muted-foreground transition-colors";

// --- The page -----------------------------------------------------------------

export function SettingsA() {
  const state = useProtoState();
  const prefs = useStudyDayPrefs(state);
  const forms = useAccountForms(state, useEmail());
  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Kept on the server, so they apply on every device you sign in on.
        </p>
      </header>
      <Section title="Study days" blurb="When Banki's day ends and the next begins, for due cards and statistics.">
        <TimezoneRow prefs={prefs} />
        <DayStartRow prefs={prefs} />
      </Section>
      {state === "full" && <FutureSections />}
      <Section title="Account" blurb="What you sign in with.">
        <EmailRow forms={forms} />
        <PasswordRow forms={forms} />
      </Section>
    </div>
  );
}

function Section({ title, blurb, children }: { title: string; blurb: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="grid gap-4 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-8">
      <div className="flex flex-col gap-1">
        <h2 id={id} className="text-base font-semibold tracking-tight">
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">{blurb}</p>
      </div>
      <div className="divide-y rounded-xl border bg-card">{children}</div>
    </section>
  );
}

function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-2.5 p-4 sm:p-5", className)}>{children}</div>;
}

function SaveState({ prefs, field }: { prefs: Prefs; field: Field }) {
  const s = prefs.save;
  if (!s || s.field !== field || s.kind === "error") return null;
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground" aria-live="polite">
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

function SaveError({ prefs, field }: { prefs: Prefs; field: Field }) {
  const s = prefs.save;
  if (!s || s.field !== field || s.kind !== "error") return null;
  return (
    <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-destructive">
      <CircleAlert aria-hidden className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">{saveErrorText(s, prefs)}</span>
      <Button variant="outline" size="sm" onClick={prefs.retry}>
        Try again
      </Button>
    </div>
  );
}

function Select({
  id,
  value,
  onChange,
  children,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full appearance-none rounded-lg border border-input bg-transparent pr-9 pl-3 text-base outline-none focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring lg:h-9 lg:text-sm dark:bg-input/30"
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}

function TimezoneRow({ prefs }: { prefs: Prefs }) {
  const id = useId();
  return (
    <Row>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          Timezone
        </label>
        <SaveState prefs={prefs} field="timezone" />
      </div>
      <Select id={id} value={prefs.timezone} onChange={prefs.setTimezone}>
        {zonesByRegion().map(([region, zones]) => (
          <optgroup key={region} label={region}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replaceAll("_", " ")} ({offsetOf(z)})
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
      <p className="text-sm text-muted-foreground">
        Banki counts your days in this timezone on every device, even when you travel.
      </p>
      <SaveError prefs={prefs} field="timezone" />
      {prefs.mismatch && (
        <div className="flex flex-col gap-3 rounded-lg bg-accent p-3 text-sm sm:flex-row sm:items-center">
          <Globe aria-hidden className="hidden size-4 shrink-0 text-primary sm:block" />
          <p className="min-w-0 flex-1">
            This device is in {prefs.deviceTimezone} ({offsetOf(prefs.deviceTimezone)}).
          </p>
          <Button variant="outline" size="sm" onClick={() => prefs.setTimezone(prefs.deviceTimezone)}>
            Use {prefs.deviceTimezone}
          </Button>
        </div>
      )}
    </Row>
  );
}

function DayStartRow({ prefs }: { prefs: Prefs }) {
  const id = useId();
  return (
    <Row>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          Day start
        </label>
        <SaveState prefs={prefs} field="dayStart" />
      </div>
      <Select id={id} value={String(prefs.dayStart)} onChange={(v) => prefs.setDayStart(Number(v))}>
        {Array.from({ length: 24 }, (_, h) => (
          <option key={h} value={h}>
            {formatHour(h)}
            {h === 4 ? " (default)" : ""}
          </option>
        ))}
      </Select>
      <p className="text-sm text-muted-foreground">{dayStartEffect(prefs.dayStart)}</p>
      <SaveError prefs={prefs} field="dayStart" />
    </Row>
  );
}

function Field({
  label,
  type,
  value,
  onChange,
  hint,
  error,
  autoComplete,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  error?: string | null;
  autoComplete?: string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Input
        id={id}
        type={type}
        value={value}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-d` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {(error || hint) && (
        <p id={`${id}-d`} className={cn("text-sm", error ? "text-destructive" : "text-muted-foreground")}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

function Done({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="flex items-start gap-2 rounded-lg bg-accent p-3 text-sm">
      <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
      {children}
    </p>
  );
}

function EmailRow({ forms }: { forms: AccountForms }) {
  const f = forms.email;
  return (
    <Row>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Email</p>
          <p className="truncate text-sm text-muted-foreground">{f.current}</p>
        </div>
        {!f.open && (
          <Button variant="outline" onClick={f.start}>
            Change
          </Button>
        )}
      </div>
      {f.done && <Done>Email changed. Sign in with {f.done} from now on.</Done>}
      {f.open && (
        <form
          className="flex flex-col gap-4 pt-2"
          onSubmit={(e) => {
            e.preventDefault();
            f.submit();
          }}
        >
          <Field label="New Email" type="email" value={f.newEmail} onChange={f.setNewEmail} autoComplete="email" />
          <Field
            label="Current Password"
            type="password"
            value={f.password}
            onChange={f.setPassword}
            error={f.error}
            hint="To make sure it's you."
            autoComplete="current-password"
          />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={f.cancel}>
              Cancel
            </Button>
            <Button type="submit">Change Email</Button>
          </div>
        </form>
      )}
    </Row>
  );
}

function PasswordRow({ forms }: { forms: AccountForms }) {
  const f = forms.password;
  return (
    <Row>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Password</p>
          <p className="text-sm text-muted-foreground">Changing it signs out every other device.</p>
        </div>
        {!f.open && (
          <Button variant="outline" onClick={f.start}>
            Change
          </Button>
        )}
      </div>
      {f.done && <Done>{PASSWORD_DONE}</Done>}
      {f.open && (
        <form
          className="flex flex-col gap-4 pt-2"
          onSubmit={(e) => {
            e.preventDefault();
            f.submit();
          }}
        >
          <Field
            label="Current Password"
            type="password"
            value={f.current}
            onChange={f.setCurrent}
            error={f.error?.field === "current" ? f.error.text : null}
            autoComplete="current-password"
          />
          <Field
            label="New Password"
            type="password"
            value={f.next}
            onChange={f.setNext}
            hint="8 to 128 characters."
            error={f.error?.field === "new" ? f.error.text : null}
            autoComplete="new-password"
          />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={f.cancel}>
              Cancel
            </Button>
            <Button type="submit">Change Password</Button>
          </div>
        </form>
      )}
    </Row>
  );
}

/** state=full: the sections later issues add, to judge how the layout scales. */
function FutureSections() {
  return (
    <>
      <Section title="Grading" blurb="The model that reads and grades your written answers.">
        <Row>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">OpenRouter API key</p>
              <p className="truncate text-sm text-muted-foreground">sk-or-…3f9a</p>
            </div>
            <Button variant="outline">Change</Button>
          </div>
        </Row>
        <Row>
          <p className="text-sm font-medium">Model</p>
          <Select id="model" value="m" onChange={() => {}}>
            <option value="m">anthropic/claude-sonnet-4.5</option>
          </Select>
        </Row>
      </Section>
      <Section title="New decks" blurb="What a deck starts with. Each deck can change its own.">
        <Row>
          <p className="text-sm font-medium">Desired retention</p>
          <Select id="ret" value="90" onChange={() => {}}>
            <option value="90">90%</option>
          </Select>
        </Row>
        <Row>
          <p className="text-sm font-medium">Answer mode</p>
          <Select id="mode" value="w" onChange={() => {}}>
            <option value="w">Write the answer</option>
          </Select>
        </Row>
        <Row>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Math macros</p>
              <p className="text-sm text-muted-foreground">3 macros, such as \R for ℝ</p>
            </div>
            <Button variant="outline">Edit</Button>
          </div>
        </Row>
      </Section>
    </>
  );
}
