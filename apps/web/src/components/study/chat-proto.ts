import type { GradeResponse } from "@banki/shared";
import { useLocation } from "@tanstack/react-router";
import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { type StudyApi, type StudySession, type StudyState, studyApi } from "@/lib/study";

// PROTOTYPE (BAN-42): the Follow-up chat, with the Grader stubbed in the
// browser. Check grades at once with a canned grade (a Preview has no API
// key), and a message sent gets a canned reply that streams in word by word.
// `?state=` opens the screen on a Card already graded, in one of the
// Prototype section's states: `graded` on the ln(1 + x) sketch Card, the
// `chat-*` ones on the Maclaurin series Card, as BAN-40's `graded-mistakes`.

/** Calculus 2's seeded Cards the states show (SEED_IDS.cards.calculus2). */
const SKETCH_ID = "5eed0000-0000-4000-8000-0000000c0205";
const MACLAURIN_ID = "5eed0000-0000-4000-8000-0000000c0201";

export const CHAT_STATES = [
  "graded",
  "chat-empty",
  "chat",
  "chat-streaming",
  "chat-failed",
  "chat-cut-off",
  "chat-long",
] as const;
export type ChatState = (typeof CHAT_STATES)[number];

/** The `?state=` the page was opened with. */
export const requestedState = (): ChatState | undefined => {
  if (typeof window === "undefined") return undefined;
  const name = new URLSearchParams(window.location.search).get("state");
  return CHAT_STATES.find((s) => s === name);
};

const SKETCH_ANSWER =
  "It's defined for $x > -1$, with a vertical asymptote at $x = -1$.\n\nIt goes through the origin with slope $1$, since $\\frac{d}{dx}\\ln(1+x) = \\frac{1}{1+x}$.";

const MACLAURIN_ANSWER = [
  "Start from the geometric series, $\\frac{1}{1+t} = \\sum_{n=0}^{\\infty} (-1)^n t^n$ for $|t| < 1$.",
  "",
  "Differentiate both sides with respect to $t$ and put $t = x$:",
  "",
  "$$\\ln(1+x) = \\sum_{n=0}^{\\infty} (-1)^n \\frac{x^{n+1}}{n+1} = x - \\frac{x^2}{2} + \\frac{x^3}{3} - \\cdots$$",
  "",
  "It converges for $-1 \\le x \\le 1$, since the terms go to $0$.",
].join("\n");

const MACLAURIN_FEEDBACK = [
  "The series itself is right, and starting from the geometric series is the way in. Two steps go wrong on the way:",
  "",
  "1. **Integrate, don't differentiate.** $\\ln(1+x) = \\int_0^x \\frac{dt}{1+t}$, so you integrate the geometric series term by term from $0$ to $x$. Differentiating it gives $-\\frac{1}{(1+t)^2}$ instead.",
  "2. **The left end is out.** At $x = -1$ the series is $-\\sum \\frac{1}{n}$, the harmonic series, which diverges; terms going to $0$ isn't enough. The interval is $-1 < x \\le 1$, with $x = 1$ in by the alternating series test.",
].join("\n");

function rangeOf(text: string, part: string): { from: number; to: number } {
  const from = text.indexOf(part);
  return from < 0 ? { from: 0, to: 1 } : { from, to: from + part.length };
}

/** The stubbed Grader: canned grades for the two Cards the states show, a plain one for any other. */
function stubGrade(cardBack: string, answer: string): GradeResponse {
  if (answer === MACLAURIN_ANSWER) {
    return {
      rating: "hard",
      feedback: MACLAURIN_FEEDBACK,
      missing: [rangeOf(cardBack, "at $x = 1$ by the alternating series test (giving $\\ln 2$)")],
      mistakes: [
        {
          ...rangeOf(answer, "Differentiate both sides"),
          note: "Integrate from $0$ to $x$ instead: differentiating gives $-\\frac{1}{(1+t)^2}$.",
        },
        {
          ...rangeOf(answer, "-1 \\le"),
          note: "At $x = -1$ it's the harmonic series, which diverges: $-1 < x \\le 1$.",
        },
      ],
    };
  }
  if (answer === SKETCH_ANSWER) {
    return {
      rating: "good",
      feedback:
        "Right on the domain and on the slope at the origin. What's missing is the shape: the curve is **concave** everywhere, so it bends below its tangent $y = x$.",
      missing: [rangeOf(cardBack, "It is concave everywhere")],
      mistakes: [],
    };
  }
  const last = cardBack.split("\n").at(-1) ?? "";
  return {
    rating: "good",
    feedback:
      "Mostly there. (The stubbed Grader marks the Back's last line as missing on any Card, and you can ask it about this below.)",
    missing: last.trim() === "" ? [] : [rangeOf(cardBack, last)],
    mistakes: [],
  };
}

