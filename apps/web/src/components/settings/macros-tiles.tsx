import { Link } from "@tanstack/react-router";
import { CircleAlert, Info, Plus, Trash2, X } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { OUTLINE_PILL, SaveState, SettingsCard } from "@/components/settings/parts";
import { MacroMath } from "@/components/settings/proto-macro-math";
import { RetentionError } from "@/components/settings/retention-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type Checked,
  type InheritedRow,
  type ListView,
  type MacroRow,
  type Scope,
  addMacro,
  changeMacro,
  deleteMacro,
  overrideMacro,
  retryMacros,
  useInherited,
  useMacroList,
} from "@/lib/proto-macros";
import { cn } from "@/lib/utils";

// PROTOTYPE (BAN-22), Variant c: Tiles. Macros are index cards, like the
// cheatsheet's: the render first and large, the name under it. Picking one
// opens its editor in a panel under the grid; a dashed tile adds one. On a
// Deck, one grid holds everything its Formulas can use, its own tiles solid
// and Settings' dashed, and its own that replace Settings' say so.

const MONO = "font-mono text-[0.95rem] md:text-[0.9rem]";

/** Where the selection is: one of the list's rows, or one of Settings' on a Deck. */
type Picked = { row: string } | { inherited: string } | undefined;

function firstPicked(list: ListView): Picked {
  const row =
    list.rows.find((r) => list.fresh.includes(r.id)) ??
    list.rows.find((r) => !r.check.saved && !r.check.incomplete);
  return row === undefined ? undefined : { row: row.id };
}

/** Settings' Math macros card, in the masonry. */
export function MacrosCard() {
  const list = useMacroList("global");
  const [picked, setPicked] = useState<Picked>(() => firstPicked(list));
  return (
    <SettingsCard id="macros" title="Math macros">
      <div className="-mt-3 flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Short names for LaTeX you write often. Every deck's Formulas can use them.
        </p>
        <span className="shrink-0 pt-0.5">
          <SaveState state={list.saveState} />
        </span>
      </div>
      {list.failure !== undefined && (
        <RetentionError message={list.failure} onRetry={() => retryMacros("global")} />
      )}
      <Grid>
        {list.rows.map((row) => (
          <OwnTile
            key={row.id}
            row={row}
            check={row.check}
            picked={picked !== undefined && "row" in picked && picked.row === row.id}
            onPick={() => setPicked({ row: row.id })}
          />
        ))}
        <NewTile onAdd={() => setPicked({ row: addMacro("global") })} />
      </Grid>
      {list.rows.length === 0 && <EmptyNote />}
      <Panel scope="global" list={list} picked={picked} onClose={() => setPicked(undefined)} />
    </SettingsCard>
  );
}

