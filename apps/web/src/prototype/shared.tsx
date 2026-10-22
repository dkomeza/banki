// PROTOTYPE (BAN-9), throwaway branch only: never merges.
// Three variants of the Settings page and the signed-in shell, switchable via
// `?variant=a|b|c`, each state reachable via `&state=<name>`. Everything here
// is faked client-side: no Settings API exists yet.

import { useQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { meQueryOptions } from "@/lib/me";
import { cn } from "@/lib/utils";

export type VariantKey = "a" | "b" | "c" | "d" | "e";

export const VARIANTS: readonly { key: VariantKey; name: string }[] = [
  { key: "a", name: "Paper & ink, Settings in the nav" },
  { key: "b", name: "Ruled card, grouped rows" },
  { key: "c", name: "Sage & marigold, study day first" },
  { key: "d", name: "Round 2: Paper & ink page, account menu kept" },
  { key: "e", name: "Round 2: Paper & ink page, account menu folded in" },
];

/** States per route, for the switcher. The plain load is `default`. */
export const STATES: Record<string, readonly string[]> = {
  "/settings": [
    "default",
    "tz-mismatch",
    "tz-open",
    "email-editing",
    "email-error",
    "password-editing",
    "password-done",
    "save-error",
    "full",
    "index-open",
  ],
  "/": ["default", "account-open"],
};

export function useVariant(): VariantKey {
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const v = search["variant"];
  return v === "b" || v === "c" || v === "d" || v === "e" ? v : "a";
}

export function useProtoState(): string {
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const s = search["state"];
  return typeof s === "string" ? s : "default";
}

/** Puts `data-proto` on <html>, which prototype.css keys each variant's tokens off. */
export function useVariantTokens(variant: VariantKey) {
  useLayoutEffect(() => {
    document.documentElement.dataset["proto"] = variant;
  }, [variant]);
}

export function useEmail(): string {
  const me = useQuery(meQueryOptions);
  return me.data?.email ?? "ui@example.com";
}

// --- Time -------------------------------------------------------------------

/** 4 → "4:00 a.m.", 0 → "midnight", 12 → "noon". */
export function formatHour(h: number): string {
  if (h === 0) return "midnight";
  if (h === 12) return "noon";
  return h < 12 ? `${h}:00 a.m.` : `${h - 12}:00 p.m.`;
}

/** The half hour before the Day start, as an example review time. */
export function exampleBefore(h: number): string {
  const prev = (h + 23) % 24;
  const label = prev === 0 ? 12 : prev > 12 ? prev - 12 : prev;
  return `${label}:30 ${prev < 12 ? "a.m." : "p.m."}`;
}

/** The sentence that shows what the Day start does. */
export function dayStartEffect(h: number): string {
  if (h === 0) return "Study days follow the calendar: each one starts at midnight.";
  return `Each Study day runs from ${formatHour(h)} to ${formatHour(h)}, so a review at ${exampleBefore(h)} counts toward the day before.`;
}

const ALL_ZONES: string[] = (
  Intl as unknown as { supportedValuesOf(key: string): string[] }
).supportedValuesOf("timeZone");

export const ZONES = ALL_ZONES.includes("UTC") ? ALL_ZONES : [...ALL_ZONES, "UTC"];

/** "UTC+2", "UTC−3:30", "UTC" for the zone, now. */
export function offsetOf(tz: string): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" })
    .formatToParts(new Date())
    .find((p) => p.type === "timeZoneName")?.value;
  return (part ?? "GMT").replace("GMT", "UTC").replace("-", "−");
}

/** "Europe/Warsaw" → "Warsaw"; "America/Argentina/Buenos_Aires" → "Buenos Aires". */
export function cityOf(tz: string): string {
  return (tz.split("/").at(-1) ?? tz).replaceAll("_", " ");
}

export function zonesByRegion(): [string, string[]][] {
  const groups = new Map<string, string[]>();
  for (const z of ZONES) {
    const region = z.includes("/") ? z.split("/")[0]! : "Other";
    groups.set(region, [...(groups.get(region) ?? []), z]);
  }
  return [...groups.entries()];
}

// --- Fake Settings ------------------------------------------------------------

