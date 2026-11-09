import type { ImportReportResponse, ImportSource } from "@banki/shared";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { UNDO_MS } from "@/components/deleted/toasts";
import { importQueryOptions } from "@/lib/imports";

// Prototype only (BAN-33): the history and Undo the API doesn't serve yet,
// built around the seeded Import so the Variants show real names and times.
// The seed's own Import is the live entry; an older, undone one and a partly
// deleted one are made up beside it.

/** The seeded confirmed Import (SEED_IDS.import). */
export const SEED_IMPORT_ID = "5eed0000-0000-4000-8000-0000000001a1";

export type HistoryEntry = {
  id: string;
  fileName: string;
  source: ImportSource;
  confirmedAt: string;
  imported: number;
  live: number;
  undoneAt: string | null;
  /** The report it links to, and the `?state=` that shows it as it is. */
  report: { importId: string; state?: string };
};

const HOUR = 3_600_000;
const before = (iso: string, hours: number) =>
  new Date(new Date(iso).getTime() - hours * HOUR).toISOString();

/** The `?state=` of the current page, or undefined on the plain load. */
export function usePreviewState(): string | undefined {
  return useLocation({
    select: (l) => {
      const search: Record<string, unknown> = l.search;
      return typeof search["state"] === "string" ? search["state"] : undefined;
    },
  });
}

/** The Deck's Past imports, newest first; empty under `?state=empty-history`. */
export function useHistory(deckId: string): HistoryEntry[] | undefined {
  const state = usePreviewState();
  const seed = useQuery(importQueryOptions(SEED_IMPORT_ID)).data;
  if (state === "empty-history") return [];
  if (seed === undefined) return undefined;
  if (seed === null || seed.status !== "confirmed" || seed.deckId !== deckId) return [];
  const report = { importId: SEED_IMPORT_ID };
  return [
    {
      id: seed.id,
      fileName: seed.fileName,
      source: seed.source,
      confirmedAt: seed.confirmedAt,
      imported: seed.imported,
      live: seed.imported,
      undoneAt: null,
      report,
    },
    {
      id: "proto-undone",
      fileName: "verbos-irregulares.json",
      source: "json",
      confirmedAt: before(seed.confirmedAt, 50),
      imported: 24,
      live: 0,
      undoneAt: before(seed.confirmedAt, 47),
      report: { ...report, state: "undone" },
    },
    {
      id: "proto-partial",
      fileName: "pasted JSON",
      source: "paste",
      confirmedAt: before(seed.confirmedAt, 9 * 24),
      imported: 40,
      live: 37,
      undoneAt: null,
      report,
    },
  ];
}

/** What the report's Undo needs that the API doesn't serve yet. */
export type UndoFacts = {
  live: number;
  studied: number;
  edited: number;
  moved: number;
  undoneAt: string | null;
};

export function undoFacts(report: ImportReportResponse, undone: boolean): UndoFacts {
  return {
    live: report.imported,
    studied: 3,
    edited: 2,
    moved: 1,
    undoneAt: undone ? new Date(Date.now() - 2 * 60_000).toISOString() : null,
  };
}

export const cardCount = (n: number) =>
  `${n.toLocaleString("en-GB")} ${n === 1 ? "card" : "cards"}`;

/** "Undo this import? Its 24 cards go to Recently deleted for 30 days." and its extra lines. */
export function undoQuestion(f: UndoFacts): { question: string; lines: string[] } {
  const lines: string[] = [];
  if (f.studied > 0) {
    lines.push(
      `${f.studied} ${f.studied === 1 ? "has" : "have"} been studied; their reviews stay.`,
    );
  }
  if (f.edited > 0) lines.push(`${f.edited} ${f.edited === 1 ? "was" : "were"} edited since.`);
  if (f.moved > 0) {
    lines.push(`${f.moved} ${f.moved === 1 ? "was" : "were"} moved to another deck, and go too.`);
  }
  return {
    question: `Its ${cardCount(f.live)} go to Recently deleted for 30 days.`,
    lines,
  };
}

const dayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "today, 14:02", "yesterday, 09:10" or "Tuesday 20 October, 14:02". */
export function whenLabel(iso: string, now = new Date()): string {
  const at = new Date(iso);
  const time = at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const days = Math.round((dayOf(now) - dayOf(at)) / (24 * HOUR));
  if (days === 0) return `today, ${time}`;
  if (days === 1) return `yesterday, ${time}`;
  return `${at.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}, ${time}`;
}

export const sourceLabel = (source: ImportSource) =>
  source === "zip" ? "Zip" : source === "json" ? "JSON file" : "Pasted";

/** The entry's state line: "Undone …", "37 of 40 cards still here", or nothing. */
export function stateLabel(e: HistoryEntry): string | undefined {
  if (e.undoneAt !== null) return `Undone ${whenLabel(e.undoneAt)}`;
  if (e.live < e.imported) return `${e.live} of ${cardCount(e.imported)} still here`;
  return undefined;
}

/**
 * The report's Undo, faked on the page: `?state=undo` opens the
 * confirmation, `?state=undone` shows the undone report with its toast, and
 * Undo itself, or the toast's Undo, flips it here and now.
 */
export function useUndo(report: ImportReportResponse) {
  const state = usePreviewState();
  const [undone, setUndone] = useState(state === "undone");
  const [asking, setAsking] = useState(state === "undo");
  const [busy, setBusy] = useState(false);
  // A new `?state=` starts the page over in it.
  const [shown, setShown] = useState(state);
  if (shown !== state) {
    setShown(state);
    setUndone(state === "undone");
    setAsking(state === "undo");
  }
  useEffect(() => {
    if (state !== "undone") return undefined;
    // After the shell's toaster has mounted.
    const timer = setTimeout(() => showUndoneToast(report, () => setUndone(false), Infinity), 300);
    return () => clearTimeout(timer);
  }, [state, report]);
  const facts = undoFacts(report, undone);
  const confirm = () => {
    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      setAsking(false);
      setUndone(true);
      showUndoneToast(report, () => setUndone(false), UNDO_MS);
    }, 500);
  };
  return { facts, undone, asking, setAsking, busy, confirm };
}

function showUndoneToast(report: ImportReportResponse, restore: () => void, duration: number) {
  toast("Import undone", {
    id: `undone-${report.id}`,
    description: `Its ${cardCount(report.imported)} wait in Recently deleted for 30 days.`,
    duration,
    action: {
      label: "Undo",
      onClick: () => {
        restore();
        toast(`${cardCount(report.imported)} restored`, {
          id: `restored-${report.id}`,
          description: `Back in their decks, as they were.`,
        });
      },
    },
  });
}
