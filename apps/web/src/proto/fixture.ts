// Prototype only (BAN-28 Variants): the figures the before- and after-session
// screens show, by `?state=`, before the overview endpoint exists.

/** The page's `?state=`, or undefined on a plain load. */
export function protoState(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return new URLSearchParams(window.location.search).get("state") ?? undefined;
}

export type Overview = {
  due: number;
  new: number;
  newTotal: number;
  estimateMs: number;
  nextDue: { label: string; count: number } | null;
};

/** The deck page's overview: `nothing` has nothing to study, else 12 due and 20 new. */
export function overviewFixture(): Overview {
  return protoState() === "nothing"
    ? { due: 0, new: 0, newTotal: 0, estimateMs: 0, nextDue: { label: "tomorrow", count: 14 } }
    : { due: 12, new: 20, newTotal: 57, estimateMs: 9 * 60_000, nextDue: { label: "tomorrow", count: 14 } };
}

/** "~9 min", or "<1 min" under a minute. */
export function estimateLabel(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  return minutes < 1 ? "<1 min" : `~${minutes} min`;
}

export type Summary = {
  studied: number;
  newStudied: number;
  /** Review-kind Cards whose first standing Rating wasn't Again, of all review-kind Cards; null with none. */
  recall: { kept: number; of: number } | null;
  timeMs: number;
  /** Queue ran out: the next due day; null when nothing is scheduled. */
  next: { label: string; count: number } | null;
  /** Left early: how many are still to study. */
  stillToStudy: number | undefined;
  /** BAN-25's offer: New cards held back, and the batch. */
  newHeld: number;
  batch: number;
};

/** The summary a `summary…` state shows, or undefined for the real Session. */
export function summaryFixture(): Summary | undefined {
  const base: Summary = {
    studied: 37,
    newStudied: 12,
    recall: { kept: 22, of: 25 },
    timeMs: 14 * 60_000 + 20_000,
    next: { label: "tomorrow", count: 14 },
    stillToStudy: undefined,
    newHeld: 0,
    batch: 20,
  };
  switch (protoState()) {
    case "summary":
      return base;
    case "summary-more":
      return { ...base, newHeld: 37 };
    case "summary-early":
      return {
        ...base,
        studied: 9,
        newStudied: 3,
        recall: { kept: 5, of: 6 },
        timeMs: 3 * 60_000 + 40_000,
        next: null,
        stillToStudy: 20,
      };
    case "summary-new":
      return { ...base, studied: 20, newStudied: 20, recall: null, timeMs: 17 * 60_000 };
    default:
      return undefined;
  }
}

export function recallPercent(recall: { kept: number; of: number }): number {
  return Math.round((recall.kept / recall.of) * 100);
}

/** "14 min", or "45 s" under a minute. */
export function timeLabel(ms: number): string {
  return ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`;
}

export function cardsLabel(n: number): string {
  return n === 1 ? "1 card" : `${n} cards`;
}
