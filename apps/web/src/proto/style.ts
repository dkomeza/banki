// PROTOTYPE (BAN-10), round 2: the Normal / Compact style the Maintainer asked
// for, chosen on Settings and kept on this device. `?state=compact` (or
// `compact-<state>`, such as `compact-move`) opens a screen in Compact for that
// load, and `normal-<state>` in Normal, whatever the setting says.
import { useSearch } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";

export type FolderStyle = "normal" | "compact";

const KEY = "banki.proto.folderStyle";
const listeners = new Set<() => void>();
let fallback: FolderStyle = "normal";

function read(): FolderStyle {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === "compact" || stored === "normal" ? stored : fallback;
  } catch {
    return fallback;
  }
}

export function setFolderStyle(style: FolderStyle) {
  fallback = style;
  try {
    localStorage.setItem(KEY, style);
  } catch {
    // Kept in memory until a reload.
  }
  for (const l of listeners) l();
}

/** The setting itself, as Settings shows it. */
export function useStoredFolderStyle(): [FolderStyle, (s: FolderStyle) => void] {
  const style = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    read,
    () => "normal" as const,
  );
  return [style, setFolderStyle];
}

/** Splits a raw `?state=` into its style override and the state itself. */
export function splitState(raw: unknown): { style?: FolderStyle; state?: string } {
  if (typeof raw !== "string") return {};
  for (const style of ["compact", "normal"] as const) {
    if (raw === style) return { style };
    if (raw.startsWith(`${style}-`)) return { style, state: raw.slice(style.length + 1) };
  }
  return { state: raw };
}

/** The style a screen shows: this load's override, else the setting. */
export function useFolderStyle(): FolderStyle {
  const search: Record<string, unknown> = useSearch({ strict: false });
  const [stored] = useStoredFolderStyle();
  return splitState(search["state"]).style ?? stored;
}
