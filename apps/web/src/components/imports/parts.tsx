import { type CardFileProblem, formatProblems, frontKey } from "@banki/shared";
import { Check, Copy } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Field, useCardForm } from "@/components/cards/card-editor";
import { CardLine } from "@/components/cards/card-text";
import { TagField, useTagInput } from "@/components/cards/tag-field";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { type Card, fieldErrors } from "@/lib/cards";
import { cn } from "@/lib/utils";
import type { FileCard, ImageProblem, MacroPlan } from "./fixtures";
import type { CardEdit, DuplicateOf } from "./use-preview";

// Prototype only (BAN-32): the pieces every Variant's import screens share.

/** The `?state=` a prototype screen shows, or none for its plain load. */
export const stateSearch = (search: Record<string, unknown>): { state?: string } =>
  typeof search.state === "string" ? { state: search.state } : {};

/** Copies `formatProblems`' text, and says so for a moment. */
export function CopyProblems({
  problems,
  className,
}: {
  problems: readonly CardFileProblem[];
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      className={cn(OUTLINE_PILL, "h-11", className)}
      onClick={() => {
        void navigator.clipboard?.writeText(formatProblems(problems)).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
    >
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      {copied ? "Copied" : "Copy problems"}
    </Button>
  );
}

/** "card 14" for a Card's number, as the problem lines name it. */
export const cardLabel = (number: number) => `Card ${number}`;

/** A Macro plan's line: what happened to it, in words. */
const lower = (text: string) => `${text.charAt(0).toLowerCase()}${text.slice(1)}`;

export function macroLine(macro: MacroPlan): string {
  if (macro.outcome === "added") return `${macro.name} will be added to the Deck's macros.`;
  if (macro.outcome === "kept") {
    return `${macro.name} is defined differently in this Deck; the Deck's definition is kept.`;
  }
  return `${macro.name} can't be added: ${lower(macro.reason)}`;
}

/** The same, once the Import is confirmed. */
export function macroReportLine(macro: MacroPlan): string {
  if (macro.outcome === "added") return `${macro.name} was added to the Deck's macros.`;
  if (macro.outcome === "kept") {
    return `${macro.name} was defined differently in the Deck; the Deck's definition was kept.`;
  }
  return `${macro.name} wasn't added: ${lower(macro.reason)}`;
}

/** An image problem's line, naming its file. */
export const imageLine = (image: ImageProblem) => `${image.file}: ${image.detail}`;

/** What a Duplicate is a Duplicate of, as a short line. */
export function DuplicateLabel({ of, className }: { of: DuplicateOf; className?: string }) {
  return (
    <span className={cn("flex min-w-0 items-baseline gap-1", className)}>
      <span className="shrink-0">
        {"deck" in of ? "Already in this deck:" : `Repeats card ${of.file}:`}
      </span>
      <CardLine
        text={"deck" in of ? of.deck.front : of.front}
        className="min-w-0 font-medium text-foreground"
      />
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
  card: FileCard;
  deckCards: readonly Card[];
  /** The file's other ticked Cards, which the Front may repeat. */
  others: readonly FileCard[];
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
      tags: nextTags,
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
          inDeck !== undefined || inFile !== undefined ? (
            <p className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-sm">
              <Copy aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <DuplicateLabel
                of={
                  inDeck !== undefined
                    ? { deck: inDeck }
                    : { file: inFile!.number, front: inFile!.front }
                }
              />
            </p>
          ) : null
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

/** "Today, 12:42"-style, for the report's dateline. */
export function confirmedLabel(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}
