import { X } from "lucide-react";
import { useId, useRef } from "react";
import { cn } from "@/lib/utils";
import type { TagInput } from "./tags";

// Variant b: the Tags field is written like the sides, on a ruled line with
// its label in the margin. The Tags sit on that line as soft accent chips
// before the word being typed, and the suggestions are a row of chips under
// it, picked by tap or with the arrows and Enter.

export function TagField({ input, autoFocus = false }: { input: TagInput; autoFocus?: boolean }) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:gap-6">
      <label
        htmlFor={id}
        className="pt-1 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase sm:w-16 sm:shrink-0 sm:pt-2.5 sm:text-right"
      >
        Tags
      </label>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- the input inside takes the keys */}
        <div
          onClick={() => ref.current?.focus()}
          className={cn(
            "flex min-h-11 flex-wrap items-center gap-x-1 gap-y-1.5 border-b px-0.5 pb-1.5 focus-within:border-ring",
            input.error !== undefined && "border-destructive focus-within:border-destructive",
          )}
        >
          {input.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex h-8 items-center rounded-md bg-primary/10 pl-2 text-[0.95rem] font-medium text-primary lg:h-7"
            >
              <span aria-hidden className="mr-px opacity-60">
                #
              </span>
              {tag}
              <button
                type="button"
                aria-label={`Remove ${tag}`}
                onClick={() => input.remove(tag)}
                className="ml-0.5 flex size-8 items-center justify-center rounded-md opacity-70 hover:bg-primary/15 hover:opacity-100 lg:size-7"
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
            aria-describedby={input.error === undefined ? undefined : `${id}-error`}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus={autoFocus}
            value={input.draft}
            placeholder={input.tags.length === 0 ? "Add tags, one word each" : "Add a tag"}
            onChange={(event) => input.change(event.target.value)}
            onKeyDown={input.keyDown}
            onBlur={input.blur}
            className="h-8 min-w-28 flex-1 bg-transparent px-1 text-[1.05rem] outline-none placeholder:text-muted-foreground/70"
          />
        </div>
        {input.error !== undefined && (
          <p id={`${id}-error`} className="text-sm font-medium text-destructive">
            {input.error}
          </p>
        )}
        {input.open && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm text-muted-foreground">Suggested</span>
            <ul id={`${id}-list`} role="listbox" aria-label="Suggested tags" className="contents">
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
                    "inline-flex h-9 cursor-default items-center rounded-full border border-dashed px-3 text-sm font-medium lg:h-7",
                    index === input.active
                      ? "border-solid border-primary bg-primary/10 text-primary"
                      : "border-input text-foreground",
                  )}
                >
                  + {tag}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
