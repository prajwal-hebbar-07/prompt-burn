/**
 * Light and dark, with the OS as the default.
 *
 * The whole palette is one class on `<html>` (`.theme-dark` in `index.css`), so
 * theming is a class toggle, not a prop threaded through every component. The
 * preference is remembered per host — a VS Code tab and the desktop window keep
 * their own — because it is view state, not usage data, and never belongs in
 * `~/.prompt-burn/db.sqlite`.
 */

import { useCallback, useEffect, useState } from "react";

export const THEME_PREFERENCES = ["system", "light", "dark"] as const;

/** What the user picked. `system` follows the OS and keeps following it. */
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/** What is actually on screen once `system` is resolved. */
export type Theme = "light" | "dark";

const STORAGE_KEY = "prompt-burn:theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";
const DARK_CLASS = "theme-dark";

function isPreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.includes(value as ThemePreference);
}

/** Storage is a nicety: a webview that denies it still themes correctly. */
function readPreference(): ThemePreference {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    return isPreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

function writePreference(preference: ThemePreference): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, preference);
  } catch {
    // A host without storage just forgets the choice on reload.
  }
}

/** jsdom and older webviews have no `matchMedia`; light is the safe default. */
function systemTheme(): Theme {
  if (typeof globalThis.matchMedia !== "function") return "light";
  return globalThis.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

export interface ThemeControl {
  preference: ThemePreference;
  theme: Theme;
  setPreference: (preference: ThemePreference) => void;
}

export function useTheme(): ThemeControl {
  const [preference, setStoredPreference] = useState<ThemePreference>(readPreference);
  const [system, setSystem] = useState<Theme>(systemTheme);

  // Following the OS means following it after mount too, not just at startup.
  useEffect(() => {
    if (typeof globalThis.matchMedia !== "function") return;
    const query = globalThis.matchMedia(DARK_QUERY);
    const onChange = () => setSystem(query.matches ? "dark" : "light");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const theme: Theme = preference === "system" ? system : preference;

  useEffect(() => {
    document.documentElement.classList.toggle(DARK_CLASS, theme === "dark");
  }, [theme]);

  const setPreference = useCallback((next: ThemePreference) => {
    writePreference(next);
    setStoredPreference(next);
  }, []);

  return { preference, theme, setPreference };
}
