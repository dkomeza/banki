// PROTOTYPE (BAN-11): the name and description fields every Variant's create
// and edit forms share.
import { useId } from "react";
import { Field, FIELD } from "@/components/settings/parts";
import { cn } from "@/lib/utils";

export function DeckFields({
  name,
  description,
  onName,
  onDescription,
  error,
  autoFocus,
  rows = 4,
}: {
  name: string;
  description: string;
  onName: (v: string) => void;
  onDescription: (v: string) => void;
  error: string | undefined;
  autoFocus?: boolean;
  rows?: number;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-4">
      <Field
        label="Name"
        value={name}
        maxLength={100}
        autoFocus={autoFocus}
        autoComplete="off"
        error={error}
        onChange={(e) => onName(e.target.value)}
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="text-sm font-medium">
          Description <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id={id}
          rows={rows}
          maxLength={1000}
          value={description}
          onChange={(e) => onDescription(e.target.value)}
          className={cn(
            FIELD,
            "h-auto min-h-24 resize-y border border-input py-3 leading-relaxed outline-none focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring focus-visible:outline-solid lg:h-auto",
          )}
        />
      </div>
    </div>
  );
}

/** "Deck not found", with the way back to Home. */
export { NotFound } from "./not-found";
