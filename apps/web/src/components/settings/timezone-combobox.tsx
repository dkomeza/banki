import { useEffect, useId, useMemo, useRef, useState } from "react";
import { FIELD } from "@/components/settings/parts";
import { Input } from "@/components/ui/input";
import { offsetOf } from "@/lib/time";
import { cn } from "@/lib/utils";

/** Every zone this browser knows, plus UTC, which some list only as an alias. */
function allZones(): string[] {
  const zones = Intl.supportedValuesOf("timeZone");
  return zones.includes("UTC") ? zones : [...zones, "UTC"];
}

/** At most this many matches are drawn; typing narrows the rest. */
const SHOWN = 200;

/**
 * The zones matching `query` (part of a name, or an offset such as "utc+2"):
 * cities that start with it first, then zones with any part that does, then
 * the rest.
 */
function search(zones: readonly { zone: string; offset: string }[], query: string) {
  const q = query.trim().toLowerCase().replaceAll(" ", "_");
  if (q === "") return zones;
  const rank = (zone: string) => {
    const name = zone.toLowerCase();
    if ((name.split("/").at(-1) ?? "").startsWith(q)) return 0;
    if (name.split(/[/_-]/).some((part) => part.startsWith(q))) return 1;
    return 2;
  };
  return zones
    .filter(
      ({ zone, offset }) =>
        zone.toLowerCase().includes(q) || offset.toLowerCase().replace("−", "-").includes(q),
    )
    .toSorted((a, b) => rank(a.zone) - rank(b.zone));
}

/**
 * The Timezone picker: a searchable list of IANA zones with their UTC offsets
 * now. Focusing it opens the list; typing narrows it; Enter or a click picks
 * one; Escape or leaving it keeps the value it had.
 */
export function TimezoneCombobox({
  value,
  onChange,
  labelledBy,
  describedBy,
}: {
  value: string | null;
  onChange: (timezone: string) => void;
  labelledBy: string;
  describedBy?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const zones = useMemo(() => allZones().map((zone) => ({ zone, offset: offsetOf(zone) })), []);
  const results = useMemo(() => search(zones, query), [zones, query]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };
  const pick = (zone: string) => {
    close();
    if (zone !== value) onChange(zone);
  };

  return (
    <div className="relative">
      <Input
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-autocomplete="list"
        aria-activedescendant={open && results.length > 0 ? `${id}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        className={FIELD}
        value={open ? query : (value ?? "")}
        placeholder={open ? "Search: a city, region or UTC+2" : "Pick your timezone"}
        onFocus={() => {
          setOpen(true);
          setActive(0);
        }}
        onBlur={close}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActive((index) => Math.min(index + 1, Math.min(results.length, SHOWN) - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter" && open) {
            event.preventDefault();
            const chosen = results[active];
            if (chosen !== undefined) pick(chosen.zone);
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            close();
          }
        }}
      />
      {open && (
        <ul
          ref={listRef}
          id={`${id}-list`}
          role="listbox"
          aria-labelledby={labelledBy}
          className="absolute inset-x-0 top-full z-30 mt-2 max-h-80 overflow-y-auto rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-xl"
        >
          {results.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              No timezone matches “{query}”.
            </li>
          )}
          {results.slice(0, SHOWN).map(({ zone, offset }, index) => (
            <li
              key={zone}
              id={`${id}-${index}`}
              data-index={index}
              role="option"
              aria-selected={zone === value}
              className={cn(
                "flex min-h-11 cursor-default items-center justify-between gap-3 rounded-lg px-3 text-[0.95rem] aria-selected:font-semibold aria-selected:text-primary lg:min-h-9",
                index === active && "bg-accent",
              )}
              // Picks before the input's blur closes the list.
              onPointerDown={(event) => {
                event.preventDefault();
                pick(zone);
              }}
              onPointerEnter={() => setActive(index)}
            >
              <span className="min-w-0 truncate">{zone.replaceAll("_", " ")}</span>
              <span className="shrink-0 text-sm text-muted-foreground tabular-nums">{offset}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
