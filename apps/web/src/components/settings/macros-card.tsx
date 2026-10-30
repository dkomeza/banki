import { type Macro, macroArity } from "@banki/shared";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CircleAlert, Info, Plus, Trash2 } from "lucide-react";
import {
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { OUTLINE_PILL, SaveState, SettingsCard } from "@/components/settings/parts";
import { RetentionError } from "@/components/settings/retention-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deckMacrosSaverFor } from "@/lib/deck-macros";
import type { Deck } from "@/lib/decks";
import { NO_MACROS, typeset } from "@/lib/formula";
import {
  type Checked,
  checkRow,
  type MacroRow,
  macrosSaveErrorText,
  keptOf,
  newRowId,
  reconcile,
  rowsFor,
  sameMacros,
  sampleOf,
  toSave,
} from "@/lib/macros";
import { settingsQueryOptions } from "@/lib/settings";
import { shownSettings } from "@/lib/settings-saver";
import { settingsSaverFor } from "@/lib/settings-store";
import { cn } from "@/lib/utils";
import "katex/dist/katex.min.css";

// The Math macros card, in Settings and in Deck settings (BAN-22's Reference,
// Variant d). A Macro reads like every other row on the page: its render, its
// name and definition, and Edit beside them. Edit turns the row itself into
// its form, easing open: the name and definition become fields where they
// were read, and the tile beside them renders as you type. There is no Done:
// the row closes when focus leaves it, or on Escape. A row is checked as it
// is written, and saved once it is written and has no problem; one with a
// problem closes too, and says under it that it isn't saved. On a Deck, its
// own rows come first, and Settings' follow, each with Override, which gives
// the Deck its own copy to change.

const MONO = "font-mono text-[0.95rem] md:text-[0.9rem]";

/** Where a list is saved, and how it is doing. */
type Saving = {
  /** The list as saved, with the changes on their way on top. */
  shown: readonly Macro[];
  save: (macros: Macro[]) => void;
  state: "saving" | "saved" | undefined;
  /** What a failed save says, until it is tried again or replaced. */
  failure: string | undefined;
  retry: () => void;
};

/** Settings' Math macros card, in the masonry: Macros for every Deck. */
export function MacrosCard() {
  const queryClient = useQueryClient();
  // Loads the Settings, which the saver starts from.
  useSuspenseQuery(settingsQueryOptions());
  const saver = settingsSaverFor(queryClient);
  const state = useSyncExternalStore(saver.subscribe, saver.getState);
  const failed = state.failures.find((failure) => failure.field === "macros");
  const saving: Saving = {
    shown: shownSettings(state).macros,
    save: (macros) => saver.change({ field: "macros", attempted: macros }),
    state: state.saving.includes("macros")
      ? "saving"
      : state.saved.includes("macros")
        ? "saved"
        : undefined,
    failure:
      failed?.field === "macros"
        ? macrosSaveErrorText(failed.attempted, state.stored.macros)
        : undefined,
    retry: () => saver.retry("macros"),
  };

  return (
    <SettingsCard id="macros" title="Math macros">
      <Header state={saving.state}>
        Short names for LaTeX you write often. Every deck's Formulas can use them, and a deck can
        add its own in its Deck settings.
      </Header>
      <MacroList saving={saving} empty={<SettingsEmpty />} />
    </SettingsCard>
  );
}

function SettingsEmpty() {
  return (
    <>
      With <code className="font-mono text-foreground">\norm</code> as{" "}
      <code className="font-mono text-foreground">{"\\left\\| #1 \\right\\|"}</code>, a Formula's{" "}
      <code className="font-mono text-foreground">{"\\norm{x}"}</code> reads ‖x‖.
    </>
  );
}

/** Deck settings' Math macros card: the Deck's own, then Settings' under them. */
export function DeckMacrosCard({ deck }: { deck: Deck }) {
  const queryClient = useQueryClient();
  const settings = useSuspenseQuery(settingsQueryOptions()).data.settings.macros;
  const saver = deckMacrosSaverFor(queryClient, deck.id);
  const state = useSyncExternalStore(saver.subscribe, saver.getState);
  const saving: Saving = {
    shown: state.queue.at(-1) ?? deck.macros,
    save: (macros) => saver.change(macros),
    state: state.queue.length > 0 ? "saving" : state.saved ? "saved" : undefined,
    failure:
      state.failed === undefined
        ? undefined
        : macrosSaveErrorText(state.failed.attempted, deck.macros),
    retry: () => saver.retry(),
  };

  return (
    <SettingsCard id="macros" title="Math macros">
      <Header state={saving.state}>
        This deck's own, on top of Settings'. One with the same name as Settings' wins in this deck.
      </Header>
      <MacroList
        saving={saving}
        settings={settings}
        empty="This deck uses Settings' as they are."
      />
    </SettingsCard>
  );
}

/** Settings' Macros as a Deck has them, each with Override, which adds the Deck's own copy, open. */
function FromSettings({
  settings,
  own,
  onOverride,
}: {
  settings: readonly Macro[];
  own: readonly Macro[];
  onOverride: (macro: Macro) => void;
}) {
  return (
    <div className="flex flex-col gap-2 border-t pt-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium">From Settings</h3>
        <Link
          to="/settings"
          hash="macros"
          className="inline-flex min-h-11 items-center text-sm text-muted-foreground underline underline-offset-4 lg:min-h-0"
        >
          Change in Settings
        </Link>
      </div>
      {settings.length === 0 ? (
        <p className="text-sm text-muted-foreground">Settings have no macros yet.</p>
      ) : (
        <ul className="flex flex-col divide-y">
          {settings.map((macro) => (
            <InheritedItem
              key={macro.name}
              macro={macro}
              settings={settings}
              overridden={own.some((mine) => mine.name === macro.name)}
              onOverride={() => onOverride(macro)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function Header({ state, children }: { state: Saving["state"]; children: ReactNode }) {
  return (
    <div className="-mt-3 flex items-start justify-between gap-3">
      <p className="text-sm text-muted-foreground">{children}</p>
      <span className="shrink-0 pt-0.5">
        <SaveState state={state} />
      </span>
    </div>
  );
}

/**
 * One list's rows, Settings' or a Deck's own, as they are written. The rows
 * hold what isn't saved yet too (a new row, a row with a problem); each
 * change saves the rows that are written and have no problem, with a row
 * with a problem kept as it was last saved (`toSave`), when that changes the
 * list. When the list saved changes otherwise (a failed save puts it back,
 * Try again, another device), the rows follow it, an open one staying open
 * (`reconcile`).
 */
function MacroList({
  saving,
  settings,
  empty,
}: {
  saving: Saving;
  /**
   * On a Deck, Settings' Macros: its own rows are typeset on top of them,
   * and they follow its rows, each with Override.
   */
  settings?: readonly Macro[];
  /** What the list says while it has no rows. */
  empty: ReactNode;
}) {
  const under = settings ?? NO_MACROS;
  const [rows, setRows] = useState<MacroRow[]>(() => rowsFor(saving.shown));
  // The rows that open as they appear: one just added.
  const [opening, setOpening] = useState<string>();
  const [seen, setSeen] = useState(saving.shown);
  if (!sameMacros(seen, saving.shown)) {
    setSeen(saving.shown);
    if (!sameMacros(saving.shown, keptOf(rows))) setRows(reconcile(rows, saving.shown));
  }

  const change = (edited: MacroRow[]) => {
    const { rows: next, list } = toSave(edited, under);
    setRows(next);
    if (!sameMacros(list, saving.shown)) saving.save(list);
  };
  const add = (macro: Macro) => {
    const row = { ...macro, id: newRowId() };
    setOpening(row.id);
    change([...rows, row]);
  };

  const checks = useMemo(
    () => new Map(rows.map((row) => [row.id, checkRow(row, rows, under)])),
    [rows, under],
  );

  return (
    <div className="flex flex-col gap-3">
      {rows.length === 0 ? (
        <p className="text-[0.95rem] text-muted-foreground">No macros yet. {empty}</p>
      ) : (
        <ul className="flex flex-col divide-y">
          {rows.map((row) => (
            <Item
              key={row.id}
              row={row}
              check={checks.get(row.id) ?? checkRow(row, rows, under)}
              startOpen={row.id === opening}
              onChange={(edit) =>
                change(rows.map((other) => (other.id === row.id ? { ...other, ...edit } : other)))
              }
              onDelete={() => change(rows.filter((other) => other.id !== row.id))}
            />
          ))}
        </ul>
      )}
      {saving.failure !== undefined && (
        <RetentionError message={saving.failure} onRetry={saving.retry} />
      )}
      <Button
        variant="outline"
        size="lg"
        className={cn(OUTLINE_PILL, "self-start")}
        onClick={() => add({ name: "\\", definition: "" })}
      >
        <Plus aria-hidden />
        Add a macro
      </Button>
      {settings !== undefined && (
        <FromSettings settings={settings} own={saving.shown} onOverride={add} />
      )}
    </div>
  );
}

/** A Macro's render in a fixed tile, so the names line up beside it. */
function Tile({ html, muted = false }: { html: string | undefined; muted?: boolean }) {
  return (
    <span
      className={cn(
        "flex h-11 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-background px-1.5 text-[0.95rem] dark:bg-input/20",
        muted && "opacity-60",
      )}
    >
      {html === undefined ? (
        <span aria-hidden className="text-muted-foreground">
          ?
        </span>
      ) : (
        <span
          aria-hidden
          className="inline-block max-w-full overflow-x-auto overflow-y-hidden"
          // oxlint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </span>
  );
}

/**
 * Keeps a row open while focus is inside it, and closes it when focus leaves
 * (a click or tap elsewhere, or Tab past its last field) or on Escape.
 */
function useFocusClose(close: () => void, onEscape: () => void) {
  return {
    onBlur(event: FocusEvent<HTMLElement>) {
      const next = event.relatedTarget;
      if (next instanceof Node && event.currentTarget.contains(next)) return;
      close();
    },
    onKeyDown(event: KeyboardEvent<HTMLElement>) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
      onEscape();
    },
  };
}

function Item({
  row,
  check,
  startOpen,
  onChange,
  onDelete,
}: {
  row: MacroRow;
  check: Checked;
  startOpen: boolean;
  onChange: (edit: Partial<Macro>) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(startOpen);
  const id = useId();
  const editButton = useRef<HTMLButtonElement>(null);
  const blank = row.name === "\\" && row.definition.trim() === "";
  const close = () => {
    // A new row left with nothing in it goes away rather than sit there empty.
    if (blank) onDelete();
    else setOpen(false);
  };
  // Escape puts focus back on the row's Edit, so the keyboard doesn't lose its place.
  const focusClose = useFocusClose(close, () =>
    globalThis.setTimeout(() => editButton.current?.focus({ preventScroll: true }), 0),
  );
  const problem = check.nameError ?? check.definitionError;
  const unfinished = problem === undefined && check.incomplete;
  const named = row.name === "\\" ? "this macro" : row.name;

  if (!open) {
    return (
      <li className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
        <div className="flex items-center gap-3">
          <Tile html={check.html} />
          <div className="min-w-0 flex-1">
            <p className={cn(MONO, "truncate font-medium")}>{row.name}</p>
            <p className={cn(MONO, "truncate text-sm text-muted-foreground")}>{row.definition}</p>
          </div>
          <Button
            ref={editButton}
            variant="outline"
            size="lg"
            className={OUTLINE_PILL}
            aria-label={`Edit ${named}`}
            aria-describedby={problem === undefined && !unfinished ? undefined : `${id}-problem`}
            onClick={() => setOpen(true)}
          >
            Edit
          </Button>
        </div>
        {unfinished ? (
          <Problem id={`${id}-problem`}>
            Not saved: it needs {row.name === "\\" || row.name === "" ? "a name" : "a definition"}.
            Edit to finish it.
          </Problem>
        ) : problem !== undefined ? (
          <Problem id={`${id}-problem`}>
            Not saved:{" "}
            {(check.nameError ?? `KaTeX says “${check.definitionError}”`).replace(/\.$/u, "")}. Edit
            to fix it.
          </Problem>
        ) : (
          check.replaces !== undefined && (
            <Note>
              Replaces KaTeX's <code className="font-mono text-foreground">{check.replaces}</code>.
            </Note>
          )
        )}
      </li>
    );
  }

  // Open, the row itself turns into its form, easing in: the name and
  // definition become fields where they were read, and the tile beside them
  // renders as you type. Delete sits beside the name, but Tab goes from the
  // name to the definition first.
  return (
    <li
      className="-mx-3 grid animate-in scroll-mt-24 grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 gap-y-2.5 rounded-xl bg-muted/70 px-3 py-3 outline-none duration-200 ease-out fade-in-0 slide-in-from-top-1 motion-reduce:animate-none [&+li]:border-t-transparent"
      tabIndex={-1}
      {...focusClose}
    >
      <Tile html={check.html} />
      <Input
        id={`${id}-name`}
        aria-label="Name"
        value={row.name}
        // A new row starts at its name, one being edited at its definition.
        autoFocus={row.name === "\\" || !startOpen}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        aria-invalid={check.nameError === undefined ? undefined : true}
        aria-describedby={`${id}-note`}
        onChange={(event) => onChange({ name: event.target.value })}
        className={cn(MONO, "min-w-0 bg-background font-medium lg:h-11")}
      />
      <Input
        id={`${id}-definition`}
        aria-label={`What ${row.name === "\\" ? "it" : row.name} stands for`}
        value={row.definition}
        autoFocus={startOpen && row.name !== "\\"}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        placeholder="\left\| #1 \right\|"
        aria-invalid={check.definitionError === undefined ? undefined : true}
        aria-describedby={`${id}-note`}
        onChange={(event) => onChange({ definition: event.target.value })}
        className={cn(MONO, "col-span-3 row-start-2 bg-background lg:h-11")}
      />
      <Button
        variant="ghost"
        size="icon-lg"
        className="col-start-3 row-start-1 text-muted-foreground hover:text-destructive"
        aria-label={`Delete ${named}`}
        onClick={onDelete}
      >
        <Trash2 aria-hidden />
      </Button>
      <div id={`${id}-note`} className="col-span-3 flex flex-col gap-1.5" aria-live="polite">
        {check.nameError !== undefined && <Problem>{check.nameError}</Problem>}
        {check.definitionError !== undefined && (
          <Problem>KaTeX says “{check.definitionError}”.</Problem>
        )}
        {problem === undefined && (
          <p className="text-sm text-muted-foreground">
            {check.incomplete ? (
              "#1 to #9 are its arguments. It's saved once it has a name and a definition."
            ) : (
              <>
                {check.arity === 0
                  ? "Takes no arguments: "
                  : `Takes ${check.arity === 1 ? "one argument" : `${check.arity} arguments`}: `}
                <code className="font-mono text-foreground">{check.sample}</code>
              </>
            )}
          </p>
        )}
        {check.replaces !== undefined && (
          <Note>
            Replaces KaTeX's <code className="font-mono text-foreground">{check.replaces}</code> in
            your Formulas.
          </Note>
        )}
        {problem !== undefined && (
          <p className="text-sm text-muted-foreground">Not saved until it's fixed.</p>
        )}
      </div>
    </li>
  );
}

/** One of Settings' Macros, on a Deck: rendered as Settings have it, or overridden by the Deck's own. */
function InheritedItem({
  macro,
  settings,
  overridden,
  onOverride,
}: {
  macro: Macro;
  settings: readonly Macro[];
  overridden: boolean;
  onOverride: () => void;
}) {
  const result = typeset(sampleOf(macro.name, macroArity(macro.definition)), false, settings);
  return (
    <li className="flex items-center gap-3 py-2.5">
      <Tile html={"html" in result ? result.html : undefined} muted={overridden} />
      <div className="min-w-0 flex-1">
        <p className={cn(MONO, "truncate", overridden && "text-muted-foreground line-through")}>
          {macro.name}
        </p>
        {overridden ? (
          <p className="truncate text-sm font-medium text-primary">Overridden by this deck's</p>
        ) : (
          <p className={cn(MONO, "truncate text-sm text-muted-foreground")}>{macro.definition}</p>
        )}
      </div>
      {!overridden && (
        <Button
          variant="ghost"
          size="lg"
          className="text-muted-foreground"
          aria-label={`Override ${macro.name} in this deck`}
          onClick={onOverride}
        >
          Override
        </Button>
      )}
    </li>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
      <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function Problem({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className="flex items-start gap-1.5 text-sm font-medium text-destructive">
      <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
    </p>
  );
}