/** Deck settings' Math macros section: one grid of everything the Deck's Formulas can use. */
export function DeckMacrosSection({ deck }: { deck: string }) {
  const scope = { deck };
  const list = useMacroList(scope);
  const inherited = useInherited(deck);
  const [picked, setPicked] = useState<Picked>(() => firstPicked(list));
  const own = new Map(list.rows.map((r) => [r.name, r]));
  const fromSettings = inherited.filter((m) => !m.overridden);
  // One grid, by name: the Deck's own and Settings' it doesn't replace.
  const tiles = [
    ...list.rows.map((r) => ({ key: r.id, name: r.name, own: r, inherited: undefined })),
    ...fromSettings.map((m) => ({
      key: `s:${m.name}`,
      name: m.name,
      own: undefined,
      inherited: m,
    })),
  ].toSorted((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  const replaced = new Map(inherited.filter((m) => m.overridden).map((m) => [m.name, m]));

  return (
    <section
      id="macros"
      aria-labelledby="macros-title"
      className="flex scroll-mt-28 flex-col gap-5 rounded-[1.5rem] border bg-card p-5 text-card-foreground sm:p-7 lg:p-8"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="macros-title" className="text-xl font-semibold tracking-tight lg:text-2xl">
          Math macros
        </h2>
        <SaveState state={list.saveState} />
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            className="size-3.5 rounded-[4px] border border-foreground/40 bg-background"
          />
          This deck's own ({list.rows.length})
        </span>
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            className="size-3.5 rounded-[4px] border border-dashed border-foreground/40"
          />
          From{" "}
          <Link
            to="/settings"
            hash="macros"
            className="text-foreground underline underline-offset-4"
          >
            Settings
          </Link>{" "}
          ({fromSettings.length})
        </span>
      </div>
      {list.failure !== undefined && (
        <RetentionError message={list.failure} onRetry={() => retryMacros(scope)} />
      )}
      <Grid wide>
        {tiles.map((tile) =>
          tile.own !== undefined ? (
            <OwnTile
              key={tile.key}
              row={tile.own}
              check={tile.own.check}
              replaces={replaced.has(tile.name) && own.get(tile.name) === tile.own}
              picked={picked !== undefined && "row" in picked && picked.row === tile.own.id}
              onPick={() => setPicked({ row: tile.own.id })}
            />
          ) : (
            <SettingsTile
              key={tile.key}
              macro={tile.inherited}
              picked={
                picked !== undefined && "inherited" in picked && picked.inherited === tile.name
              }
              onPick={() => setPicked({ inherited: tile.name })}
            />
          ),
        )}
        <NewTile onAdd={() => setPicked({ row: addMacro(scope) })} />
      </Grid>
      {tiles.length === 0 && <EmptyNote />}
      {picked !== undefined && "inherited" in picked ? (
        <InheritedPanel
          macro={inherited.find((m) => m.name === picked.inherited)}
          onOverride={(macro) => setPicked({ row: overrideMacro(deck, macro) })}
          onClose={() => setPicked(undefined)}
        />
      ) : (
        <Panel
          scope={scope}
          list={list}
          picked={picked}
          replaced={replaced}
          onClose={() => setPicked(undefined)}
        />
      )}
    </section>
  );
}

function Grid({ wide = false, children }: { wide?: boolean; children: ReactNode }) {
  return (
    <ul
      className={cn(
        "grid grid-cols-2 gap-2.5 sm:grid-cols-3",
        wide && "md:grid-cols-4 lg:grid-cols-5",
      )}
    >
      {children}
    </ul>
  );
}

const TILE =
  "relative flex h-full w-full flex-col items-center gap-1 rounded-xl border px-2 pt-3 pb-2.5 text-center transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

function TileBody({
  html,
  name,
  definition,
  muted = false,
}: {
  html: string | undefined;
  name: string;
  definition: string;
  muted?: boolean;
}) {
  return (
    <>
      <span
        className={cn(
          "flex h-11 max-w-full items-center justify-center text-[1.15rem]",
          muted && "opacity-75",
        )}
      >
        {html === undefined ? (
          <span aria-hidden className="font-mono text-muted-foreground">
            ?
          </span>
        ) : (
          <MacroMath html={html} />
        )}
      </span>
      <span className={cn(MONO, "max-w-full truncate font-medium")}>
        {name === "\\" ? <span className="text-muted-foreground">New</span> : name}
      </span>
      <span className="max-w-full truncate font-mono text-xs text-muted-foreground">
        {definition === "" ? "…" : definition}
      </span>
    </>
  );
}

function Flag({ tone, children }: { tone: "accent" | "error" | "muted"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "absolute -top-2 left-1/2 max-w-[90%] -translate-x-1/2 truncate rounded-full border px-2 py-px text-[0.7rem] font-medium whitespace-nowrap",
        tone === "accent" && "border-primary/40 bg-card text-primary",
        tone === "error" && "border-destructive/40 bg-card text-destructive",
        tone === "muted" && "bg-card text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

function OwnTile({
  row,
  check,
  replaces = false,
  picked,
  onPick,
}: {
  row: MacroRow;
  check: Checked;
  replaces?: boolean;
  picked: boolean;
  onPick: () => void;
}) {
  const broken = !check.saved && !check.incomplete;
  return (
    <li>
      <button
        type="button"
        aria-pressed={picked}
        aria-label={`${row.name === "\\" ? "New macro" : row.name}${broken ? ", not saved: it has a problem" : ""}`}
        onClick={onPick}
        className={cn(
          TILE,
          "bg-background hover:bg-muted/60 dark:bg-input/20",
          broken && "border-destructive/60",
          picked && "border-primary ring-3 ring-primary/15",
        )}
      >
        {broken ? (
          <Flag tone="error">Not saved</Flag>
        ) : replaces ? (
          <Flag tone="accent">Replaces Settings'</Flag>
        ) : check.replaces !== undefined ? (
          <Flag tone="muted">Replaces KaTeX's</Flag>
        ) : null}
        <TileBody html={check.html} name={row.name} definition={row.definition} />
      </button>
    </li>
  );
}

function SettingsTile({
  macro,
  picked,
  onPick,
}: {
  macro: InheritedRow;
  picked: boolean;
  onPick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-pressed={picked}
        aria-label={`${macro.name}, from Settings`}
        onClick={onPick}
        className={cn(
          TILE,
          "border-dashed border-foreground/25 bg-transparent hover:bg-muted/40",
          picked && "border-solid border-primary ring-3 ring-primary/15",
        )}
      >
        <TileBody html={macro.html} name={macro.name} definition={macro.definition} muted />
      </button>
    </li>
  );
}

function NewTile({ onAdd }: { onAdd: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onAdd}
        className={cn(
          TILE,
          "min-h-28 justify-center border-dashed border-primary/40 text-primary hover:bg-accent/60",
        )}
      >
        <Plus aria-hidden className="size-5" />
        <span className="text-sm font-medium">Add a macro</span>
      </button>
    </li>
  );
}

function EmptyNote() {
  return (
    <p className="text-sm text-muted-foreground">
      No macros yet. With <code className="font-mono text-foreground">\norm</code> as{" "}
      <code className="font-mono text-foreground">{"\\left\\| #1 \\right\\|"}</code>, a Formula's{" "}
      <code className="font-mono text-foreground">{"\\norm{x}"}</code> reads ‖x‖.
    </p>
  );
}

/** The picked tile's editor, under the grid. Every change saves as it's made. */
function Panel({
  scope,
  list,
  picked,
  replaced,
  onClose,
}: {
  scope: Scope;
  list: ListView;
  picked: Picked;
  replaced?: ReadonlyMap<string, InheritedRow>;
  onClose: () => void;
}) {
  const id = useId();
  if (picked === undefined || !("row" in picked)) return null;
  const row = list.rows.find((r) => r.id === picked.row);
  if (row === undefined) return null;
  const { check } = row;
  const over = replaced?.get(row.name);
  return (
    <div
      role="group"
      aria-label={`Editing ${row.name === "\\" ? "a new macro" : row.name}`}
      className="flex flex-col gap-4 rounded-2xl bg-muted/70 p-4 sm:p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">{row.name === "\\" ? "New macro" : `Editing ${row.name}`}</h3>
        <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose} className="-mr-2">
          <X aria-hidden />
        </Button>
      </div>
      <div className="flex min-h-24 flex-col items-center justify-center gap-1 rounded-xl border bg-background px-3 py-4 dark:bg-input/20">
        {check.html !== undefined ? (
          <>
            <MacroMath html={check.html} className="text-[1.6rem]" />
            <code className="font-mono text-xs text-muted-foreground">{check.sample}</code>
          </>
        ) : (
          <span className="text-sm text-muted-foreground">
            {check.incomplete ? "Its render shows here as you write it." : "Can't show it yet."}
          </span>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-name`} className="text-sm font-medium">
            Name
          </label>
          <Input
            id={`${id}-name`}
            value={row.name}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            aria-invalid={check.nameError === undefined ? undefined : true}
            onChange={(event) => changeMacro(scope, row.id, { name: event.target.value })}
            className={cn(MONO, "bg-background lg:h-10")}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-definition`} className="text-sm font-medium">
            Stands for{" "}
            <span className="font-normal text-muted-foreground">(#1 to #9 for arguments)</span>
          </label>
          <Input
            id={`${id}-definition`}
            value={row.definition}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            placeholder="\left\| #1 \right\|"
            aria-invalid={check.definitionError === undefined ? undefined : true}
            onChange={(event) => changeMacro(scope, row.id, { definition: event.target.value })}
            className={cn(MONO, "bg-background lg:h-10")}
          />
        </div>
      </div>
      {check.nameError !== undefined && <Problem>{check.nameError}</Problem>}
      {check.definitionError !== undefined && (
        <Problem>KaTeX says “{check.definitionError}”.</Problem>
      )}
      {!check.saved && !check.incomplete && (
        <p className="text-sm font-medium text-destructive">Not saved until it's fixed.</p>
      )}
      {check.incomplete && (
        <p className="text-sm text-muted-foreground">Saved once it has a name and a definition.</p>
      )}
      {check.replaces !== undefined && (
        <Note>
          Replaces KaTeX's <code className="font-mono text-foreground">{check.replaces}</code> in
          your Formulas.
        </Note>
      )}
      {over !== undefined && (
        <Note>
          Replaces Settings' <code className="font-mono text-foreground">{over.name}</code> (
          <code className="font-mono">{over.definition}</code>) in this deck.
        </Note>
      )}
      <div>
        <Button
          variant="ghost"
          size="lg"
          className="-ml-2 text-destructive hover:text-destructive"
          onClick={() => {
            deleteMacro(scope, row.id);
            onClose();
          }}
        >
          <Trash2 aria-hidden />
          Delete
        </Button>
      </div>
    </div>
  );
}

function InheritedPanel({
  macro,
  onOverride,
  onClose,
}: {
  macro: InheritedRow | undefined;
  onOverride: (macro: InheritedRow) => void;
  onClose: () => void;
}) {
  if (macro === undefined) return null;
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-dashed p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">
          <span className="font-mono">{macro.name}</span>, from Settings
        </h3>
        <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose} className="-mr-2">
          <X aria-hidden />
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Every deck has it as <code className="font-mono text-foreground">{macro.definition}</code>.
        Override it to give this deck its own, or change it for every deck in{" "}
        <Link to="/settings" hash="macros" className="text-foreground underline underline-offset-4">
          Settings
        </Link>
        .
      </p>
      <Button
        variant="outline"
        size="lg"
        className={cn(OUTLINE_PILL, "self-start")}
        onClick={() => onOverride(macro)}
      >
        Override in this deck
      </Button>
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
      <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
    </p>
  );
}

function Problem({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-1.5 text-sm font-medium text-destructive">
      <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
    </p>
  );
}
