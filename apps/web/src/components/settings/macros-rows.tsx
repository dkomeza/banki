import { Link } from "@tanstack/react-router";
import { CircleAlert, Info, Plus, Trash2 } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { OUTLINE_PILL, SaveState, SettingsCard } from "@/components/settings/parts";
import { MacroMath } from "@/components/settings/proto-macro-math";
import { RetentionError } from "@/components/settings/retention-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type Checked,
  type InheritedRow,
  type MacroRow,
  type Scope,
  addMacro,
  changeMacro,
  deleteMacro,
  overrideMacro,
  retryMacros,
  settle,
  useInherited,
  useMacroList,
} from "@/lib/proto-macros";
import { cn } from "@/lib/utils";

// PROTOTYPE (BAN-22), Variant e: Live fields (round 2, from b: Rows). A Macro
// reads like every other row on the Settings page, its render in a tile
// beside its name and definition, but there's no Edit: the name and definition
// are fields that read as text until one is focused. Focus shows them as
// fields, with the hint under them, and leaving the row puts it back. Problems
// show under a row whether it's focused or not. On a Deck, its own rows come
// first, and Settings' follow under them, each with Override, which gives the
// Deck its own copy to change.

const MONO = "font-mono text-[0.95rem] md:text-[0.9rem]";

/** Settings' Math macros card, in the masonry. */
export function MacrosCard() {
  const list = useMacroList("global");
  return (
    <SettingsCard id="macros" title="Math macros">
      <Header saveState={list.saveState}>
        Short names for LaTeX you write often. Every deck's Formulas can use them, and a deck can
        add its own in its Deck settings.
      </Header>
      <MacroList scope="global" />
    </SettingsCard>
  );
}

/** Deck settings' Math macros card: its own, then Settings' under them. */
export function DeckMacrosCard({ deck }: { deck: string }) {
  const list = useMacroList({ deck });
  const inherited = useInherited(deck);
  const [opened, setOpened] = useState<string | undefined>();
  return (
    <SettingsCard id="macros" title="Math macros">
      <Header saveState={list.saveState}>
        This deck's own, on top of Settings'. One with the same name as Settings' wins in this deck.
      </Header>
      <MacroList scope={{ deck }} open={opened} />
      <div className="flex flex-col gap-2 border-t pt-4">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-medium">From Settings</h3>
          <Link
            to="/settings"
            hash="macros"
            className="text-sm text-muted-foreground underline underline-offset-4"
          >
            Change in Settings
          </Link>
        </div>
        {inherited.length === 0 ? (
          <p className="text-sm text-muted-foreground">Settings have no macros yet.</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {inherited.map((macro) => (
              <InheritedItem
                key={macro.name}
                macro={macro}
                onOverride={() => setOpened(overrideMacro(deck, macro))}
              />
            ))}
          </ul>
        )}
      </div>
    </SettingsCard>
  );
}

function Header({
  saveState,
  children,
}: {
  saveState: "saving" | "saved" | undefined;
  children: ReactNode;
}) {
  return (
    <div className="-mt-3 flex items-start justify-between gap-3">
      <p className="text-sm text-muted-foreground">{children}</p>
      <span className="shrink-0 pt-0.5">
        <SaveState state={saveState} />
      </span>
    </div>
  );
}

function MacroList({ scope, open }: { scope: Scope; open?: string | undefined }) {
  const list = useMacroList(scope);
  return (
    <div className="flex flex-col gap-3">
      {list.rows.length === 0 ? (
        <p className="text-[0.95rem] text-muted-foreground">
          No macros yet.{" "}
          {scope === "global" ? (
            <>
              With <code className="font-mono text-foreground">\norm</code> as{" "}
              <code className="font-mono text-foreground">{"\\left\\| #1 \\right\\|"}</code>, a
              Formula's <code className="font-mono text-foreground">{"\\norm{x}"}</code> reads ‖x‖.
            </>
          ) : (
            "This deck uses Settings' as they are."
          )}
        </p>
      ) : (
        <ul className="flex flex-col divide-y">
          {list.rows.map((row) => (
            <Item
              key={row.id}
              scope={scope}
              row={row}
              check={row.check}
              startOpen={list.fresh.includes(row.id) || row.id === open}
            />
          ))}
        </ul>
      )}
      {list.failure !== undefined && (
        <RetentionError message={list.failure} onRetry={() => retryMacros(scope)} />
      )}
      <Button
        variant="outline"
        size="lg"
        className={cn(OUTLINE_PILL, "self-start")}
        onClick={() => addMacro(scope)}
      >
        <Plus aria-hidden />
        Add a macro
      </Button>
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
        <MacroMath html={html} />
      )}
    </span>
  );
}

