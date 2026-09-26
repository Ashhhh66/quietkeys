import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Clock,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  List,
  Lock,
  Pencil,
  Plus,
  Search,
  Settings,
  Sparkles,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import {
  copyPassword,
  copyUsername,
  deleteEntry,
  friendlyMessage,
  getEntry,
  getPassword,
  isApiError,
  listEntries,
  lock as apiLock,
  type EntryDetails,
  type EntrySummary,
} from "../api";
import { domainOf } from "../avatar";
import Avatar from "../components/Avatar";
import Kbd, { shortcutKeys, shortcutLabel } from "../components/Kbd";
import ThemeSwitch from "../components/ThemeSwitch";
import EntryEditor, { type AppliedPassword } from "./EntryEditor";
import Generator from "./Generator";
import SettingsScreen from "./Settings";

interface Props {
  onLocked: () => void;
}

const REVEAL_DURATION_MS = 30_000;
const PASSWORD_MASK = "•".repeat(12);

export default function VaultList({ onLocked }: Props) {
  const [entries, setEntries] = useState<EntrySummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [nav, setNav] = useState<"all" | "logins" | "generator" | "settings">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<"new" | string | null>(null);
  const [generatorOverEditor, setGeneratorOverEditor] = useState(false);
  const [appliedPassword, setAppliedPassword] = useState<AppliedPassword | null>(null);
  // Bumped after every save so the details panel re-fetches notes and dates.
  const [detailsVersion, setDetailsVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    try {
      setEntries(await listEntries());
    } catch (err) {
      setError(isApiError(err) ? err.message : "Could not load entries");
    }
  }

  // Fetches on mount. Written as its own inline, cancellable async call (rather than
  // just invoking `refresh` here) so the effect only ever updates state from a fetch it
  // is still interested in; `refresh` itself stays around for the event handlers below.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await listEntries();
        if (!cancelled) setEntries(result);
      } catch (err) {
        if (!cancelled) setError(isApiError(err) ? err.message : "Could not load entries");
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLock = useCallback(async () => {
    await apiLock();
    onLocked();
  }, [onLocked]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
      const key = e.key.toLowerCase();
      if (mod && key === "f") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (mod && key === "l") {
        e.preventDefault();
        void handleLock();
      } else if (e.key === "Escape") {
        setEditing(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleLock]);

  async function handleDelete(entry: EntrySummary) {
    if (!window.confirm(`Delete "${entry.title}"? This cannot be undone.`)) return;
    try {
      await deleteEntry(entry.id);
      setSelectedId((current) => (current === entry.id ? null : current));
      await refresh();
    } catch (err) {
      setError(isApiError(err) ? err.message : "Could not delete the entry");
    }
  }

  function selectEntry(id: string) {
    setSelectedId(id);
    setEditing(null);
    setGeneratorOverEditor(false);
    setNav((current) => (current === "generator" || current === "settings" ? "all" : current));
  }

  function startNewEntry() {
    setEditing("new");
    setGeneratorOverEditor(false);
    setNav((current) => (current === "generator" || current === "settings" ? "all" : current));
  }

  const query = search.toLowerCase();
  const filtered = entries.filter(
    (entry) =>
      entry.title.toLowerCase().includes(query) ||
      entry.username.toLowerCase().includes(query) ||
      entry.url.toLowerCase().includes(query),
  );
  // Keep an explicit choice when it is still in the list. Otherwise show the first
  // visible login, so the details panel is filled as soon as the vault has entries.
  const selected =
    filtered.find((entry) => entry.id === selectedId) ??
    (editing === null ? (filtered[0] ?? null) : null);
  const highlightedId = editing === "new" ? null : (editing ?? selected?.id ?? null);

  let details: ReactNode = null;
  if (nav === "settings") {
    details = <SettingsScreen />;
  } else if (editing !== null) {
    details = (
      <div className="relative h-full">
        <EntryEditor
          key={editing}
          id={editing === "new" ? null : editing}
          appliedPassword={appliedPassword}
          onOpenGenerator={() => setGeneratorOverEditor(true)}
          onDone={(saved) => {
            setEditing(null);
            setGeneratorOverEditor(false);
            if (saved) {
              setSelectedId(saved.id);
              setDetailsVersion((v) => v + 1);
            }
            refresh();
          }}
        />
        {generatorOverEditor && (
          <div className="absolute inset-0 z-10 overflow-y-auto bg-page">
            <Generator
              onUse={(text) => {
                setAppliedPassword({ text, nonce: Date.now() });
                setGeneratorOverEditor(false);
              }}
              onClose={() => setGeneratorOverEditor(false)}
            />
          </div>
        )}
      </div>
    );
  } else if (nav === "generator") {
    details = <Generator />;
  } else if (selected) {
    details = (
      <EntryPanel
        key={`${selected.id}:${detailsVersion}`}
        entry={selected}
        onEdit={() => setEditing(selected.id)}
        onDelete={() => handleDelete(selected)}
      />
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-page text-text">
      <aside className="flex w-[224px] shrink-0 flex-col gap-1 border-r border-sidebar-border bg-sidebar px-3 py-[22px]">
        <div className="flex items-center gap-2.5 px-1 pb-[22px]">
          <span className="flex size-8 items-center justify-center rounded-[9px] bg-accent text-on-accent">
            <KeyRound size={18} strokeWidth={2} aria-hidden />
          </span>
          <span className="text-[17px] font-semibold tracking-[-0.01em]">quietkeys</span>
        </div>
        <nav aria-label="Vault" className="flex flex-col gap-1">
          <NavItem
            icon={List}
            label="All items"
            count={entries.length}
            active={nav === "all"}
            onClick={() => {
              setNav("all");
              setGeneratorOverEditor(false);
            }}
          />
          <NavItem
            icon={KeyRound}
            label="Logins"
            count={entries.length}
            active={nav === "logins"}
            onClick={() => {
              setNav("logins");
              setGeneratorOverEditor(false);
            }}
          />
          <NavItem
            icon={Sparkles}
            label="Generator"
            active={nav === "generator" || generatorOverEditor}
            onClick={() => {
              if (editing !== null) {
                setGeneratorOverEditor(true);
                return;
              }
              setNav("generator");
            }}
          />
          <NavItem
            icon={Settings}
            label="Settings"
            active={nav === "settings"}
            onClick={() => {
              setNav("settings");
              setEditing(null);
              setGeneratorOverEditor(false);
            }}
          />
        </nav>
        <div className="flex-1" />
        <ThemeSwitch />
        <button
          type="button"
          onClick={handleLock}
          aria-label="Lock vault"
          aria-keyshortcuts={shortcutKeys("L")}
          className="mt-1 flex h-11 w-full items-center gap-2.5 rounded-[10px] border border-lock-border bg-lock-bg px-3 text-left text-[14px] font-medium text-text hover:bg-nav-active-bg"
        >
          <Lock size={17} strokeWidth={2} aria-hidden />
          <span className="flex-1">Lock vault</span>
          <Kbd>{shortcutLabel("L")}</Kbd>
        </button>
      </aside>

      <section
        aria-label="Login list"
        className="flex w-[356px] shrink-0 flex-col border-r border-sidebar-border"
      >
        <div className="flex gap-2.5 px-4 pt-5 pb-3">
          <div className="relative flex-1">
            <label htmlFor="vault-search" className="sr-only">
              Search
            </label>
            <Search
              size={16}
              strokeWidth={2}
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted"
            />
            <input
              id="vault-search"
              ref={searchRef}
              placeholder="Search logins"
              autoComplete="off"
              spellCheck={false}
              aria-keyshortcuts={shortcutKeys("F")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-11 w-full rounded-[10px] border border-input-border bg-input-bg pr-16 pl-10 text-[14px] text-text placeholder:text-muted"
            />
            <Kbd className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2">
              {shortcutLabel("F")}
            </Kbd>
          </div>
          <button
            type="button"
            aria-label="Add login"
            onClick={startNewEntry}
            className="flex size-11 shrink-0 items-center justify-center rounded-[10px] bg-accent text-on-accent hover:bg-accent-hover"
          >
            <Plus size={18} strokeWidth={2} aria-hidden />
          </button>
        </div>
        <h2 className="px-5 pt-1 pb-2 text-[12px] font-semibold tracking-[0.06em] text-label uppercase">
          {query
            ? `${filtered.length} ${filtered.length === 1 ? "result" : "results"}`
            : "All logins"}
        </h2>
        {error && (
          <p
            role="alert"
            className="mx-4 mb-2 rounded-[10px] border border-error-border bg-error-bg px-3.5 py-2.5 text-[13px] text-error-fg"
          >
            {error}
          </p>
        )}
        {!loaded ? null : entries.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 pb-16 text-center">
            <p className="text-[15px] font-medium text-text-soft">No passwords yet</p>
            <button
              type="button"
              onClick={startNewEntry}
              className="flex h-10 items-center gap-2 rounded-[10px] bg-accent px-4 text-[14px] font-semibold text-on-accent hover:bg-accent-hover"
            >
              <Plus size={16} strokeWidth={2} aria-hidden />
              Add your first login
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-6 pb-16 text-center">
            <p className="text-[14px] text-muted">No logins match that search.</p>
          </div>
        ) : (
          <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 pb-4">
            {filtered.map((entry) => {
              const isSelected = entry.id === highlightedId;
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => selectEntry(entry.id)}
                    aria-current={isSelected ? "true" : undefined}
                    className={`flex w-full items-center gap-3 rounded-[10px] border p-2.5 text-left ${
                      isSelected
                        ? "border-row-selected-border bg-row-selected-bg"
                        : "border-transparent hover:bg-nav-active-bg/60"
                    }`}
                  >
                    <Avatar title={entry.title} url={entry.url} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14.5px] font-semibold text-text">
                        {entry.title}
                      </span>
                      <span className="block truncate text-[13px] text-muted">
                        {entry.username}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <main aria-label="Login details" className="min-w-0 flex-1 overflow-y-auto">
        {details}
      </main>
    </div>
  );
}

function NavItem({
  icon: Icon,
  label,
  count,
  active = false,
  disabled = false,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  count?: number;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const tone = disabled
    ? "text-disabled-fg"
    : active
      ? "bg-nav-active-bg text-text"
      : "text-nav-text hover:bg-nav-active-bg/60";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-current={active ? "page" : undefined}
      className={`flex h-10 w-full items-center gap-2.5 rounded-[9px] px-3 text-left text-[14px] font-medium ${tone}`}
    >
      <Icon size={18} strokeWidth={2} aria-hidden />
      <span className="flex-1">{label}</span>
      {count !== undefined && <span className="text-[12px] text-muted">{count}</span>}
    </button>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  // Day, then the locale's short month name, then the year: "12 Sep 2026".
  const parts = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("day")} ${pick("month")} ${pick("year")}`;
}

function EntryPanel({
  entry,
  onEdit,
  onDelete,
}: {
  entry: EntrySummary;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [details, setDetails] = useState<EntryDetails | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copiesSupported, setCopiesSupported] = useState(true);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  async function copy(which: "username" | "password") {
    setCopyError(null);
    try {
      if (which === "username") await copyUsername(entry.id);
      else await copyPassword(entry.id);
      setCopied(true);
    } catch (err) {
      if (isApiError(err) && err.kind === "unsupported") {
        setCopiesSupported(false);
        setCopied(false);
        return;
      }
      setCopyError(friendlyMessage(err));
    }
  }

  // Notes and dates only; the password is never part of this payload.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await getEntry(entry.id);
        if (!cancelled) setDetails(result);
      } catch (err) {
        if (!cancelled) setLoadError(isApiError(err) ? err.message : "Could not load entry");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entry.id]);

  // Hides the password again 30 seconds after it was revealed. Selecting another entry,
  // opening the editor, or locking unmounts this panel and discards it immediately.
  useEffect(() => {
    if (revealed === null) return;
    const timer = setTimeout(() => setRevealed(null), REVEAL_DURATION_MS);
    return () => clearTimeout(timer);
  }, [revealed]);

  async function toggleReveal() {
    if (revealed !== null) {
      setRevealed(null);
      return;
    }
    try {
      setRevealed(await getPassword(entry.id));
    } catch {
      // The entry may have just been deleted elsewhere; nothing to show either way.
    }
  }

  const domain = domainOf(entry.url);

  return (
    <div className="flex flex-col gap-6 px-10 py-8">
      <header className="flex items-center gap-4">
        <Avatar title={entry.title} url={entry.url} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[26px] font-semibold tracking-[-0.015em]">{entry.title}</h2>
          {domain && <p className="truncate text-[14px] text-muted">{domain}</p>}
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="flex h-10 shrink-0 items-center gap-2 rounded-[10px] border border-input-border bg-card px-4 text-[14px] font-medium text-text hover:bg-nav-active-bg"
        >
          <Pencil size={16} strokeWidth={2} aria-hidden />
          Edit
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete login"
          className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-danger-border bg-danger-bg text-danger-fg hover:bg-danger-bg-hover"
        >
          <Trash2 size={17} strokeWidth={2} aria-hidden />
        </button>
      </header>

      <div className="divide-y divide-card-border rounded-[14px] border border-card-border bg-card">
        <FieldRow
          label="Username"
          actions={
            copiesSupported ? (
              <IconButton label="Copy username" onClick={() => void copy("username")}>
                <Copy size={17} strokeWidth={2} aria-hidden />
              </IconButton>
            ) : undefined
          }
        >
          {entry.username || <span className="text-muted">—</span>}
        </FieldRow>
        <FieldRow
          label="Password"
          badge={
            revealed !== null && (
              <span className="inline-flex items-center gap-1 rounded-full bg-badge-bg px-2 py-0.5 text-[12px] font-medium text-badge-fg">
                <Clock size={12} strokeWidth={2} aria-hidden />
                Hides in 30s
              </span>
            )
          }
          actions={
            <>
              <IconButton
                label={revealed !== null ? "Hide password" : "Show password"}
                onClick={toggleReveal}
              >
                {revealed !== null ? (
                  <EyeOff size={17} strokeWidth={2} aria-hidden />
                ) : (
                  <Eye size={17} strokeWidth={2} aria-hidden />
                )}
              </IconButton>
              {copiesSupported && (
                <IconButton label="Copy password" onClick={() => void copy("password")}>
                  <Copy size={17} strokeWidth={2} aria-hidden />
                </IconButton>
              )}
            </>
          }
        >
          <span
            className={`font-mono text-[15px] break-all select-none ${
              revealed !== null ? "tracking-[0.02em]" : "tracking-[0.18em]"
            }`}
            onContextMenu={(e) => e.preventDefault()}
          >
            {revealed !== null ? revealed : PASSWORD_MASK}
          </span>
        </FieldRow>
        <FieldRow label="Website">
          {entry.url ? (
            <span className="break-all text-accent-text">{entry.url}</span>
          ) : (
            <span className="text-muted">—</span>
          )}
        </FieldRow>
      </div>
      {copied && (
        <p role="status" className="text-[13px] text-ok-fg">
          Copied, clears in 30s
        </p>
      )}
      {copyError && (
        <p role="alert" className="text-[13.5px] text-error-fg">
          {copyError}
        </p>
      )}

      <section className="flex flex-col gap-2 rounded-[14px] border border-card-border bg-card px-5 py-4">
        <h3 className="text-[12px] font-semibold tracking-[0.06em] text-label uppercase">Notes</h3>
        {details === null ? (
          <p className="text-[14.5px] text-muted">{loadError ? "—" : "Loading…"}</p>
        ) : details.notes ? (
          <p className="text-[14.5px] leading-[1.55] break-words whitespace-pre-wrap text-text-soft">
            {details.notes}
          </p>
        ) : (
          <p className="text-[14.5px] text-muted">No notes.</p>
        )}
      </section>

      {details && (
        <p className="text-[12.5px] text-label">
          Created {formatDate(details.createdAt)} · Edited {formatDate(details.updatedAt)}
        </p>
      )}
      {loadError && (
        <p
          role="alert"
          className="rounded-[10px] border border-error-border bg-error-bg px-3.5 py-3 text-[13.5px] text-error-fg"
        >
          {loadError}
        </p>
      )}
    </div>
  );
}

function FieldRow({
  label,
  badge,
  actions,
  children,
}: {
  label: string;
  badge?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-5 py-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold tracking-[0.06em] text-label uppercase">
            {label}
          </span>
          {badge}
        </div>
        <div className="mt-1 text-[15px] break-words text-text">{children}</div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled = false,
  children,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="flex size-10 items-center justify-center rounded-[10px] text-icon-button hover:bg-nav-active-bg/60 disabled:text-disabled-fg disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
