import { Check, LoaderCircle } from "lucide-react";
import { type ComponentProps, type ReactNode, useId } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// The pieces the Settings page's cards are built from (docs/design.md: cards
// hold sections; rows show a value with an action; buttons are pills).

/** A Settings section: a rounded card with a hairline border and an `h2`. */
export function SettingsCard({
  id,
  title,
  className,
  children,
}: {
  id: string;
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn(
        "flex scroll-mt-28 flex-col gap-5 rounded-[1.25rem] border bg-card p-5 text-card-foreground sm:p-6",
        className,
      )}
    >
      <h2 id={`${id}-title`} className="text-xl font-semibold tracking-tight">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A pill-shaped button, on top of Button's variants. */
export const PILL = "rounded-full px-5 lg:h-10 lg:px-5";

/** An outlined pill: an action that isn't the primary one. */
export const OUTLINE_PILL = cn(PILL, "border-input bg-background dark:bg-input/20");

/** A field's look on the Settings page: roomier than a sign-in form's. */
export const FIELD =
  "h-12 rounded-xl bg-background px-4 text-base md:text-base lg:h-11 lg:px-4 dark:bg-input/20";

/** A value with its label, and the action that changes it beside it. */
export function Row({
  label,
  value,
  action,
  wrap = false,
}: {
  label: string;
  value: ReactNode;
  action?: ReactNode;
  /**
   * Lets a value that is a sentence wrap rather than be cut short; where it
   * would get too narrow, the action moves under it.
   */
  wrap?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-3", wrap && "flex-wrap")}>
      <div className={cn("min-w-0 flex-1", wrap && "min-w-40")}>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className={cn("text-[1.05rem] font-medium", wrap ? "text-pretty" : "truncate")}>
          {value}
        </p>
      </div>
      {action}
    </div>
  );
}

/** A labelled field with a hint or an error under it. */
export function Field({
  label,
  error,
  hint,
  ...input
}: { label: string; error?: string | undefined; hint?: string } & ComponentProps<"input">) {
  const id = useId();
  const note = error ?? hint;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Input
        id={id}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={note === undefined ? undefined : `${id}-note`}
        className={FIELD}
        {...input}
      />
      {note !== undefined && (
        <p
          id={`${id}-note`}
          className={cn(
            "text-sm",
            error === undefined ? "text-muted-foreground" : "font-medium text-destructive",
          )}
        >
          {note}
        </p>
      )}
    </div>
  );
}

/** The short confirmation that replaces a form once it worked. */
export function Done({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="flex items-start gap-2.5 rounded-xl bg-accent p-3.5 text-[0.95rem]">
      <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
      {/* A long Email breaks anywhere rather than run out of the box. */}
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
    </p>
  );
}

/** "Saving" or "Saved", quietly, beside a preference that saves as it changes. */
export function SaveState({ state }: { state: "saving" | "saved" | undefined }) {
  return (
    <span aria-live="polite" className="flex items-center gap-1 text-sm text-muted-foreground">
      {state === "saving" && (
        <>
          <LoaderCircle aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />
          Saving
        </>
      )}
      {state === "saved" && (
        <>
          <Check aria-hidden className="size-3.5 text-primary" />
          Saved
        </>
      )}
    </span>
  );
}
