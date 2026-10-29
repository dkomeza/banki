import { CircleAlert, Info, Plus, Trash2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { OUTLINE_PILL, SaveState, SettingsCard } from "@/components/settings/parts";
import { MacroMath } from "@/components/settings/proto-macro-math";
import { RetentionError } from "@/components/settings/retention-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type Checked,
  type MacroRow,
  type Scope,
  addMacro,
  changeMacro,
  deleteMacro,
  retryMacros,
  settle,
  useInherited,
  useMacroList,
} from "@/lib/proto-macros";
import { cn } from "@/lib/utils";

// PROTOTYPE (BAN-22), Variant a: Ledger. Every Macro is a row of two fields,
// always open for writing, with its render under them. On a Deck, its own
// rows and Settings' sit side by side, so what it inherits and what it
// overrides read at a glance.

const MONO = "font-mono text-[0.95rem] md:text-[0.9rem]";

/** Settings' Math macros card, in the masonry. */
export function MacrosCard() {
  const list = useMacroList("global");
  return (
    <SettingsCard id="macros" title="Math macros">
      <div className="-mt-3 flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Short names for LaTeX you write often. Every deck's Formulas can use them.
        </p>
        <SaveState state={list.saveState} />
      </div>
      <MacroRows scope="global" />
    </SettingsCard>
  );
}

