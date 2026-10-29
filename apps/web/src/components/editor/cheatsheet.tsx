import { Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { typeset } from "@/lib/formula";
import { type CommandGroup, GROUPS, type LatexCommand, previewOf, search } from "./latex-commands";

// The LaTeX cheatsheet: a card that drops
// from the toolbar over the side being written (a sheet from the bottom on a
// phone), its groups as chips along the top and its commands as tiles, each
// with its render, its command and its meaning. A tile inserts its snippet and
// closes the card.

function Render({ command }: { command: LatexCommand }) {
  const html = useMemo(() => {
    const result = typeset(previewOf(command), false);
    return "html" in result ? result.html : "";
  }, [command]);
  // oxlint-disable-next-line react/no-danger
  return (
    <span aria-hidden className="cheatsheet-render" dangerouslySetInnerHTML={{ __html: html }} />
  );
}

export function Cheatsheet({
  query,
  onQuery,
  onInsert,
  onClose,
}: {
  query: string;
  onQuery: (query: string) => void;
  onInsert: (command: LatexCommand) => void;
  onClose: () => void;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [current, setCurrent] = useState<CommandGroup>("Greek");
  const found = useMemo(() => search(query), [query]);
  const groups = GROUPS.map((group) => ({
    group,
    commands: found.filter((command) => command.group === group),
  })).filter(({ commands }) => commands.length > 0);

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

  const jump = (group: CommandGroup) => {
    setCurrent(group);
    const section = list.current?.querySelector(`[data-group="${group}"]`);
    if (section instanceof HTMLElement && list.current !== null)
      list.current.scrollTo({ top: section.offsetTop - list.current.offsetTop });
  };

  return (
    <>
      <div aria-hidden className="cheatsheet-scrim" />
      <div
        ref={box}
        role="dialog"
        aria-labelledby={`${id}-title`}
        className="cheatsheet"
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
            {GROUPS.map((group) => (
              <button
                key={group}
                type="button"
                aria-current={current === group ? "true" : undefined}
                className="cheatsheet-chip"
                // Its width is the bold label's, so it keeps it as it is picked.
                data-label={group}
                onClick={() => jump(group)}
              >
                {group}
              </button>
            ))}
          </nav>
        )}
        <div
          ref={list}
          className="cheatsheet-list"
          onScroll={(event) => {
            if (query.trim() !== "") return;
            const top = event.currentTarget.scrollTop + event.currentTarget.offsetTop + 8;
            let at: CommandGroup = "Greek";
            for (const section of event.currentTarget.querySelectorAll<HTMLElement>("[data-group]"))
              if (section.offsetTop <= top)
                at = GROUPS.find((group) => group === section.dataset.group) ?? at;
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
                    <Render command={command} />
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
