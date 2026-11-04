import { DEFAULT_SESSION_TIMEOUT_MINUTES, QueueKind, Rating } from "@banki/shared";
import { z } from "zod";

// Where a study Session lives between visits (ADR-0027): the browser's
// localStorage, one entry per Deck, holding IDs, counts and timings only,
// never a Card's content. Storage the browser blocks, fills up or hands back
// unreadable is no storage: the Session studies as before, without resume.
// Every read and write here is guarded, so none of it ever throws.

/** The shown Card as stored: which, why, and how it stood. */
const StoredShown = z.object({
  cardId: z.string(),
  kind: QueueKind,
  revealed: z.boolean(),
  /** Back from an Undo, until it is rated. */
  undone: z.boolean(),
  /** The time it had been on screen when stored, editing left out. */
  elapsedMs: z.number().nonnegative(),
});

/** A Session as it is stored. */
const StoredSession = z.object({
  /** Which Session it is: a fresh one is another, though on the same Deck. */
  id: z.string(),
  /** Which write stored it, so a tab can tell whether another wrote since it last read or wrote. */
  writeId: z.string(),
  reviewsShown: z.number().int().nonnegative(),
  newShown: z.number().int().nonnegative(),
  batches: z.number().int().positive(),
  /** The Card shown last, which `study/next` takes as `after`. */
  after: z.string().nullable(),
  /** Every Card shown, with the kind it first came with. */
  seen: z.array(z.tuple([z.string(), QueueKind])),
  /** The kind each Card put back to New in the Session came with. */
  resetKinds: z.array(z.tuple([z.string(), QueueKind])),
  /** The Cards seen deleted. */
  gone: z.array(z.string()),
  /** The standing Ratings, oldest first, for Undo and the summary. */
  given: z.array(
    z.object({
      reviewId: z.string(),
      cardId: z.string(),
      kind: QueueKind,
      rating: Rating,
      durationMs: z.number().nonnegative(),
      settled: z.boolean(),
    }),
  ),
  /** The Card shown, or null when the Queue had run out. */
  shown: StoredShown.nullable(),
  /** When the Session was last active, ms since the epoch. */
  activeAt: z.number(),
});
export type StoredSession = z.infer<typeof StoredSession>;
export type StoredShown = z.infer<typeof StoredShown>;

/** The part of the browser's Storage the store uses. */
export type SessionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key"> & {
  readonly length: number;
};

const PREFIX = "banki.session.";

/** The browser's localStorage, or undefined where it is blocked (reading it can throw). */
export function browserStorage(): SessionStorage | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

/** One Deck's stored Session. */
export type SessionStore = {
  /** The stored Session, or undefined with none, or one that can't be read. */
  read: () => StoredSession | undefined;
  write: (session: StoredSession) => void;
  clear: () => void;
};

/** The stored Session of the Deck `deckId`, in `storage` (the browser's by default). */
export function sessionStore(
  deckId: string,
  storage: SessionStorage | undefined = browserStorage(),
): SessionStore {
  const key = PREFIX + deckId;
  return {
    read: () => {
      try {
        const raw = storage?.getItem(key);
        if (raw === null || raw === undefined) return undefined;
        return StoredSession.safeParse(JSON.parse(raw)).data;
      } catch {
        return undefined;
      }
    },
    write: (session) => {
      try {
        storage?.setItem(key, JSON.stringify(session));
      } catch {
        // Full or blocked: the Session goes on, unsaved.
      }
    },
    clear: () => {
      try {
        storage?.removeItem(key);
      } catch {
        // Blocked: nothing could have been stored.
      }
    },
  };
}

/** A new ID, for a Session or a write: unique enough across one browser's tabs. */
export const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** A store that keeps nothing: a Session without resume. */
export const NO_STORE: SessionStore = {
  read: () => undefined,
  write: () => {},
  clear: () => {},
};

/** Clears every Deck's stored Session (signing out). */
export function clearStoredSessions(storage: SessionStorage | undefined = browserStorage()): void {
  try {
    if (storage === undefined) return;
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    // Blocked: nothing could have been stored.
  }
}

/** A Session timeout in ms, from the Settings' minutes; the default without them. */
export const timeoutMsOf = (minutes: number | undefined) =>
  (minutes ?? DEFAULT_SESSION_TIMEOUT_MINUTES) * 60_000;

/** Whether `session` is still open at `now`: less than the timeout has passed since its last activity. */
export const isOpen = (session: Pick<StoredSession, "activeAt">, now: number, timeoutMs: number) =>
  now - session.activeAt < timeoutMs;

/**
 * The Deck's open Session, as the deck page reads it: undefined when none is
 * stored, or the stored one has timed out.
 */
export function openSession(
  store: SessionStore,
  { now, timeoutMs }: { now: number; timeoutMs: number },
): StoredSession | undefined {
  const stored = store.read();
  return stored !== undefined && isOpen(stored, now, timeoutMs) ? stored : undefined;
}

/**
 * How far the Deck's open Session has gone into its New cards, for the deck
 * page's counts (`study/overview` takes them); undefined with no open Session.
 * A New Card it shows is still to come, so it isn't counted as shown.
 * `timeoutMinutes` is the Settings', the default without them.
 */
export function openProgress(
  deckId: string,
  timeoutMinutes: number | undefined,
  { now = Date.now(), storage = browserStorage() }: { now?: number; storage?: SessionStorage } = {},
): { newShown: number; batches: number } | undefined {
  const open = openSession(sessionStore(deckId, storage), {
    now,
    timeoutMs: timeoutMsOf(timeoutMinutes),
  });
  if (open === undefined) return undefined;
  const pending = open.shown?.kind === "new" ? 1 : 0;
  return { newShown: Math.max(0, open.newShown - pending), batches: open.batches };
}