export type Field = "timezone" | "dayStart";
export type SaveStatus =
  | { field: Field; kind: "saving" }
  | { field: Field; kind: "saved" }
  | { field: Field; kind: "error"; attempted: string | number }
  | null;

export const STORED_TIMEZONE = "Europe/Warsaw";

/**
 * The Timezone and Day start, saved straight away (faked, 500 ms). In the
 * `save-error` state every save fails and the value goes back.
 */
export function useStudyDayPrefs(state: string) {
  const [timezone, setTimezone] = useState(STORED_TIMEZONE);
  const [dayStart, setDayStart] = useState(4);
  const deviceTimezone = state === "tz-mismatch" ? "Europe/London" : STORED_TIMEZONE;
  const [save, setSave] = useState<SaveStatus>(
    state === "save-error" ? { field: "dayStart", kind: "error", attempted: 6 } : null,
  );
  const fails = state === "save-error";
  const timer = useRef<number | undefined>(undefined);

  const commit = (field: Field, value: string | number) => {
    const before = field === "timezone" ? timezone : dayStart;
    if (field === "timezone") setTimezone(String(value));
    else setDayStart(Number(value));
    setSave({ field, kind: "saving" });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (fails) {
        if (field === "timezone") setTimezone(String(before));
        else setDayStart(Number(before));
        setSave({ field, kind: "error", attempted: value });
      } else {
        setSave({ field, kind: "saved" });
        timer.current = window.setTimeout(() => setSave(null), 2000);
      }
    }, 500);
  };

  return {
    timezone,
    dayStart,
    deviceTimezone,
    mismatch: deviceTimezone !== timezone,
    save,
    setTimezone: (tz: string) => commit("timezone", tz),
    setDayStart: (h: number) => commit("dayStart", h),
    retry: () => {
      if (save?.kind === "error") commit(save.field, save.attempted);
    },
  };
}

export type Prefs = ReturnType<typeof useStudyDayPrefs>;

/** The error line a failed save shows. */
export function saveErrorText(save: Extract<SaveStatus, { kind: "error" }>, prefs: Prefs): string {
  return save.field === "dayStart"
    ? `The change to ${formatHour(Number(save.attempted))} didn't save, so Day start is still ${formatHour(prefs.dayStart)}${prefs.dayStart === 0 || prefs.dayStart === 12 ? "." : ""}`
    : `The change to ${String(save.attempted)} didn't save, so Timezone is still ${prefs.timezone}.`;
}

// --- Fake account forms -------------------------------------------------------

export function useAccountForms(state: string, email: string) {
  const [currentEmail, setCurrentEmail] = useState(email);
  useEffect(() => setCurrentEmail(email), [email]);

  const emailFilled = state === "email-editing" || state === "email-error";
  const [emailOpen, setEmailOpen] = useState(emailFilled);
  const [newEmail, setNewEmail] = useState(emailFilled ? "dawid@example.com" : "");
  const [emailPassword, setEmailPassword] = useState(emailFilled ? "correct horse" : "");
  const [emailError, setEmailError] = useState<string | null>(
    state === "email-error" ? "That Password isn't right." : null,
  );
  const [emailDone, setEmailDone] = useState<string | null>(null);

  const pwFilled = state === "password-editing";
  const [pwOpen, setPwOpen] = useState(pwFilled);
  const [currentPw, setCurrentPw] = useState(pwFilled ? "correct horse" : "");
  const [newPw, setNewPw] = useState(pwFilled ? "battery staple 42" : "");
  const [pwError, setPwError] = useState<{ field: "current" | "new"; text: string } | null>(null);
  const [pwDone, setPwDone] = useState(state === "password-done");

  return {
    email: {
      current: currentEmail,
      open: emailOpen,
      newEmail,
      password: emailPassword,
      error: emailError,
      done: emailDone,
      setNewEmail,
      setPassword: (v: string) => {
        setEmailPassword(v);
        setEmailError(null);
      },
      start: () => {
        setEmailOpen(true);
        setEmailDone(null);
      },
      cancel: () => {
        setEmailOpen(false);
        setEmailError(null);
        setNewEmail("");
        setEmailPassword("");
      },
      submit: () => {
        if (state === "email-error" || emailPassword === "") {
          setEmailError("That Password isn't right.");
          return;
        }
        setCurrentEmail(newEmail);
        setEmailDone(newEmail);
        setEmailOpen(false);
        setNewEmail("");
        setEmailPassword("");
      },
    },
    password: {
      open: pwOpen,
      current: currentPw,
      next: newPw,
      error: pwError,
      done: pwDone,
      setCurrent: (v: string) => {
        setCurrentPw(v);
        setPwError(null);
      },
      setNext: (v: string) => {
        setNewPw(v);
        setPwError(null);
      },
      start: () => {
        setPwOpen(true);
        setPwDone(false);
      },
      cancel: () => {
        setPwOpen(false);
        setPwError(null);
        setCurrentPw("");
        setNewPw("");
      },
      submit: () => {
        if (newPw.length < 8) {
          setPwError({ field: "new", text: "Use at least 8 characters." });
          return;
        }
        if (newPw.length > 128) {
          setPwError({ field: "new", text: "Use at most 128 characters." });
          return;
        }
        setPwOpen(false);
        setPwDone(true);
        setCurrentPw("");
        setNewPw("");
      },
    },
  };
}

