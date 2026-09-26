import { useSyncExternalStore } from "react";

// The theme is not secret, so the user's choice lives in localStorage. index.html reads
// the same key in an inline script so the right theme is applied before first paint.
export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "quietkeys.theme";

const listeners = new Set<() => void>();

function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  listeners.forEach((listener) => listener());
}

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage can be unavailable; the choice still applies for this session.
  }
  applyTheme(theme);
}

/**
 * Backs up the inline script in index.html (for example if it was blocked), then keeps
 * following the OS setting until the user picks a theme themselves.
 */
export function initTheme(): void {
  if (!document.documentElement.dataset.theme) {
    applyTheme(storedTheme() ?? systemTheme());
  }
  window.matchMedia?.("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (storedTheme() === null) applyTheme(systemTheme());
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, currentTheme);
}
