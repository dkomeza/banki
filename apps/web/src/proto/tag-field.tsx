import { X } from "lucide-react";
import { useId, useRef } from "react";
import { cn } from "@/lib/utils";
import type { TagInput } from "./tags";

// Variant a: the Tags field is a token field on the writing page, its label in
// the margin like Front and Back: the Tags as chips, then the word being typed,
// with the suggestions in a list under it.

export function TagField({ input, autoFocus = false }: { input: TagInput; autoFocus?: boolean }) {
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
              className="inline-flex h-8 items-center gap-0.5 rounded-full bg-secondary pr-0.5 pl-3 text-sm font-medium text-secondary-foreground lg:h-7"
            >
              {tag}
              <button
                type="button"
                aria-label={`Remove ${tag}`}
                onClick={() => input.remove(tag)}
                className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground lg:size-6"
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
            autoFocus={autoFocus}
            value={input.draft}
            placeholder={input.tags.length === 0 ? "verb, irregular, exam…" : "Add a tag"}
            onChange={(event) => input.change(event.target.value)}
            onKeyDown={input.keyDown}
            onBlur={input.blur}
            className="h-8 min-w-24 flex-1 bg-transparent px-1.5 text-[0.95rem] outline-none placeholder:text-muted-foreground/70"
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
  const at = tag.indexOf(draft.trim().toLowerCase());
  if (at === -1 || draft.trim() === "") return <span>{tag}</span>;
  const end = at + draft.trim().length;
  return (
    <span>
      {tag.slice(0, at)}
      <span className="font-semibold">{tag.slice(at, end)}</span>
      {tag.slice(end)}
    </span>
  );
}