const QUIET_FIELD = cn(
  MONO,
  "-ml-2 h-11 border-transparent bg-transparent px-2 shadow-none hover:border-input lg:h-7 dark:bg-transparent",
  "group-focus-within/row:border-input group-focus-within/row:bg-background dark:group-focus-within/row:bg-input/30",
);

function Item({
  scope,
  row,
  check,
  startOpen,
}: {
  scope: Scope;
  row: MacroRow;
  check: Checked;
  startOpen: boolean;
}) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const problem = check.nameError ?? check.definitionError;
  const label = row.name === "\\" ? "this macro" : row.name;
  return (
    // The row is always its own form: its name and definition read as text
    // until one is focused, which shows them as fields and the hint under
    // them. Leaving the row (a click or tap elsewhere, Tab past it, Escape)
    // puts it back to reading.
    <li
      className="group/row flex flex-col gap-1.5 py-2 transition-colors focus-within:-mx-3 focus-within:rounded-xl focus-within:px-3 focus-within:border-t-transparent focus-within:bg-muted/70 [&:focus-within+li]:border-t-transparent"
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        setFocused(false);
        settle(row.id);
        // A new row left with nothing in it goes away rather than sit there empty.
        if (row.name === "\\" && row.definition.trim() === "") deleteMacro(scope, row.id);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      }}
    >
      <div className="flex items-center gap-3">
        <Tile html={check.html} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Input
            id={`${id}-name`}
            aria-label="Name"
            value={row.name}
            autoFocus={startOpen}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            aria-invalid={check.nameError === undefined ? undefined : true}
            aria-describedby={`${id}-note`}
            onChange={(event) => changeMacro(scope, row.id, { name: event.target.value })}
            className={cn(QUIET_FIELD, "font-medium")}
          />
          <Input
            id={`${id}-definition`}
            aria-label={`What ${row.name === "\\" ? "it" : row.name} stands for`}
            value={row.definition}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            placeholder="Stands for, such as \left\| #1 \right\|"
            aria-invalid={check.definitionError === undefined ? undefined : true}
            aria-describedby={`${id}-note`}
            onChange={(event) => changeMacro(scope, row.id, { definition: event.target.value })}
            className={cn(
              QUIET_FIELD,
              "text-sm text-muted-foreground group-focus-within/row:text-foreground md:text-sm",
            )}
          />
        </div>
        <Button
          variant="ghost"
          size="icon-lg"
          className="invisible shrink-0 text-muted-foreground group-focus-within/row:visible hover:text-destructive"
          aria-label={`Delete ${label}`}
          onClick={() => deleteMacro(scope, row.id)}
        >
          <Trash2 aria-hidden />
        </Button>
      </div>
      <div id={`${id}-note`} className="flex flex-col gap-1.5 empty:hidden">
        {check.nameError !== undefined && <Problem>{check.nameError}</Problem>}
        {check.definitionError !== undefined && (
          <Problem>KaTeX says “{check.definitionError}”.</Problem>
        )}
        {problem !== undefined && (
          <p className="text-sm text-muted-foreground">Not saved until it's fixed.</p>
        )}
        {focused && problem === undefined && (
          <p className="text-sm text-muted-foreground">
            {check.incomplete ? (
              "#1 to #9 are its arguments. It's saved once it has a name and a definition."
            ) : (
              <>
                {check.arity === 0
                  ? "Takes no arguments: "
                  : `Takes ${check.arity === 1 ? "one argument" : `${check.arity} arguments`}: `}
                <code className="font-mono text-foreground">{check.sample}</code>. Saved as you
                type.
              </>
            )}
          </p>
        )}
        {check.replaces !== undefined && (
          <Note>
            Replaces KaTeX's <code className="font-mono text-foreground">{check.replaces}</code>
            {focused ? " in your Formulas." : "."}
          </Note>
        )}
      </div>
    </li>
  );
}

function InheritedItem({ macro, onOverride }: { macro: InheritedRow; onOverride: () => void }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <Tile html={macro.html} muted={macro.overridden} />
      <div className="min-w-0 flex-1">
        <p
          className={cn(MONO, "truncate", macro.overridden && "text-muted-foreground line-through")}
        >
          {macro.name}
        </p>
        {macro.overridden ? (
          <p className="truncate text-sm font-medium text-primary">Overridden by this deck's</p>
        ) : (
          <p className={cn(MONO, "truncate text-sm text-muted-foreground")}>{macro.definition}</p>
        )}
      </div>
      {!macro.overridden && (
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
