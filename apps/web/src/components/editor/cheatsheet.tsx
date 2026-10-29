import { Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef } from "react";
import { typeset } from "@/lib/formula";
import { GROUPS, type LatexCommand, previewOf, search } from "./latex-commands";

// The LaTeX cheatsheet (BAN-21), Variant b "Result pane": a panel docked at
// the page's right edge from 1024 px (the writing page moves over to make
// room), a sheet over the lower part of the screen below that, so the side
// stays in view above it. One list under sticky group headings, a row per
// command: its render, its command and its meaning. A row inserts its snippet
// and the panel stays open, like a palette.

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
  const box = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
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

  return (
    <aside
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
        <span className="cheatsheet-count">
          {searching ? `${found.length} found` : `${found.length} commands`}
        </span>
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
          placeholder="Search by name or meaning"
          onChange={(event) => onQuery(event.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        {searching && (
          <button
            type="button"
            className="cheatsheet-clear"
            aria-label="Clear the search"
            onClick={() => {
              onQuery("");
              input.current?.focus();
            }}
          >
            <X aria-hidden className="size-3.5" />
          </button>
        )}
      </label>
      <div className="cheatsheet-list">
        {groups.length === 0 && (
          <div className="cheatsheet-empty" role="status">
            <p>No command matches “{query.trim()}”.</p>
            <p>Search by a name like \sqrt, or a meaning like “root” or “arrow”.</p>
          </div>
        )}
        {searching && groups.length > 0 && (
          <p className="sr-only" role="status">
            {found.length} found
          </p>
        )}
        {groups.map(({ group, commands }) => (
          <section key={group} aria-labelledby={`${id}-${group}`}>
            <h3 id={`${id}-${group}`} className="cheatsheet-group">
              {group}
              <span>{commands.length}</span>
            </h3>
            <ul>
              {commands.map((command) => (
                <li key={command.name}>
                  <button
                    type="button"
                    className="cheatsheet-row"
                    aria-label={`${command.name}, ${command.meaning}`}
                    onClick={() => onInsert(command)}
                  >
                    <Render command={command} />
                    <code className="cheatsheet-name">{command.snippet.replaceAll("▯", "□")}</code>
                    <span className="cheatsheet-meaning">{command.meaning}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p className="cheatsheet-foot">Click a command to put it at the cursor.</p>
    </aside>
  );
}
