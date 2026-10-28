import { sortTags } from "@banki/shared";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { type KeyboardEvent, useId, useRef, useState } from "react";
import { suggestTags, tagOf, tagProblem, tagsQueryOptions } from "@/lib/tags";
import { cn } from "@/lib/utils";

// The Tags field on the writing page: a token field, its label in the margin
// like Front and Back, the Tags as chips with ×, then the word being typed,
// with the User's Tags suggested in a list under it, and the hint or the
// error beneath.

/**
 * The Tags field's state: the Tags as chips (A–Z), the word being typed, its
 * error, and the suggestions for it. Space, comma or Enter ends a Tag;
 * Backspace in an empty field removes the last one; arrows and Enter, a click
 * or a tap pick a suggestion. A word breaking the rules, or a 21st Tag, shows
 * an error and stays typed, not added.
 */
export function useTagInput(initial: readonly string[]) {
  const [tags, setTags] = useState<readonly string[]>(initial);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const all = useQuery(tagsQueryOptions()).data;
  const suggestions = suggestTags(all ?? [], draft, tags);
  const listed = open && suggestions.length > 0;

  /** Adds a word to `current`, answering the Tags with it, or false when it was refused. */
  const add = (raw: string, current = tags): readonly string[] | false => {
    const word = raw.trim();
    if (word === "") return current;
    const problem = tagProblem(word, current);
    if (problem !== undefined) {
      setError(problem);
      return false;
    }
    const tag = tagOf(word);
    const next = current.includes(tag) ? current : sortTags([...current, tag]);
    setTags(next);
    setDraft("");
    setError(undefined);
    setActive(0);
    return next;
  };

  return {
    tags,
    draft,
    error,
    open: listed,
    suggestions,
    active,
    setActive,
    remove: (tag: string) => setTags(tags.filter((t) => t !== tag)),
    pick: (tag: string) => {
      add(tag);
      setOpen(false);
    },
    change: (value: string) => {
      setError(undefined);
      setOpen(true);
      setActive(0);
      // A typed or pasted space or comma ends each Tag before it.
      const parts = value.split(/[\s,]+/);
      const rest = parts.pop() ?? "";
      let current = tags;
      for (const part of parts) {
        const next = add(part, current);
        if (next === false) {
          setDraft(value.replace(/[\s,]+$/, ""));
          return;
        }
        current = next;
      }
      setDraft(rest);
    },
    /**
     * Adds what's still typed, as a save does first: the Tags to save, or
     * false when the word is refused, its error showing.
     */
    commit: () => add(draft),
    /** Shows `next` as the Tags, nothing typed: after a save, the kept ones. */
    reset: (next: readonly string[]) => {
      setTags(next);
      setDraft("");
      setError(undefined);
    },
    blur: () => setOpen(false),
    keyDown: (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowDown" && listed) {
        event.preventDefault();
        setActive((i) => Math.min(i + 1, suggestions.length - 1));
      } else if (event.key === "ArrowUp" && listed) {
        event.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
      } else if (event.key === "Enter" && listed && suggestions[active] !== undefined) {
        event.preventDefault();
        add(suggestions[active]);
        setOpen(false);
      } else if (event.key === "Enter") {
        // Ends the Tag typed, and never submits the form by itself.
        event.preventDefault();
        add(draft);
      } else if (event.key === "Escape" && listed) {
        event.preventDefault();
        setOpen(false);
      } else if (event.key === "Backspace" && draft === "" && tags.length > 0) {
        event.preventDefault();
        setError(undefined);
        setTags(tags.slice(0, -1));
      }
    },
  };
}

export type TagInput = ReturnType<typeof useTagInput>;

/** The Tags field, under Front and Back; Ctrl/Cmd+Enter in it saves, as in the sides. */
export function TagField({
  input,
  readOnly = false,
  onSave,
}: {
  input: TagInput;
  readOnly?: boolean;
  onSave: () => void;
}) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:gap-6">
      <label
        htmlFor={id}
        className="pt-1 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase sm:w-16 sm:shrink-0 sm:pt-3 sm:text-right"
      >
        Tags
      </label>
      <div className="relative flex min-w-0 flex-1 flex-col gap-1.5">
        {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- the input inside takes the keys */}
        <div
          onClick={() => ref.current?.focus()}
          className={cn(
            "flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl border border-input bg-background/60 px-2 py-1.5 focus-within:border-ring focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-ring focus-within:outline-solid",
            input.error !== undefined && "border-destructive focus-within:outline-destructive",
          )}
        >
          {input.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex h-8 min-w-0 items-center gap-0.5 rounded-full bg-secondary pr-0.5 pl-3 text-sm font-medium text-secondary-foreground lg:h-7"
            >
              <span className="truncate">{tag}</span>
              <button
                type="button"
                aria-label={`Remove ${tag}`}
                disabled={readOnly}
                onClick={() => input.remove(tag)}
                className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground lg:size-6"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </span>
          ))}
          <input
            id={id}
            ref={ref}
            role="combobox"
            aria-expanded={input.open}
            aria-controls={input.open ? `${id}-list` : undefined}
            aria-activedescendant={input.open ? `${id}-${input.active}` : undefined}
            aria-autocomplete="list"
            aria-invalid={input.error === undefined ? undefined : true}
            aria-describedby={`${id}-help`}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            readOnly={readOnly}
            value={input.draft}
            placeholder={input.tags.length === 0 ? "verb, irregular, exam…" : "Add a tag"}
            onChange={(event) => input.change(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                onSave();
              } else input.keyDown(event);
            }}
            onBlur={input.blur}
            className="h-8 min-w-24 flex-1 bg-transparent px-1.5 text-base outline-none placeholder:text-muted-foreground/70 lg:text-[0.95rem]"
          />
        </div>
        {input.open && (
          <ul
            id={`${id}-list`}
            role="listbox"
            aria-label="Suggested tags"
            className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-xl"
          >
            {input.suggestions.map((tag, index) => (
              <li
                key={tag}
                id={`${id}-${index}`}
                role="option"
                aria-selected={index === input.active}
                // Keeps the focus in the field, so the list stays open for the click.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => input.pick(tag)}
                onPointerEnter={() => input.setActive(index)}
                className={cn(
                  "flex min-h-11 cursor-default items-center rounded-lg px-3 text-[0.95rem] lg:min-h-9",
                  index === input.active && "bg-accent",
                )}
              >
                <Match tag={tag} draft={input.draft} />
              </li>
            ))}
          </ul>
        )}
        <p
          id={`${id}-help`}
          aria-live="polite"
          className={cn(
            "text-sm",
            input.error === undefined ? "text-muted-foreground" : "font-medium text-destructive",
          )}
        >
          {input.error ?? "Space, comma or Enter adds a tag."}
        </p>
      </div>
    </div>
  );
}

/** A suggestion, with the part typed so far in bold. */
function Match({ tag, draft }: { tag: string; draft: string }) {
  const typed = tagOf(draft.trim());
  const at = typed === "" ? -1 : tag.indexOf(typed);
  if (at === -1) return <span>{tag}</span>;
  const end = at + typed.length;
  return (
    <span>
      {tag.slice(0, at)}
      <span className="font-semibold">{tag.slice(at, end)}</span>
      {tag.slice(end)}
    </span>
  );
}
