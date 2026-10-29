import { ChevronDown } from "lucide-react";
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { FIELD } from "@/components/settings/parts";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type ComboboxOption = {
  value: string;
  /** What the list shows. */
  label: string;
  /** What the input shows once it is picked, if not the label. */
  display?: string;
  /** A note at the option's end, such as a zone's UTC offset. */
  detail?: string;
};

/**
 * A searchable picker: an input (`role="combobox"`) over a list of options.
 * Focusing or clicking it opens the list; typing narrows it with `search`;
 * the arrow keys move through it, Enter or a click (or tap) picks one, and
 * Escape or leaving it keeps the value it had. After a pick, focus stays with
 * the text selected, so typing starts a new search. A touch swipe scrolls the
 * list without picking.
 */
export function Combobox({
  options,
  value,
  onPick,
  search,
  labelledBy,
  describedBy,
  placeholder,
  searchPlaceholder,
  noMatch,
  chevron = false,
  renderOption,
  autoFocus = false,
}: {
  options: readonly ComboboxOption[];
  value: string | null;
  onPick: (value: string) => void;
  /** The options matching what's typed, best first; all of them for an empty query. */
  search: (query: string) => readonly ComboboxOption[];
  labelledBy: string;
  describedBy?: string;
  /** Shown while nothing is picked. */
  placeholder: string;
  /** Shown in the open, empty input. */
  searchPlaceholder: string;
  noMatch: (query: string) => string;
  chevron?: boolean;
  /** Draws an option in the list, in place of its label and detail on one line. */
  renderOption?: (option: ComboboxOption) => ReactNode;
  /** PROTOTYPE: focuses (and so opens) the picker on mount. */
  autoFocus?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Every match is drawn (about 420 zones at most), so the whole list can be browsed.
  const results = useMemo(() => search(query), [search, query]);
  const picked = options.find((option) => option.value === value);

  // Opening centres the current choice in the list.
  const centre = useRef(false);

  // Keeps the active option in view, scrolling only the list, never the page.
  useEffect(() => {
    const list = listRef.current;
    const item = list?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!open || !list || !item) return;
    if (centre.current) {
      centre.current = false;
      list.scrollTop = item.offsetTop - (list.clientHeight - item.offsetHeight) / 2;
    } else if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop;
    else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight;
    }
  }, [open, active]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };
  /** Opens the whole list, starting at the current choice. */
  const openList = () => {
    centre.current = true;
    setOpen(true);
    setQuery("");
    setActive(
      Math.max(
        search("").findIndex((option) => option.value === value),
        0,
      ),
    );
  };
  const pick = (chosen: string) => {
    close();
    if (chosen !== value) onPick(chosen);
    window.requestAnimationFrame(() => {
      if (document.activeElement === inputRef.current) inputRef.current?.select();
    });
  };

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={open}
        // Only while the list is there to point at.
        aria-controls={open ? `${id}-list` : undefined}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-autocomplete="list"
        aria-activedescendant={open && results.length > 0 ? `${id}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        className={cn(FIELD, chevron && "pr-10 lg:pr-10")}
        value={open ? query : (picked?.display ?? picked?.label ?? value ?? "")}
        placeholder={open ? searchPlaceholder : placeholder}
        onFocus={openList}
        // Already focused after a pick: a click opens the list again.
        onClick={() => {
          if (!open) openList();
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
            setActive((index) => Math.min(index + 1, results.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter" && open) {
            event.preventDefault();
            const chosen = results[active];
            if (chosen !== undefined) pick(chosen.value);
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            close();
          }
        }}
      />
      {chevron && (
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-4 size-4 -translate-y-1/2 text-muted-foreground"
        />
      )}
      {open && (
        <ul
          ref={listRef}
          id={`${id}-list`}
          role="listbox"
          aria-labelledby={labelledBy}
          className="absolute inset-x-0 top-full z-30 mt-2 max-h-80 overflow-y-auto rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-xl"
        >
          {results.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted-foreground">{noMatch(query)}</li>
          )}
          {results.map((option, index) => (
            <li
              key={option.value}
              id={`${id}-${index}`}
              data-index={index}
              role="option"
              aria-selected={option.value === value}
              className={cn(
                "group/option min-h-11 cursor-default rounded-lg px-3 text-[0.95rem] lg:min-h-9",
                renderOption === undefined
                  ? "flex items-center justify-between gap-3 aria-selected:font-semibold aria-selected:text-primary"
                  : "py-2.5",
                index === active && "bg-accent",
              )}
              // Keeps the input focused, so its blur doesn't close the list before
              // the click lands. A touch swipe sends no mousedown or click, so it
              // scrolls the list without picking.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(option.value)}
              onPointerEnter={() => setActive(index)}
            >
              {renderOption === undefined ? (
                <>
                  <span className="min-w-0 truncate">{option.label}</span>
                  {option.detail !== undefined && (
                    <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                      {option.detail}
                    </span>
                  )}
                </>
              ) : (
                renderOption(option)
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
