import type { Macro } from "@banki/shared";
import { Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { typeset } from "@/lib/formula";
import { type CommandGroup, GROUPS, type LatexCommand, previewOf, search } from "./latex-commands";

// The LaTeX cheatsheet: a card that drops
// from the toolbar over the side being written (a sheet from the bottom on a
// phone), its groups as chips along the top and its commands as tiles, each
// with its render, its command and its meaning. The Deck's Macros come first,
// in a group of their own, when it has any, each meaning its definition. A
// tile inserts its snippet and closes the card.

function Render({ command, macros }: { command: LatexCommand; macros: readonly Macro[] }) {
  const html = useMemo(() => {
    const result = typeset(previewOf(command), false, macros);
    return "html" in result ? result.html : "";
  }, [command, macros]);
  // oxlint-disable-next-line react/no-danger
  return (
    <span aria-hidden className="cheatsheet-render" dangerouslySetInnerHTML={{ __html: html }} />
  );
}

export function Cheatsheet({
  query,
  macros,
  onQuery,
  onInsert,
  onClose,
  onLeave,
}: {
  query: string;
  /** The Deck's effective Macros, listed first. */
  macros: readonly Macro[];
  onQuery: (query: string) => void;
  onInsert: (command: LatexCommand) => void;
  onClose: () => void;
  /** Called as the focus leaves it for elsewhere on the page, which keeps the focus. */
  onLeave: () => void;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const shownGroups: readonly CommandGroup[] = macros.length === 0 ? GROUPS : ["Macros", ...GROUPS];
  const [current, setCurrent] = useState<CommandGroup>(shownGroups[0] ?? "Greek");
  /** The group a chip jumped to, kept current while its section is in view. */
  const picked = useRef<CommandGroup | null>(null);
  const found = useMemo(() => search(query, macros), [query, macros]);
  const groups = shownGroups
    .map((group) => ({
      group,
      commands: found.filter((command) => command.group === group),
    }))
    .filter(({ commands }) => commands.length > 0);

  useEffect(() => {
    input.current?.focus({ preventScroll: true });
    const away = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (box.current?.contains(target) || target?.closest("[data-cheatsheet-button]")) return;
      onClose();
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The list is positioned, so each section's offsetTop is from the list's top.
  const jump = (group: CommandGroup) => {
    setCurrent(group);
    picked.current = group;
    const section = list.current?.querySelector(`[data-group="${group}"]`);
    if (section instanceof HTMLElement) list.current?.scrollTo({ top: section.offsetTop });
  };

  return (
    <>
      <div aria-hidden className="cheatsheet-scrim" />
      <div
        ref={box}
        role="dialog"
        aria-labelledby={`${id}-title`}
        className="cheatsheet"
        onBlur={(event) => {
          const to = event.relatedTarget;
          if (!(to instanceof Element) || box.current?.contains(to)) return;
          if (to.closest("[data-cheatsheet-button]") === null) onLeave();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="cheatsheet-head">
          <h2 id={`${id}-title`} className="cheatsheet-title">
            LaTeX cheatsheet
          </h2>
          <button type="button" className="cheatsheet-close" aria-label="Close" onClick={onClose}>
            <X aria-hidden className="size-4" />
          </button>
        </div>
        <label className="cheatsheet-search">
          <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="sr-only">Search commands</span>
          <input
            ref={input}
            type="search"
            value={query}
            placeholder="Search: integral, arrow, \frac…"
            onChange={(event) => onQuery(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        {query.trim() === "" && (
          <nav className="cheatsheet-chips" aria-label="Groups">
            {shownGroups.map((group) => (
              <button
                key={group}
                type="button"
                aria-current={current === group ? "true" : undefined}
                className="cheatsheet-chip"
                // Its width is the bold label's, so it keeps it as it is picked.
                data-label={group}
                onClick={() => jump(group)}
              >
                <span>{group}</span>
              </button>
            ))}
          </nav>
        )}
        <div
          ref={list}
          className="cheatsheet-list"
          onScroll={(event) => {
            if (query.trim() !== "") return;
            const { scrollTop, clientHeight } = event.currentTarget;
            const sections = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-group]")];
            // A group jumped to near the end can't scroll to the top: it stays current while seen.
            const jumped = sections.find((section) => section.dataset.group === picked.current);
            if (
              jumped !== undefined &&
              jumped.offsetTop >= scrollTop - 1 &&
              jumped.offsetTop < scrollTop + clientHeight
            )
              return;
            picked.current = null;
            let at: CommandGroup = shownGroups[0] ?? "Greek";
            for (const section of sections)
              if (section.offsetTop <= scrollTop + 8)
                at = shownGroups.find((group) => group === section.dataset.group) ?? at;
            setCurrent(at);
          }}
        >
          {groups.length === 0 && (
            <p className="cheatsheet-empty" role="status">
              Nothing matches “{query.trim()}”.
              <span>Try a word like “integral”, “arrow” or “matrix”.</span>
            </p>
          )}
          {query.trim() !== "" && groups.length > 0 && (
            <p className="sr-only" role="status">
              {found.length} found
            </p>
          )}
          {groups.map(({ group, commands }) => (
            <section key={group} data-group={group} aria-label={group}>
              <h3 className="cheatsheet-group">{group}</h3>
              <div className="cheatsheet-tiles">
                {commands.map((command) => (
                  <button
                    key={command.name}
                    type="button"
                    className="cheatsheet-tile"
                    title={command.meaning}
                    aria-label={`${command.name}, ${command.meaning}`}
                    onClick={() => onInsert(command)}
                  >
                    <Render command={command} macros={macros} />
                    <span className="cheatsheet-name">{command.name}</span>
                    <span className="cheatsheet-meaning">{command.meaning}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