/**
 * The study API with the Grader stubbed. With a `?state=`, the Session's
 * first Card is the one the state shows.
 */
export function protoStudyApi(deckId: string): StudyApi {
  const real = studyApi(deckId);
  const state = requestedState();
  return {
    ...real,
    next: async (progress) => {
      // The Session's first Card (started twice under StrictMode, so not a one-shot).
      const first = progress.reviewsShown + progress.newShown === 0 && progress.after === undefined;
      if (state === undefined || !first) return real.next(progress);
      const id = state === "graded" ? SKETCH_ID : MACLAURIN_ID;
      const [card, intervals] = await Promise.all([real.card(id), real.intervals(id)]);
      if (card === "gone" || intervals === "gone") return real.next(progress);
      return { next: { card, intervals, kind: "review" }, newHeld: 0 };
    },
    grade: async (cardId, answer, signal) => {
      const card = await real.card(cardId);
      if (card === "gone") return "gone";
      await wait(requestedState() === undefined ? 1800 : 0, signal);
      return stubGrade(card.back, answer);
    },
  };
}

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    });
  });

/**
 * With a `?state=`, a Session stored from before is dropped, so the page
 * opens on the state's Card; the state pill changing `?state=` reloads.
 */
export function prepareProtoSession() {
  if (requestedState() === undefined) return;
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("banki.session.")) localStorage.removeItem(key);
    }
  } catch {
    // Blocked storage: nothing stored to drop.
  }
}

// ——— The chat ———

export type ChatMessage = {
  id: number;
  role: "user" | "grader";
  text: string;
  /** A reply's state: streaming in, in, failed before its first word, or cut off after some. */
  status: "streaming" | "done" | "failed" | "cut-off";
};

export type Chat = {
  /** The Card it is about; another Card starts with no chat. */
  cardId: string | undefined;
  /** Opened from the Feedback: before, the chat is only offered. */
  open: boolean;
  messages: ChatMessage[];
  draft: string;
};

/** From this many messages the chat shows the long-chat advice. */
export const LONG_CHAT = 20;

export const REPLY_FAILED = "Couldn't answer. Try again.";

const Q1 = "Why can't I differentiate? Differentiating the geometric series gives a series too.";
const A1 = [
  "It does, but a series for the wrong function. Term by term,",
  "",
  "$$\\frac{d}{dt}\\,\\frac{1}{1+t} = -\\frac{1}{(1+t)^2} = \\sum_{n=1}^{\\infty} (-1)^n\\, n\\, t^{n-1},$$",
  "",
  "which is a series for $-\\frac{1}{(1+t)^2}$, not for $\\ln(1+x)$. You want the function whose **derivative** is $\\frac{1}{1+t}$, so you go the other way and integrate from $0$ to $x$:",
  "",
  "$$\\int_0^x \\frac{dt}{1+t} = \\ln(1+x).$$",
  "",
  "Your final line is right, so you most likely integrated in your head and wrote *differentiate*.",
].join("\n");
const Q2 = "But the terms go to $0$ at $x = -1$. Why isn't that enough?";
const A2 = [
  "Terms going to $0$ is **necessary**, not sufficient. At $x = -1$ every term is negative:",
  "",
  "$$\\sum_{n=0}^{\\infty} (-1)^n \\frac{(-1)^{n+1}}{n+1} = -\\sum_{n=1}^{\\infty} \\frac{1}{n},$$",
  "",
  "the harmonic series, which grows without bound, like $\\ln N$. At $x = 1$ the signs alternate instead, so the alternating series test applies and the sum is $\\ln 2$.",
].join("\n");
const Q3 = "Show me the right step for the interval.";
const A3_PART =
  "Check the two ends separately, since the ratio test only gives $|x| < 1$. At $x = 1$ the series is $1 - \\frac12 + \\frac13 - \\cdots$, whose terms";