export type AccountForms = ReturnType<typeof useAccountForms>;

export const PASSWORD_DONE =
  "Password changed. Every other device is signed out; this one stays signed in.";

// --- Timezone combobox (shared behaviour, styled by each variant) -------------

export type ComboboxClasses = {
  root?: string;
  input: string;
  list: string;
  option: string;
  optionActive: string;
  offset: string;
  empty: string;
};

/** A searchable list of IANA zones. Type a city, a region or an offset. */
export function TimezoneCombobox({
  value,
  onChange,
  classes,
  initialQuery,
  labelledBy,
}: {
  value: string;
  onChange: (tz: string) => void;
  classes: ComboboxClasses;
  initialQuery?: string;
  labelledBy?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(initialQuery !== undefined);
  const [query, setQuery] = useState(initialQuery ?? "");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase().replaceAll(" ", "_");
    const withOffsets = ZONES.map((z) => ({ zone: z, offset: offsetOf(z) }));
    if (q === "") return withOffsets;
    // Cities that start with the query first, then any part that does, then the rest.
    const rank = (zone: string) => {
      const z = zone.toLowerCase();
      if ((z.split("/").at(-1) ?? "").startsWith(q)) return 0;
      if (z.split(/[/_-]/).some((part) => part.startsWith(q))) return 1;
      return 2;
    };
    return withOffsets
      .filter(
        ({ zone, offset }) =>
          zone.toLowerCase().includes(q) || offset.toLowerCase().replace("−", "-").includes(q),
      )
      .sort((a, b) => rank(a.zone) - rank(b.zone));
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (tz: string) => {
    onChange(tz);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={rootRef} className={cn("relative", classes.root)}>
      <input
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-labelledby={labelledBy}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        className={classes.input}
        value={open ? query : value}
        placeholder={open ? `Search: a city, region or UTC+2` : undefined}
        onFocus={() => {
          setOpen(true);
          setActive(0);
        }}
        onBlur={() => {
          setOpen(false);
          setQuery("");
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && open && results[active]) {
            e.preventDefault();
            pick(results[active].zone);
          } else if (e.key === "Escape") {
            setOpen(false);
            setQuery("");
          }
        }}
      />
      {open && (
        <ul ref={listRef} id={`${id}-list`} role="listbox" tabIndex={-1} className={classes.list}>
          {results.length === 0 && <li className={classes.empty}>No timezone matches “{query}”.</li>}
          {results.slice(0, 200).map(({ zone, offset }, i) => (
            <li
              key={zone}
              id={`${id}-${i}`}
              data-index={i}
              role="option"
              aria-selected={zone === value}
              className={cn(classes.option, i === active && classes.optionActive)}
              onPointerDown={(e) => {
                e.preventDefault();
                pick(zone);
              }}
              onPointerEnter={() => setActive(i)}
            >
              <span className="min-w-0 truncate">{zone.replaceAll("_", " ")}</span>
              <span className={classes.offset}>{offset}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** `true` when a desktop-width viewport shows the sidebar (≥1024 px). */
export function isWide(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;
}
