import {
  DEFAULT_MODEL_ID,
  effectiveModelId,
  isModelId,
  type Model,
  MODELS,
  type ModelId,
  modelById,
} from "@banki/shared";
import { useCallback } from "react";
import { Combobox, type ComboboxOption } from "@/components/settings/combobox";
import { matchModels, ratingsOf } from "@/lib/grading";
import { cn } from "@/lib/utils";

const nameOf = (model: Model) => `${model.name} · ${model.maker}`;

const OPTIONS: readonly ComboboxOption[] = MODELS.map((model) => ({
  value: model.id,
  label: nameOf(model),
}));

/**
 * A Model's Handwriting, Speed and Cost: dots or dollar signs on screen, the
 * same in words for screen readers ("Handwriting: good").
 */
export function Ratings({ model, className }: { model: Model; className?: string }) {
  return (
    <span className={cn("flex flex-wrap gap-x-4 gap-y-1 text-sm", className)}>
      {ratingsOf(model).map((rating) => (
        <span key={rating.aspect} className="flex items-baseline gap-1.5">
          <span className="sr-only">{rating.words}</span>
          <span aria-hidden className="text-muted-foreground">
            {rating.aspect}
          </span>
          {rating.marks === "untested" ? (
            <span aria-hidden className="font-medium">
              Untested
            </span>
          ) : (
            <span aria-hidden className="font-medium tracking-[0.12em]">
              {rating.marks === "dots" ? (
                <>
                  {"●".repeat(rating.filled)}
                  <span className="text-muted-foreground">{"○".repeat(3 - rating.filled)}</span>
                </>
              ) : (
                "$".repeat(rating.filled)
              )}
            </span>
          )}
        </span>
      ))}
    </span>
  );
}

/** "Default", beside the default Model. */
function DefaultBadge() {
  return (
    <span className="shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground">
      Default
    </span>
  );
}

/** One Model in the list: its name and maker, its sentence and its ratings. */
function ModelOption({ option }: { option: ComboboxOption }) {
  const model = modelById(effectiveModelId(option.value));
  return (
    <span className="flex flex-col gap-1">
      <span className="flex items-center justify-between gap-3">
        <span className="min-w-0 font-medium group-aria-selected/option:font-semibold group-aria-selected/option:text-primary">
          {nameOf(model)}
        </span>
        {model.id === DEFAULT_MODEL_ID && <DefaultBadge />}
      </span>
      <span className="text-sm text-muted-foreground">{model.sentence}</span>
      <Ratings model={model} />
    </span>
  );
}

/** The Model picker: Banki's curated list, narrowed by name or maker as you type. */
export function ModelCombobox({
  value,
  onChange,
  labelledBy,
  describedBy,
}: {
  value: ModelId;
  onChange: (model: ModelId) => void;
  labelledBy: string;
  describedBy?: string;
}) {
  const search = useCallback((query: string) => {
    const ids = new Set<string>(matchModels(MODELS, query).map((model) => model.id));
    return OPTIONS.filter((option) => ids.has(option.value));
  }, []);
  return (
    <Combobox
      options={OPTIONS}
      value={value}
      onPick={(model) => {
        if (isModelId(model)) onChange(model);
      }}
      search={search}
      labelledBy={labelledBy}
      describedBy={describedBy}
      placeholder="Pick a Model"
      searchPlaceholder="Search: Claude, Gemini or Google"
      noMatch={(query) => `No Model matches “${query}”.`}
      chevron
      renderOption={(option) => <ModelOption option={option} />}
    />
  );
}

/** What the chosen Model is good at, under the field. */
export function ModelSummary({ id, model }: { id: string; model: Model }) {
  return (
    <div id={id} className="flex flex-col gap-1.5">
      <p className="text-sm text-muted-foreground">{model.sentence}</p>
      <Ratings model={model} />
    </div>
  );
}
