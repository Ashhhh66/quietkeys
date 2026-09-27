import { useEffect, useRef } from "react";
import Kbd, { shortcutLabel } from "./Kbd";

const ROWS: { keys: string; action: string }[] = [
  { keys: shortcutLabel("K"), action: "Open the command palette" },
  { keys: shortcutLabel("F"), action: "Search the login list" },
  { keys: shortcutLabel("C"), action: "Copy the selected password" },
  { keys: shortcutLabel("B"), action: "Copy the selected username" },
  { keys: shortcutLabel("G"), action: "Open the generator" },
  { keys: shortcutLabel("N"), action: "Add a login" },
  { keys: shortcutLabel("L"), action: "Lock the vault" },
  { keys: "↵", action: "Copy the password from the palette" },
  { keys: "Shift ↵", action: "Copy the username from the palette" },
  { keys: "Esc", action: "Close the palette or the editor" },
];

export default function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => previous?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-6"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
        className="palette-panel flex max-h-[calc(100%-48px)] w-full max-w-[480px] flex-col overflow-hidden rounded-[18px] border border-toast-border bg-toast-bg"
      >
        <div className="flex items-center justify-between px-5 py-4">
          <h2 className="text-[16px] font-semibold">Keyboard shortcuts</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="rounded-[8px] px-2 py-1 text-[13px] text-muted hover:bg-nav-active-bg"
          >
            Close
          </button>
        </div>
        <ul className="flex flex-col gap-1 overflow-y-auto px-3 pb-4">
          {ROWS.map((row) => (
            <li key={row.action} className="flex items-center justify-between gap-4 px-2 py-1.5">
              <span className="text-[14px] text-text">{row.action}</span>
              <Kbd>{row.keys}</Kbd>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
