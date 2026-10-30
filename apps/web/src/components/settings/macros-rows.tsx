import { Link } from "@tanstack/react-router";
import { CircleAlert, Info, Plus, Trash2 } from "lucide-react";
import {
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  useId,
  useRef,
  useState,
} from "react";
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

// PROTOTYPE (BAN-22), Variant d: In place (round 2, from b: Rows). A Macro
// reads like every other row on the Settings page: its render, its name and
// definition, and Edit beside them. Edit turns the row itself into its form:
// the name and definition become fields where they were read, the tile beside
// them renders as you type, and the row closes when focus leaves it (or on
// Escape). A row with a problem closes too, and says under it that it isn't
// saved. On a Deck, its own rows come first, and Settings' follow under them,
// each with Override, which gives the Deck its own copy to change.

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
  const [open, setOpen] = useState(startOpen);
  const id = useId();
  const editButton = useRef<HTMLButtonElement>(null);
  const blank = row.name === "\\" && row.definition.trim() === "";
  const close = () => {
    settle(row.id);
    // A new row left with nothing in it goes away rather than sit there empty.
    if (blank) {
      deleteMacro(scope, row.id);
      return;
    }
    setOpen(false);
  };
  // Escape puts focus back on the row's Edit, so the keyboard doesn't lose its place.
  const focusClose = useFocusClose(close, () =>
    window.setTimeout(() => editButton.current?.focus({ preventScroll: true }), 0),
  );
  const shown = open;
  const problem = check.nameError ?? check.definitionError;

  if (!shown) {
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
            aria-label={`Edit ${row.name}`}
            onClick={() => setOpen(true)}
          >
            Edit
          </Button>
        </div>
        {problem !== undefined ? (
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

  // Open, the row itself turns into its form: the name and definition become
  // fields where they were read, and the tile beside them renders as you type.
  return (
    <li
      className="-mx-3 flex scroll-mt-24 flex-col gap-2.5 rounded-xl bg-muted/70 px-3 py-3 outline-none [&+li]:border-t-transparent"
      tabIndex={-1}
      {...focusClose}
    >
      <div className="flex items-start gap-3">
        <Tile html={check.html} />
        <Input
          id={`${id}-name`}
          aria-label="Name"
          value={row.name}
          autoFocus={startOpen && row.name === "\\"}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          aria-invalid={check.nameError === undefined ? undefined : true}
          aria-describedby={`${id}-note`}
          onChange={(event) => changeMacro(scope, row.id, { name: event.target.value })}
          className={cn(MONO, "min-w-0 flex-1 bg-background font-medium lg:h-11")}
        />
        <Button
          variant="ghost"
          size="icon-lg"
          className="shrink-0 text-muted-foreground hover:text-destructive"
          aria-label={`Delete ${row.name === "\\" ? "this macro" : row.name}`}
          onClick={() => deleteMacro(scope, row.id)}
        >
          <Trash2 aria-hidden />
        </Button>
      </div>
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
        onChange={(event) => changeMacro(scope, row.id, { definition: event.target.value })}
        className={cn(MONO, "bg-background lg:h-11")}
      />
      <div id={`${id}-note`} className="flex flex-col gap-1.5">
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
