import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Copy,
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
import ClipboardToast, { type ClipboardKind } from "../components/ClipboardToast";
import Kbd, { shortcutKeys, shortcutLabel } from "../components/Kbd";
import { formatAutoLock, useIdleLock } from "../hooks/useIdleLock";
import { usePasswordScore } from "../hooks/usePasswordScore";
import { changedLabel, strengthIsWeak, strengthLabel } from "../relativeTime";
import EntryEditor, { type AppliedPassword } from "./EntryEditor";
import Generator from "./Generator";
import SettingsScreen from "./Settings";

interface Props {
  onLocked: () => void;
}

const REVEAL_DURATION_MS = 30_000;
const PASSWORD_MASK = "•".repeat(12);

type SortOrder = "changed" | "name";
type ClipboardNotice = { kind: ClipboardKind; startedAt: number };

export default function VaultList({ onLocked }: Props) {
  const [entries, setEntries] = useState<EntrySummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortOrder>("changed");
  const [nav, setNav] = useState<"all" | "generator" | "settings">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<"new" | string | null>(null);
  const [generatorOverEditor, setGeneratorOverEditor] = useState(false);
  const [appliedPassword, setAppliedPassword] = useState<AppliedPassword | null>(null);
  // Bumped after every save so the details panel re-fetches notes and dates.
  const [detailsVersion, setDetailsVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<ClipboardNotice | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const remainingMs = useIdleLock(true, onLocked);
  const expireClipboard = useCallback(() => setClipboard(null), []);

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
    setClipboard(null);
    await apiLock();
    onLocked();
  }, [onLocked]);

  const showList = useCallback(() => {
    setNav("all");
    setEditing(null);
    setGeneratorOverEditor(false);
  }, []);

  const focusSearch = useCallback(() => {
    showList();
    window.setTimeout(() => {
      searchRef.current?.focus();
      searchRef.current?.select();
    }, 0);
  }, [showList]);

  const query = search.toLowerCase();
  const filtered = entries.filter(
    (entry) =>
      entry.title.toLowerCase().includes(query) ||
      entry.username.toLowerCase().includes(query) ||
      entry.url.toLowerCase().includes(query),
  );
  // "Recently changed" keeps the vault's stored order. The list payload has no dates
  // (PLAN.md: titles, usernames, and URLs only), so a true recency sort waits until
  // that metadata can be sent without a password.
  const sorted = [...filtered].sort((a, b) => {
    if (sort === "name") return a.title.localeCompare(b.title);
    return (
      entries.findIndex((entry) => entry.id === a.id) -
      entries.findIndex((entry) => entry.id === b.id)
    );
  });

  // Keep an explicit choice when it is still in the list. Otherwise show the first
  // visible login, so the details panel is filled as soon as the vault has entries.
  const selected =
    sorted.find((entry) => entry.id === selectedId) ??
    (editing === null ? (sorted[0] ?? null) : null);
  const highlightedId = editing === "new" ? null : (editing ?? selected?.id ?? null);
  const wide = (nav === "generator" || nav === "settings") && editing === null;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
      const key = e.key.toLowerCase();
      if (mod && key === "f") {
        e.preventDefault();
        focusSearch();
      } else if (mod && key === "l") {
        e.preventDefault();
        void handleLock();
      } else if (e.key === "Escape") {
        setEditing(null);
      } else if (
        (e.key === "ArrowDown" || e.key === "ArrowUp") &&
        nav === "all" &&
        editing === null &&
        !(e.target instanceof HTMLElement && e.target.closest("input, textarea, select"))
      ) {
        if (sorted.length === 0) return;
        e.preventDefault();
        const current = sorted.findIndex((entry) => entry.id === highlightedId);
        const nextIndex =
          e.key === "ArrowDown"
            ? Math.min(sorted.length - 1, current < 0 ? 0 : current + 1)
            : Math.max(0, current < 0 ? 0 : current - 1);
        const next = sorted[nextIndex];
        if (!next) return;
        selectEntry(next.id);
        window.setTimeout(() => document.getElementById(`entry-${next.id}`)?.focus(), 0);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editing, focusSearch, handleLock, highlightedId, nav, sorted]);

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

  function noticeCopy(kind: ClipboardKind) {
    setClipboard({ kind, startedAt: Date.now() });
  }

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
          <div className="absolute inset-0 z-10 overflow-y-auto bg-panel">
            <Generator
              onCopied={noticeCopy}
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
    details = <Generator onCopied={noticeCopy} />;
  } else if (selected) {
    details = (
      <EntryPanel
        key={`${selected.id}:${detailsVersion}`}
        entry={selected}
        onEdit={() => setEditing(selected.id)}
        onDelete={() => handleDelete(selected)}
        onCopied={noticeCopy}
      />
    );
  }

  return (
    <div className="flex h-screen gap-3 overflow-hidden p-3 text-text">
      <aside className="flex w-[216px] shrink-0 flex-col rounded-[20px] border border-panel-border bg-panel px-3 py-4">
        <div className="flex items-center gap-2.5 px-1 pb-4">
          <span className="brand-tile flex size-[34px] items-center justify-center rounded-[11px] text-on-accent">
            <KeyRound size={18} strokeWidth={2} aria-hidden />
          </span>
          <span className="text-[17px] font-semibold tracking-[-0.01em]">quietkeys</span>
        </div>
        <button
          type="button"
          onClick={focusSearch}
          className="mb-3 flex h-10 w-full items-center gap-2 rounded-[12px] border border-panel-border bg-field px-3 text-left text-[14px] text-text-soft"
        >
          <Search size={16} strokeWidth={2} aria-hidden />
          <span className="flex-1">Search</span>
          <Kbd>{shortcutLabel("F")}</Kbd>
        </button>
        <nav aria-label="Vault" className="flex flex-col gap-1">
          <NavItem
            icon={List}
            label="All items"
            count={entries.length}
            active={nav === "all" && !generatorOverEditor}
            onClick={() => {
              setNav("all");
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
        <button
          type="button"
          onClick={() => void handleLock()}
          aria-keyshortcuts={shortcutKeys("L")}
          className="mt-2 flex min-h-[50px] w-full items-center gap-2.5 rounded-[12px] px-3 py-2 text-left hover:bg-nav-active-bg/60"
        >
          <Lock size={17} strokeWidth={2} aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-medium">Lock vault</span>
            <span className="block text-[11.5px] text-label">{formatAutoLock(remainingMs)}</span>
          </span>
          <Kbd>{shortcutLabel("L")}</Kbd>
        </button>
      </aside>

      {wide ? (
        <main
          aria-label="Login details"
          className="min-w-0 flex-1 overflow-y-auto rounded-[20px] border border-panel-border bg-panel"
        >
          {details}
        </main>
      ) : (
        <>
          <section
            aria-label="Login list"
            className="flex w-[340px] shrink-0 flex-col rounded-[20px] border border-panel-border bg-panel"
          >
            <div className="flex gap-2.5 px-3.5 pt-4 pb-3">
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
                  className="h-11 w-full rounded-[12px] border border-panel-border bg-field pr-16 pl-10 text-[14.5px] text-text placeholder:text-muted"
                />
                <Kbd className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2">
                  {shortcutLabel("F")}
                </Kbd>
              </div>
              <button
                type="button"
                aria-label="Add login"
                onClick={startNewEntry}
                className="flex size-11 shrink-0 items-center justify-center rounded-[12px] bg-accent-gradient text-on-accent hover:opacity-95"
              >
                <Plus size={18} strokeWidth={2} aria-hidden />
              </button>
            </div>
            <div className="flex items-center justify-between px-4 pt-1 pb-2">
              <h2 className="text-[12px] font-semibold tracking-[0.06em] text-label uppercase">
                {query
                  ? `${sorted.length} ${sorted.length === 1 ? "result" : "results"}`
                  : "All logins"}
              </h2>
              <label className="flex items-center gap-2 text-[12.5px] text-muted">
                Sort
                <select
                  aria-label="Sort"
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortOrder)}
                  className="h-8 rounded-[8px] border border-panel-border bg-field px-2 text-[13px] text-text"
                >
                  <option value="changed">Recently changed</option>
                  <option value="name">Name</option>
                </select>
              </label>
            </div>
            {error && (
              <p
                role="alert"
                className="mx-3.5 mb-2 rounded-[10px] border border-error-border bg-error-bg px-3.5 py-2.5 text-[13px] text-error-fg"
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
                  className="flex h-10 items-center gap-2 rounded-[12px] bg-accent-gradient px-4 text-[14px] font-semibold text-on-accent hover:opacity-95"
                >
                  <Plus size={16} strokeWidth={2} aria-hidden />
                  Add your first login
                </button>
              </div>
            ) : sorted.length === 0 ? (
              <div className="flex flex-1 items-center justify-center px-6 pb-16 text-center">
                <p className="text-[14px] text-muted">No logins match that search.</p>
              </div>
            ) : (
              <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2.5 pb-4">
                {sorted.map((entry) => {
                  const isSelected = entry.id === highlightedId;
                  return (
                    <li key={entry.id}>
                      <button
                        type="button"
                        id={`entry-${entry.id}`}
                        onClick={() => selectEntry(entry.id)}
                        aria-current={isSelected ? "true" : undefined}
                        className={`relative flex w-full items-center gap-3 rounded-[14px] px-3 py-2.5 text-left ${
                          isSelected
                            ? "bg-row-selected-bg ring-1 ring-row-selected-ring ring-inset"
                            : "hover:bg-nav-active-bg/60"
                        }`}
                      >
                        {isSelected && (
                          <span
                            aria-hidden
                            className="absolute top-2.5 bottom-2.5 left-0 w-[3px] rounded-full bg-accent"
                          />
                        )}
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
          <main
            aria-label="Login details"
            className="min-w-0 flex-1 overflow-y-auto rounded-[20px] border border-panel-border bg-panel"
          >
            {details}
          </main>
        </>
      )}
      {clipboard && (
        <ClipboardToast
          kind={clipboard.kind}
          startedAt={clipboard.startedAt}
          onExpire={expireClipboard}
        />
      )}
    </div>
  );
}

function NavItem({
  icon: Icon,
  label,
  count,
  active = false,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  count?: number;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`flex h-[38px] w-full items-center gap-2.5 rounded-[12px] px-3 text-left text-[14px] font-medium ${
        active ? "bg-nav-active-bg text-nav-active-fg" : "text-nav-text hover:bg-nav-active-bg/60"
      }`}
    >
      <Icon size={18} strokeWidth={2} aria-hidden />
      <span className="flex-1">{label}</span>
      {count !== undefined && <span className="text-[12px] text-muted">{count}</span>}
    </button>
  );
}

function EntryPanel({
  entry,
  onEdit,
  onDelete,
  onCopied,
}: {
  entry: EntrySummary;
  onEdit: () => void;
  onDelete: () => void;
  onCopied: (kind: ClipboardKind) => void;
}) {
  const [details, setDetails] = useState<EntryDetails | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copiesSupported, setCopiesSupported] = useState(true);
  const [copyError, setCopyError] = useState<string | null>(null);
  const score = usePasswordScore(revealed ?? "");

  async function copy(which: ClipboardKind) {
    setCopyError(null);
    try {
      if (which === "username") await copyUsername(entry.id);
      else await copyPassword(entry.id);
      onCopied(which);
    } catch (err) {
      if (isApiError(err) && err.kind === "unsupported") {
        setCopiesSupported(false);
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
  const strength = score === null ? null : strengthLabel(score.score);

  return (
    <div className="flex flex-col gap-5 px-8 py-7">
      <header className="flex items-center gap-4">
        <Avatar title={entry.title} url={entry.url} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[28px] font-semibold tracking-[-0.02em]">{entry.title}</h2>
          {domain && <p className="truncate text-[14.5px] text-accent-text">{domain}</p>}
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="flex h-10 shrink-0 items-center gap-2 rounded-[12px] border border-panel-border bg-inset px-4 text-[14px] font-medium text-text hover:bg-nav-active-bg"
        >
          <Pencil size={16} strokeWidth={2} aria-hidden />
          Edit
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete login"
          className="flex size-10 shrink-0 items-center justify-center rounded-[12px] border border-danger-border bg-danger-bg text-danger-fg hover:bg-danger-bg-hover"
        >
          <Trash2 size={17} strokeWidth={2} aria-hidden />
        </button>
      </header>

      {copiesSupported && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void copy("password")}
            className="flex h-11 items-center gap-2 rounded-[12px] bg-accent-gradient px-4 text-[14.5px] font-semibold text-on-accent hover:opacity-95"
          >
            <Copy size={16} strokeWidth={2} aria-hidden />
            Copy password
          </button>
          <button
            type="button"
            onClick={() => void copy("username")}
            className="flex h-11 items-center gap-2 rounded-[12px] border border-panel-border bg-inset px-4 text-[14.5px] font-medium text-text hover:bg-nav-active-bg"
          >
            <Copy size={16} strokeWidth={2} aria-hidden />
            Copy username
          </button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <section className="rounded-[16px] border border-panel-border bg-inset px-[18px] py-4">
          <h3 className="text-[12px] font-semibold tracking-[0.06em] text-label uppercase">
            Username
          </h3>
          <p className="mt-2 text-[15px] break-words text-text">
            {entry.username || <span className="text-muted">—</span>}
          </p>
        </section>
        <section className="rounded-[16px] border border-panel-border bg-inset px-[18px] py-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[12px] font-semibold tracking-[0.06em] text-label uppercase">
              Password
            </h3>
            <button
              type="button"
              onClick={() => void toggleReveal()}
              aria-label={revealed !== null ? "Hide password" : "Show password"}
              className="text-[13px] font-medium text-accent-text"
            >
              {revealed !== null ? "Hide" : "Show"}
            </button>
          </div>
          <p
            className={`mt-2 font-mono text-[15.5px] break-all select-none ${
              revealed !== null ? "tracking-[0.02em]" : "tracking-[0.18em]"
            }`}
            onContextMenu={(e) => e.preventDefault()}
          >
            {revealed !== null ? revealed : PASSWORD_MASK}
          </p>
          {revealed !== null && <p className="mt-2 text-[12.5px] text-muted">Hides in 30s</p>}
        </section>
      </div>

      <div className="flex flex-wrap gap-2">
        {strength !== null && score !== null && (
          <span
            className={`rounded-full px-2.5 py-1 text-[12.5px] font-medium ${
              strengthIsWeak(score.score) ? "bg-warn-bg text-warn-fg" : "bg-ok-bg text-ok-fg"
            }`}
          >
            {strength}
          </span>
        )}
        {details && (
          <span className="rounded-full bg-inset px-2.5 py-1 text-[12.5px] font-medium text-muted">
            {changedLabel(details.updatedAt)}
          </span>
        )}
      </div>

      {copyError && (
        <p role="alert" className="text-[13.5px] text-error-fg">
          {copyError}
        </p>
      )}

      <section className="flex flex-col gap-2 rounded-[16px] border border-panel-border bg-inset px-[18px] py-4">
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