/** Deck settings' Math macros section: its own, and Settings' beside them. */
export function DeckMacrosSection({ deck }: { deck: string }) {
  const list = useMacroList({ deck });
  const inherited = useInherited(deck);
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
      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-10">
        <div className="flex flex-col gap-3">
          <div>
            <h3 className="font-semibold">This deck's</h3>
            <p className="text-sm text-muted-foreground">
              Only this deck's Formulas use them. One with a name Settings use wins here.
            </p>
          </div>
          <MacroRows scope={{ deck }} />
        </div>
        <div className="flex flex-col gap-3 lg:border-l lg:pl-10">
          <div>
            <h3 className="font-semibold">From Settings</h3>
            <p className="text-sm text-muted-foreground">
              Every deck has these.{" "}
              <Link
                to="/settings"
                hash="macros"
                className="text-foreground underline underline-offset-4"
              >
                Change them in Settings
              </Link>
              .
            </p>
          </div>
          {inherited.length === 0 ? (
            <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
              Settings have no macros yet.
            </p>
          ) : (
            <ul className="flex flex-col divide-y rounded-xl border bg-background">
              {inherited.map((macro) => (
                <li
                  key={macro.name}
                  className={cn(
                    "flex min-h-14 items-center gap-3 px-3.5 py-2.5",
                    macro.overridden && "bg-muted/50",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        MONO,
                        "font-medium",
                        macro.overridden && "line-through decoration-muted-foreground/70",
                      )}
                    >
                      {macro.name}
                    </p>
                    <p className={cn(MONO, "truncate text-sm text-muted-foreground")}>
                      {macro.definition}
                    </p>
                  </div>
                  {macro.overridden ? (
                    <span className="shrink-0 rounded-full border border-primary/40 px-2.5 py-0.5 text-xs font-medium text-primary">
                      Overridden here
                    </span>
                  ) : (
                    <MacroMath html={macro.html} className="shrink-0 text-[1.05rem]" />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {list.failure !== undefined && (
        <RetentionError message={list.failure} onRetry={() => retryMacros({ deck })} />
      )}
    </section>
  );
}

/** One list's rows, written in place, with Add a macro under them. */
function MacroRows({ scope }: { scope: Scope }) {
  const list = useMacroList(scope);
  return (
    <div className="flex flex-col gap-3">
      {list.rows.length === 0 ? (
        <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          <p>
            No macros yet. Give LaTeX you write often a short name: with{" "}
            <code className="font-mono text-foreground">\norm</code> as{" "}
            <code className="font-mono text-foreground">{"\\left\\| #1 \\right\\|"}</code>,{" "}
            <code className="font-mono text-foreground">{"\\norm{x}"}</code> reads ‖x‖.
          </p>
        </div>
      ) : (
        <ul className="@container flex flex-col gap-2.5">
          {list.rows.map((row) => (
            <LedgerRow
              key={row.id}
              scope={scope}
              row={row}
              check={row.check}
              fresh={list.fresh.includes(row.id)}
            />
          ))}
        </ul>
      )}
      {scope === "global" && list.failure !== undefined && (
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

function LedgerRow({
  scope,
  row,
  check,
  fresh,
}: {
  scope: Scope;
  row: MacroRow;
  check: Checked;
  fresh: boolean;
}) {
  const nameNote = `${row.id}-name-note`;
  const definitionNote = `${row.id}-definition-note`;
  return (
    <li
      className={cn(
        "flex flex-col gap-2 rounded-xl border bg-background p-2.5 dark:bg-input/10",
        fresh && "border-primary/50 ring-3 ring-primary/10",
        !check.saved && !check.incomplete && "border-destructive/50",
      )}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 @md:grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)_auto]">
        <Input
          aria-label="Name"
          value={row.name}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          // oxlint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={fresh && row.name === "\\"}
          aria-invalid={check.nameError === undefined ? undefined : true}
          aria-describedby={check.nameError === undefined ? undefined : nameNote}
          onChange={(event) => changeMacro(scope, row.id, { name: event.target.value })}
          onBlur={() => settle(row.id)}
          className={cn(MONO, "max-w-48 lg:h-9 @md:max-w-none")}
        />
        <Input
          aria-label={`What ${row.name} stands for`}
          value={row.definition}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          placeholder="\left\| #1 \right\|"
          // oxlint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={fresh && row.name !== "\\"}
          aria-invalid={check.definitionError === undefined ? undefined : true}
          aria-describedby={check.definitionError === undefined ? undefined : definitionNote}
          onChange={(event) => changeMacro(scope, row.id, { definition: event.target.value })}
          onBlur={() => settle(row.id)}
          className={cn(
            MONO,
            "col-span-2 row-start-2 lg:h-9 @md:col-span-1 @md:col-start-2 @md:row-start-1",
          )}
        />
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Delete ${row.name}`}
          className="col-start-2 row-start-1 justify-self-end text-muted-foreground lg:size-9 @md:col-start-3"
          onClick={() => deleteMacro(scope, row.id)}
        >
          <Trash2 aria-hidden />
        </Button>
      </div>
      {(check.html !== undefined || check.incomplete) && (
        <div className="flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1 px-1 text-sm">
          {fresh && (
            <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
              New
            </span>
          )}
          {check.html !== undefined ? (
            <>
              <code className="font-mono text-[0.8rem] text-muted-foreground">{check.sample}</code>
              <span aria-hidden className="text-muted-foreground">
                →
              </span>
              <MacroMath html={check.html} className="text-[1.1rem]" />
            </>
          ) : check.incomplete ? (
            <span className="text-muted-foreground">
              Not saved until it has a name and a definition.
            </span>
          ) : null}
        </div>
      )}
      {check.nameError !== undefined && (
        <Problem id={nameNote}>{check.nameError} Not saved until it's fixed.</Problem>
      )}
      {check.definitionError !== undefined && (
        <Problem id={definitionNote}>
          KaTeX says “{check.definitionError}”. Not saved until it's fixed.
        </Problem>
      )}
      {check.replaces !== undefined && (
        <p className="flex items-start gap-1.5 px-1 text-sm text-muted-foreground">
          <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Replaces KaTeX's <code className="font-mono text-foreground">{check.replaces}</code> in
            your Formulas.
          </span>
        </p>
      )}
    </li>
  );
}

function Problem({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="flex items-start gap-1.5 px-1 text-sm font-medium text-destructive">
      <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
    </p>
  );
}
