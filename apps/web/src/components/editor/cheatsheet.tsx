import { Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { typeset } from "@/lib/formula";
import { type CommandGroup, GROUPS, type LatexCommand, previewOf, search } from "./latex-commands";

// The LaTeX cheatsheet (BAN-21), Variant c "Reference": a modal reference
// sheet over the page (the whole screen on a phone), its groups in a rail
// down the left like a section index, its commands in a dense table of
// render, command and meaning under each group's heading. A row inserts its
// snippet and closes the sheet.

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
  const searching = query.trim() !== "";

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
        aria-modal="true"
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
        <header className="cheatsheet-head">
          <div>
            <h2 id={`${id}-title`} className="cheatsheet-title">
              LaTeX reference
            </h2>
            <p className="cheatsheet-sub">Pick a command to put it at the cursor.</p>
          </div>
          <button type="button" className="cheatsheet-close" aria-label="Close" onClick={onClose}>
            <X aria-hidden className="size-4" />
          </button>
        </header>
        <label className="cheatsheet-search">
          <Search aria-hidden className="size-4 shrink-0" />
          <span className="sr-only">Search commands</span>
          <input
            ref={input}
            type="search"
            value={query}
            placeholder="Search 235 commands by name, keyword or meaning"
            onChange={(event) => onQuery(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <div className="cheatsheet-body">
          <nav className="cheatsheet-rail" aria-label="Groups">
            {GROUPS.map((group) => {
              const count = found.filter((command) => command.group === group).length;
              return (
                <button
                  key={group}
                  type="button"
                  aria-current={!searching && current === group ? "location" : undefined}
                  disabled={count === 0}
                  className="cheatsheet-rail-item"
                  onClick={() => jump(group)}
                >
                  <span>{group}</span>
                  <span className="cheatsheet-rail-count">{count}</span>
                </button>
              );
            })}
          </nav>
          <div
            ref={list}
            className="cheatsheet-list"
            onScroll={(event) => {
              const top = event.currentTarget.scrollTop + event.currentTarget.offsetTop + 8;
              let at: CommandGroup = current;
              for (const section of event.currentTarget.querySelectorAll<HTMLElement>(
                "[data-group]",
              ))
                if (section.offsetTop <= top)
                  at = GROUPS.find((group) => group === section.dataset.group) ?? at;
              setCurrent(at);
            }}
          >
            {groups.length === 0 && (
              <div className="cheatsheet-empty" role="status">
                <p className="cheatsheet-empty-title">Nothing found for “{query.trim()}”</p>
                <p>Try what it does (“root”, “arrow”, “matrix”) or how it starts (“\sq”).</p>
                <button type="button" className="cheatsheet-reset" onClick={() => onQuery("")}>
                  Clear the search
                </button>
              </div>
            )}
            {searching && groups.length > 0 && (
              <p className="sr-only" role="status">
                {found.length} found
              </p>
            )}
            {groups.map(({ group, commands }) => (
              <section key={group} data-group={group} aria-labelledby={`${id}-${group}`}>
                <h3 id={`${id}-${group}`} className="cheatsheet-group">
                  {group}
                </h3>
                <div className="cheatsheet-table">
                  {commands.map((command) => (
                    <button
                      key={command.name}
                      type="button"
                      className="cheatsheet-row"
                      aria-label={`${command.name}, ${command.meaning}`}
                      onClick={() => onInsert(command)}
                    >
                      <Render command={command} />
                      <code className="cheatsheet-name">
                        {command.snippet.replaceAll("▯", "□")}
                      </code>
                      <span className="cheatsheet-meaning">{command.meaning}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