const LONG_PAIRS: [string, string][] = [
  [Q1, A1],
  [Q2, A2],
  [
    "Is the ratio test enough to get $|x| < 1$?",
    "Yes: $\\left|\\frac{a_{n+1}}{a_n}\\right| = \\frac{n+1}{n+2}|x| \\to |x|$, so it converges for $|x| < 1$ and diverges for $|x| > 1$. It says nothing at $|x| = 1$.",
  ],
  [
    "And the radius of convergence is $1$?",
    "Yes, $R = 1$, the distance from $0$ to the singularity at $x = -1$.",
  ],
  [
    "Could I start from the Taylor formula instead?",
    "You could: $f^{(n)}(0) = (-1)^{n-1}(n-1)!$ for $n \\ge 1$, which gives the same coefficients $\\frac{(-1)^{n-1}}{n}$. The geometric series is shorter.",
  ],
  [
    "Why is $f^{(n)}(0) = (-1)^{n-1}(n-1)!$?",
    "Differentiate $\\frac{1}{1+x}$ again and again: each time the power drops by one and brings a factor down, $f^{(n)}(x) = \\frac{(-1)^{n-1}(n-1)!}{(1+x)^n}$.",
  ],
  [
    "What does it converge to at $x = 1$?",
    "To $\\ln 2$, by Abel's theorem: the series converges there, and the function is continuous from the left.",
  ],
  [
    "Is it absolutely convergent at $x = 1$?",
    "No: $\\sum \\frac{1}{n}$ diverges, so at $x = 1$ it converges only conditionally.",
  ],
  [
    "How fast do the partial sums close in at $x = 1$?",
    "Slowly: the error after $N$ terms is at most $\\frac{1}{N+1}$, so $1000$ terms give about three digits.",
  ],
  [
    "Is there a faster series for $\\ln 2$?",
    "Yes: $\\ln 2 = \\ln\\frac{1+y}{1-y}$ with $y = \\frac13$, from subtracting the series of $\\ln(1-y)$, converges much faster.",
  ],
];

/** The canned reply to a message typed in the prototype. */
const TYPED_REPLY = [
  "Good question. Here it helps to go back to where the series comes from:",
  "",
  "$$\\ln(1+x) = \\int_0^x \\frac{dt}{1+t}.$$",
  "",
  "Everything about the series, the coefficients and the interval, follows from integrating the geometric series term by term. (This is the prototype's stubbed Grader: it gives every question this reply.)",
].join("\n");

let nextId = 1;
const msg = (role: ChatMessage["role"], text: string, status: ChatMessage["status"] = "done") => ({
  id: nextId++,
  role,
  text,
  status,
});

/** The chat each `?state=` opens with. */
function seeded(state: ChatState | undefined): Pick<Chat, "open" | "messages"> {
  switch (state) {
    case "chat-empty":
      return { open: true, messages: [] };
    case "chat":
      return {
        open: true,
        messages: [msg("user", Q1), msg("grader", A1), msg("user", Q2), msg("grader", A2)],
      };
    case "chat-streaming":
      return {
        open: true,
        messages: [
          msg("user", Q1),
          msg("grader", A1),
          msg("user", Q3),
          msg("grader", A3_PART, "streaming"),
        ],
      };
    case "chat-failed":
      return {
        open: true,
        messages: [
          msg("user", Q1),
          msg("grader", A1),
          msg("user", Q2),
          msg("grader", "", "failed"),
        ],
      };
    case "chat-cut-off":
      return {
        open: true,
        messages: [
          msg("user", Q1),
          msg("grader", A1),
          msg("user", Q3),
          msg("grader", A3_PART, "cut-off"),
        ],
      };
    case "chat-long":
      return {
        open: true,
        messages: LONG_PAIRS.flatMap(([q, a]) => [msg("user", q), msg("grader", a)]),
      };
    default:
      return { open: false, messages: [] };
  }
}

