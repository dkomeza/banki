import { useSyncExternalStore } from "react";

/** The theme the User picks on this device. System follows the OS. */
export type ThemeChoice = "system" | "light" | "dark";

export const THEME_CHOICES: readonly { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** What public/theme.js puts on `window.bankiTheme`. */
export type ThemeController = {
  choice(): ThemeChoice;
  set(choice: ThemeChoice): void;
  /** Calls `listener` whenever the choice changes; returns a function that stops it. */
  subscribe(listener: () => void): () => void;
};

declare global {
  interface Window {
    bankiTheme?: ThemeController;
  }
}

// theme.js runs before the app does. Without it (a blocked script), the app
// shows the light theme and the choice does nothing.
const fallback: ThemeController = {
  choice: () => "system",
  set: () => {},
  subscribe: () => () => {},
};
const controller = () => window.bankiTheme ?? fallback;

/** The theme choice on this device, and a way to change it. */
export function useThemeChoice(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const choice = useSyncExternalStore(
    (listener) => controller().subscribe(listener),
    () => controller().choice(),
  );
  return [choice, (next) => controller().set(next)];
}
