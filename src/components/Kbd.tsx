import type { ReactNode } from "react";

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Visible hint for Ctrl/⌘ plus `key`, e.g. "Ctrl L" or "⌘L". */
export function shortcutLabel(key: string): string {
  return isMac ? `⌘${key}` : `Ctrl ${key}`;
}

/** The same shortcut in `aria-keyshortcuts` syntax. */
export function shortcutKeys(key: string): string {
  return isMac ? `Meta+${key}` : `Control+${key}`;
}

export default function Kbd({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <kbd
      aria-hidden
      className={`rounded-[5px] border border-kbd-border px-1.5 py-0.5 font-sans text-[11px] leading-none text-muted ${className}`}
    >
      {children}
    </kbd>
  );
}