const EMPTY: Chat = { cardId: undefined, open: false, messages: [], draft: "" };
let chat: Chat = EMPTY;
const listeners = new Set<() => void>();
const set = (change: Partial<Chat>) => {
  chat = { ...chat, ...change };
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
let streaming: ReturnType<typeof setInterval> | undefined;
let seededOnce = false;

const stopStream = () => {
  clearInterval(streaming);
  streaming = undefined;
};

/** Streams `full` into the last message, a few words at a time. */
function stream(full: string) {
  stopStream();
  const words = full.split(/(?<= )/);
  let shown = 0;
  streaming = setInterval(() => {
    shown = Math.min(words.length, shown + 2);
    const messages = chat.messages.slice();
    const last = messages.at(-1);
    if (last === undefined || last.role !== "grader") return stopStream();
    const done = shown >= words.length;
    messages[messages.length - 1] = {
      ...last,
      text: words.slice(0, shown).join(""),
      status: done ? "done" : "streaming",
    };
    set({ messages });
    if (done) stopStream();
  }, 70);
}

/** Whether a reply is streaming in now. */
export const replying = (c: Chat) => c.messages.at(-1)?.status === "streaming";

export type ChatActions = {
  open: () => void;
  close: () => void;
  setDraft: (draft: string) => void;
  /** Sends the draft; not while blank or while a reply streams. */
  send: () => void;
  /** Ends the streaming reply, keeping what came. */
  stop: () => void;
  /** Asks for the last reply again, in its place. */
  retry: () => void;
};

/**
 * The prototype's chat, kept in step with the Session: it lives while its
 * Card is shown with its grade in, and goes when another Card shows.
 */
export function useChatProto(state: StudyState): [Chat, ChatActions, boolean] {
  const current = useSyncExternalStore(subscribe, () => chat);
  const cardId = state.phase === "card" ? state.shown?.card.id : undefined;
  const graded = state.revealed && state.grade?.status === "graded";
  useEffect(() => {
    if (chat.cardId === cardId && graded) return;
    stopStream();
    if (!graded || cardId === undefined) {
      if (chat.cardId !== undefined || chat.open) set(EMPTY);
      return;
    }
    const first = !seededOnce;
    seededOnce = true;
    set({ ...EMPTY, cardId, ...(first ? seeded(requestedState()) : {}) });
  }, [cardId, graded]);
  const actions = useMemo<ChatActions>(
    () => ({
      open: () => set({ open: true }),
      close: () => set({ open: false }),
      setDraft: (draft) => set({ draft }),
      send: () => {
        const text = chat.draft;
        if (text.trim() === "" || replying(chat)) return;
        set({
          draft: "",
          messages: [...chat.messages, msg("user", text), msg("grader", "", "streaming")],
        });
        setTimeout(() => stream(TYPED_REPLY), 500);
      },
      stop: () => {
        stopStream();
        const messages = chat.messages.slice();
        const last = messages.at(-1);
        if (last?.status !== "streaming") return;
        messages[messages.length - 1] = { ...last, status: "done" };
        set({ messages });
      },
      retry: () => {
        const last = chat.messages.at(-1);
        if (last === undefined || last.role !== "grader" || replying(chat)) return;
        set({
          messages: [...chat.messages.slice(0, -1), { ...last, text: "", status: "streaming" }],
        });
        setTimeout(() => stream(last.status === "cut-off" ? A3_FULL : last.text || A2), 500);
      },
    }),
    [],
  );
  return [current, actions, graded && current.cardId === cardId];
}

const A3_FULL = [
  A3_PART +
    " shrink to $0$ and alternate, so it converges by the alternating series test, to $\\ln 2$.",
  "",
  "At $x = -1$ it is $-\\sum \\frac{1}{n}$, which diverges. So the interval is",
  "",
  "$$-1 < x \\le 1.$$",
].join("\n");

/** Rating the Card ends its chat; for a key handler that rates. */
export const endChat = () => {
  stopStream();
  set(EMPTY);
};

/**
 * With a `?state=`, checks the first Card with the state's answer as soon
 * as it shows, so the stubbed Grader grades it at once.
 */
export function useProtoCheck(session: StudySession, state: StudyState) {
  const cardId = state.phase === "card" ? state.shown?.card.id : undefined;
  useEffect(() => {
    const asked = requestedState();
    if (asked === undefined || cardId === undefined || checkedOnce) return;
    checkedOnce = true;
    const s = session.getState();
    if (s.revealed) return;
    if (s.mode !== "write") session.setMode("write");
    session.setDraft(asked === "graded" ? SKETCH_ANSWER : MACLAURIN_ANSWER);
    session.check();
  }, [cardId, session]);
}
let checkedOnce = false;

/** The state pill changes `?state=` in place: start the page afresh in the new state. */
export function useStateReload() {
  const asked = useLocation({
    select: (l) => {
      const search: Record<string, unknown> = l.search;
      return typeof search["state"] === "string" ? search["state"] : undefined;
    },
  });
  const first = useRef(asked);
  useEffect(() => {
    if (asked === first.current) return;
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("banki.session.")) localStorage.removeItem(key);
    }
    window.location.reload();
  }, [asked]);
}

/** The chat, its actions, and whether it is live (the shown Card's grade is in). */
export const ChatContext = createContext<[Chat, ChatActions, boolean] | undefined>(undefined);

export function useChat(): [Chat, ChatActions, boolean] {
  const value = useContext(ChatContext);
  if (value === undefined) throw new Error("useChat outside ChatContext");
  return value;
}
