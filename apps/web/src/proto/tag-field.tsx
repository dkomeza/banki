import { Plus, X } from "lucide-react";
import { useId } from "react";
import { cn } from "@/lib/utils";
import { allTags, type TagInput } from "./tags";

// Variant c: the Tags are the writing card's last row, full width under a
// hairline: outlined accent chips, then an "Add tag" pill that the word is
// typed into. The suggestions drop down from it, and a word that isn't a Tag
// yet is offered as a new one.

export function TagField({ input, autoFocus = false }: { input: TagInput; autoFocus?: boolean }) {
  const id = useId();
  const word = input.draft.trim().toLowerCase();
  const isNew =
    word !== "" &&
    !allTags().includes(word) &&
    !input.tags.includes(word) &&
    input.suggestions.length === 0;
  return (
    <div className="-mx-4 flex flex-col gap-2.5 border-t border-dashed px-4 pt-5 sm:-mx-6 sm:px-6">
      <div className="flex items-baseline justify-between gap-3">
        <label
          htmlFor={id}
          className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase"
        >
          Tags
        </label>
        <span className="text-xs text-muted-foreground tabular-nums">{input.tags.length} / 20</span>
      </div>
      <div className="relative flex flex-wrap items-center gap-2">
        {input.tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex h-9 items-center gap-1 rounded-full border border-primary/45 pr-1 pl-3.5 text-sm font-medium text-foreground lg:h-8"
          >
            {tag}
            <button
              type="button"
              aria-label={`Remove ${tag}`}
              onClick={() => input.remove(tag)}
              className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-primary/10 hover:text-primary lg:size-6"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </span>
        ))}
        <div className="relative">
          <Plus
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <input
            id={id}
            role="combobox"
            aria-expanded={input.open}
            aria-controls={input.open ? `${id}-list` : undefined}
            aria-activedescendant={input.open ? `${id}-${input.active}` : undefined}
            aria-autocomplete="list"
            aria-invalid={input.error === undefined ? undefined : true}
            aria-describedby={input.error === undefined ? undefined : `${id}-error`}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus={autoFocus}
            value={input.draft}
            placeholder="Add tag"
            onChange={(event) => input.change(event.target.value)}
            onKeyDown={input.keyDown}
            onBlur={input.blur}
            style={{ width: `${Math.max(input.draft.length + 2, 9)}ch` }}
            className={cn(
              "h-9 max-w-full rounded-full border border-dashed border-input bg-transparent pr-3 pl-8 text-sm outline-none placeholder:text-muted-foreground focus:border-solid focus:border-ring focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring focus-visible:outline-solid lg:h-8",
              input.error !== undefined && "border-solid border-destructive",
            )}
          />
          {(input.open || isNew) && input.error === undefined && (
            <ul
              id={`${id}-list`}
              role="listbox"
              aria-label="Suggested tags"
              className="absolute top-full left-0 z-30 mt-1.5 w-60 rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-xl"
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
                    "flex min-h-11 cursor-default items-center gap-2 rounded-lg px-3 text-[0.95rem] lg:min-h-9",
                    index === input.active && "bg-accent",
                  )}
                >
                  <span aria-hidden className="text-muted-foreground">
                    #
                  </span>
                  {tag}
                </li>
              ))}
              {isNew && (
                <li
                  role="option"
                  aria-selected={false}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => input.add(input.draft)}
                  className="flex min-h-11 cursor-default items-center gap-2 rounded-lg border-t px-3 text-sm text-muted-foreground lg:min-h-9"
                >
                  Enter adds “{word}” as a new tag
                </li>
              )}
            </ul>
          )}
        </div>
      </div>
      {input.error !== undefined && (
        <p id={`${id}-error`} className="text-sm font-medium text-destructive">
          {input.error}
        </p>
      )}
    </div>
  );
}
