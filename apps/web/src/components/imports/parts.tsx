import { type ImportCard, frontKey } from "@banki/shared";
import { Check, Copy } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Field, useCardForm } from "@/components/cards/card-editor";
import { CardLine } from "@/components/cards/card-text";
import { TagField, useTagInput } from "@/components/cards/tag-field";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { type Card, fieldErrors } from "@/lib/cards";
import { cn } from "@/lib/utils";
import type { CardEdit, DuplicateOf } from "./use-preview";

// The pieces the import screens share: copying problems for an LLM, a
// Duplicate's line, and a Card's fields in the card editor's own.

/** Copies `text`, and says so for a moment. */
export function CopyButton({
  text,
  label,
  className,
}: {
  text: string;
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <Button
      type="button"
      variant="outline"
      className={cn(OUTLINE_PILL, "h-11", className)}
      onClick={() => {
        void navigator.clipboard?.writeText(text).catch(() => {});
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1600);
      }}
    >
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      {copied ? "Copied" : label}
    </Button>
  );
}

/** What a Duplicate is a Duplicate of, as a short line. */
export function DuplicateLabel({ of, className }: { of: DuplicateOf; className?: string }) {
  return (
    <span className={cn("flex min-w-0 items-baseline gap-1", className)}>
      <span className="shrink-0">
        {"deck" in of ? "Already in this deck:" : `Repeats card ${of.number}:`}
      </span>
      <CardLine text={of.front} className="min-w-0 font-medium text-foreground" />
    </span>
  );
}

/**
 * A Card's four fields in the card editor's own fields, with its rules and
 * its live Duplicate note, Done keeping the edit and Cancel dropping it.
 */
export function EditFields({
  card,
  deckCards,
  others,
  onDone,
  onCancel,
  className,
  foot,
}: {
  card: ImportCard;
  deckCards: readonly Card[];
  /** The file's other ticked Cards, which the Front may repeat. */
  others: readonly ImportCard[];
  onDone: (edit: CardEdit) => void;
  onCancel: () => void;
  className?: string;
  /** Extra content beside the buttons. */
  foot?: ReactNode;
}) {
  const form = useCardForm({
    front: card.front,
    back: card.back,
    gradingNotes: card.gradingNotes ?? "",
  });
  const tags = useTagInput(card.tags);
  const key = frontKey(form.fields.front);
  const inDeck = key === "" ? undefined : deckCards.find((c) => frontKey(c.front) === key);
  const inFile =
    key === ""
      ? undefined
      : others.find((c) => c.number < card.number && frontKey(c.front) === key);
  const duplicateOf: DuplicateOf | undefined =
    inDeck !== undefined
      ? { deck: inDeck, front: inDeck.front }
      : inFile !== undefined
        ? { number: inFile.number, front: inFile.front }
        : undefined;
  const done = () => {
    const nextTags = tags.commit();
    if (nextTags === false) return;
    const errors = fieldErrors(form.fields);
    if (Object.keys(errors).length > 0) {
      form.setErrors(errors);
      return;
    }
    onDone({
      front: form.fields.front,
      back: form.fields.back,
      gradingNotes: form.fields.gradingNotes.trim() === "" ? null : form.fields.gradingNotes,
      tags: [...nextTags],
    });
  };
  const props = (field: "front" | "back" | "gradingNotes") => ({
    value: form.fields[field],
    error: form.errors[field],
    readOnly: false,
    onChange: (value: string) => form.set(field, value),
    onSubmit: done,
  });
  return (
    <div className={cn("flex flex-col gap-7", className)}>
      <Field
        label="Front"
        placeholder="What to be asked"
        inputRef={form.frontRef}
        autoFocus
        note={
          duplicateOf === undefined ? null : (
            <p className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-sm">
              <Copy aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <DuplicateLabel of={duplicateOf} />
            </p>
          )
        }
        {...props("front")}
      />
      <Field
        label="Back"
        placeholder="What to recall"
        inputRef={form.backRef}
        className="sm:mt-7 lg:mt-3"
        {...props("back")}
      />
      <Field
        label="Grading notes"
        placeholder="What an answer must include, or may vary in"
        inputRef={form.notesRef}
        className="sm:mt-7 lg:mt-3"
        {...props("gradingNotes")}
      />
      <TagField input={tags} onSave={done} />
      <div className="flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:pl-22">
        <div className="min-w-0 flex-1 text-sm text-muted-foreground">{foot}</div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            className={cn(OUTLINE_PILL, "h-11 lg:h-10")}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button type="button" className={cn(PILL, "h-11 lg:h-10")} onClick={done}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}

/** "Monday 26 October at 12:42": when an Import was confirmed, for the report's dateline. */
export function confirmedLabel(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}
