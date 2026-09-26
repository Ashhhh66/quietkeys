import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Lock, Plus, Sparkles } from "lucide-react";
import type { EntrySummary } from "../api";
import Kbd, { shortcutLabel } from "./Kbd";

interface Props {
  entries: EntrySummary[];
  onCopyPassword: (id: string) => void;
  onCopyUsername: (id: string) => void;
  onGenerate: () => void;
  onAdd: () => void;
  onLock: () => void;
  onClose: () => void;
}

type ActionId = "generate" | "add" | "lock";

interface Action {
  id: ActionId;
  label: string;
  hint: string;
}

const ACTIONS: Action[] = [
  { id: "generate", label: "Generate a password", hint: shortcutLabel("G") },
  { id: "add", label: "Add a login", hint: shortcutLabel("N") },
  { id: "lock", label: "Lock vault", hint: shortcutLabel("L") },
];

const FOCUSABLE =
  "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])";

function loginHost(entry: EntrySummary): string {
  return entry.host || "";
}

export default function CommandPalette({
  entries,
  onCopyPassword,
  onCopyUsername,
  onGenerate,
  onAdd,
  onLock,
  onClose,
}: Props) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const q = query.trim().toLowerCase();
  const logins = entries
    .filter((entry) =>
      [entry.title, entry.username, entry.url, loginHost(entry)].some((value) =>
        value.toLowerCase().includes(q),
      ),
    )
    .slice(0, 5);
  const itemCount = logins.length + ACTIONS.length;
  const active = itemCount === 0 ? 0 : Math.min(index, itemCount - 1);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    return () => previous?.focus();
  }, []);

  function run(position: number, shift: boolean) {
    if (position < logins.length) {
      const entry = logins[position];
      if (!entry) return;
      if (shift) onCopyUsername(entry.id);
      else onCopyPassword(entry.id);
      return;
    }
    const action = ACTIONS[position - logins.length];
    if (!action) return;
    if (action.id === "generate") onGenerate();
    else if (action.id === "add") onAdd();
    else onLock();
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      inputRef.current?.focus();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex(Math.min(itemCount - 1, active + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex(Math.max(0, active - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      run(active, e.shiftKey);
      return;
    }
    if (e.key === "Tab") {
      const root = panelRef.current;
      if (!root) return;
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-overlay" onMouseDown={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="palette-panel fixed top-[110px] left-1/2 flex max-h-[min(560px,calc(100%-140px))] w-[620px] max-w-[calc(100%-24px)] -translate-x-1/2 flex-col overflow-hidden rounded-[18px] border border-toast-border bg-toast-bg"
      >
        <div className="flex h-[60px] items-center gap-3 border-b border-panel-border px-4">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            placeholder="Search logins and actions"
            aria-label="Command palette search"
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[17px] text-text outline-none placeholder:text-muted"
          />
          <Kbd>Esc</Kbd>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          <p className="px-2 py-1 text-[11px] font-semibold tracking-[0.06em] text-label uppercase">
            Logins
          </p>
          {logins.length === 0 ? (
            <p className="px-3 py-2 text-[13.5px] text-muted">No matching logins</p>
          ) : (
            <ul aria-label="Palette logins">
              {logins.map((entry, position) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    aria-selected={position === active}
                    onMouseEnter={() => setIndex(position)}
                    onClick={() => run(position, false)}
                    className={`flex w-full items-center gap-3 rounded-[12px] px-3 py-2 text-left ${
                      position === active ? "bg-row-selected-bg" : "hover:bg-nav-active-bg/60"
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14.5px] font-semibold text-text">
                        {entry.title}
                      </span>
                      {loginHost(entry) && (
                        <span className="block truncate text-[13px] text-muted">
                          {loginHost(entry)}
                        </span>
                      )}
                    </span>
                    {position === active && (
                      <span className="shrink-0 text-[12px] text-muted">↵ Copy password</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="px-2 pt-3 pb-1 text-[11px] font-semibold tracking-[0.06em] text-label uppercase">
            Actions
          </p>
          <ul aria-label="Palette actions">
            {ACTIONS.map((action, offset) => {
              const position = logins.length + offset;
              const Icon = action.id === "generate" ? Sparkles : action.id === "add" ? Plus : Lock;
              return (
                <li key={action.id}>
                  <button
                    type="button"
                    aria-selected={position === active}
                    onMouseEnter={() => setIndex(position)}
                    onClick={() => run(position, false)}
                    className={`flex w-full items-center gap-3 rounded-[12px] px-3 py-2 text-left ${
                      position === active ? "bg-row-selected-bg" : "hover:bg-nav-active-bg/60"
                    }`}
                  >
                    <Icon size={16} strokeWidth={2} aria-hidden className="text-muted" />
                    <span className="flex-1 text-[14.5px] text-text">{action.label}</span>
                    <Kbd>{action.hint}</Kbd>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-panel-border px-4 py-2.5 text-[12px] text-muted">
          <span>↵ Copy password</span>
          <span>Shift ↵ Copy username</span>
          <span>↑↓ Move</span>
        </div>
      </div>
    </div>
  );
}
