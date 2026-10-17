import { useEffect, useState } from "react";

/** View > Theme. "system" follows the OS (desktop: Electron's nativeTheme, which
 *  main.ts also points at the chosen theme) or Thunderbird's own theme (add-on).
 *  Stored per computer in the "theme" setting; a localStorage copy lets the
 *  first paint use the right colors before settings have loaded. */
export type ThemePref = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const CACHE_KEY = "daynizer.theme";
const media = typeof window !== "undefined" && window.matchMedia
  ? window.matchMedia("(prefers-color-scheme: dark)")
  : null;

let pref: ThemePref = "system";
const listeners = new Set<(t: ResolvedTheme) => void>();

export function normalizeTheme(v: unknown): ThemePref {
  return v === "light" || v === "dark" ? v : "system";
}

export function resolvedTheme(): ResolvedTheme {
  if (pref !== "system") return pref;
  return media && !media.matches ? "light" : "dark";
}

function render() {
  const t = resolvedTheme();
  document.documentElement.dataset.theme = t;
  listeners.forEach((fn) => fn(t));
}

export function applyTheme(next: ThemePref) {
  pref = normalizeTheme(next);
  try { localStorage.setItem(CACHE_KEY, pref); } catch { /* storage unavailable */ }
  render();
}

/** Call once before the first render. */
export function initTheme() {
  let cached: ThemePref = "system";
  try { cached = normalizeTheme(localStorage.getItem(CACHE_KEY)); } catch { /* storage unavailable */ }
  pref = cached;
  media?.addEventListener("change", () => { if (pref === "system") render(); });
  render();
}

export function getThemePref(): ThemePref {
  return pref;
}

/** The theme actually showing (light/dark), re-rendering when it changes. */
export function useResolvedTheme(): ResolvedTheme {
  const [t, setT] = useState<ResolvedTheme>(resolvedTheme);
  useEffect(() => {
    listeners.add(setT);
    setT(resolvedTheme());
    return () => { listeners.delete(setT); };
  }, []);
  return t;
}
