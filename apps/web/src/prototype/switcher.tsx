// PROTOTYPE (BAN-9): the floating variant switcher. Hidden in production builds
// in automated browsers (navigator.webdriver), and when localStorage has
// banki-prototype-switcher=hidden (set for the playwright-cli reference shots).

import { useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect } from "react";
import { STATES, VARIANTS, useProtoState, useVariant } from "./shared";

export function PrototypeSwitcher() {
  const variant = useVariant();
  const state = useProtoState();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const index = VARIANTS.findIndex((v) => v.key === variant);
  const states = STATES[pathname] ?? ["default"];

  const go = (key: string, nextState?: string) =>
    void navigate({
      to: pathname,
      search: (nextState && nextState !== "default"
        ? { variant: key, state: nextState }
        : { variant: key }) as never,
      replace: true,
    });

  const step = (d: number) => go(VARIANTS[(index + d + VARIANTS.length) % VARIANTS.length]!.key, state);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.closest("input, textarea, select, [contenteditable]") || t.isContentEditable)) return;
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  let hidden = false;
  try {
    hidden = localStorage.getItem("banki-prototype-switcher") === "hidden";
  } catch {
    // Storage blocked: show it.
  }
  if (import.meta.env.PROD || navigator.webdriver || hidden) return null;

  return (
    <div
      style={{ fontFamily: "ui-monospace, Menlo, monospace" }}
      className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] left-1/2 z-[100] flex -translate-x-1/2 items-center gap-1 rounded-full bg-[#111827] p-1 text-xs text-white shadow-[0_6px_24px_rgba(0,0,0,0.35)] ring-1 ring-white/20 lg:bottom-4"
    >
      <button
        aria-label="Previous variant"
        onClick={() => step(-1)}
        className="flex size-8 items-center justify-center rounded-full hover:bg-white/15"
      >
        <ChevronLeft className="size-4" />
      </button>
      <span className="px-1 whitespace-nowrap">
        {variant.toUpperCase()} ({VARIANTS[index]?.name})
      </span>
      <select
        aria-label="State"
        value={state}
        onChange={(e) => go(variant, e.target.value)}
        className="h-7 rounded-full bg-white/15 px-2 text-xs text-white"
      >
        {states.map((s) => (
          <option key={s} value={s} className="text-black">
            {s}
          </option>
        ))}
      </select>
      <button
        aria-label="Next variant"
        onClick={() => step(1)}
        className="flex size-8 items-center justify-center rounded-full hover:bg-white/15"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}
