import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Clock,
  Copy,
  ExternalLink,
  HeartPulse,
  KeyRound,
  List,
  Lock,
  Pencil,
  Plus,
  Search,
  Settings,
  Sparkles,
  Star,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import {
  clearClipboard,
  copyHistoryPassword,
  copyPassword,
  copyUsername,
  deleteEntry,
  deleteForever,
  listDeletedEntries,
  friendlyMessage,
  getEntry,
  getPassword,
  isApiError,
  listEntries,
  lock as apiLock,
  openEntryWebsite,
  vaultHealth,
  restoreEntry,
  setFavourite,
  type EntryDetails,
  type EntrySummary,
  type VaultHealth,
} from "../api";
import Avatar from "../components/Avatar";
import ClipboardToast, { type ClipboardKind } from "../components/ClipboardToast";
import CommandPalette from "../components/CommandPalette";
import Kbd, { shortcutKeys, shortcutLabel } from "../components/Kbd";
import { formatAutoLock, useIdleLock } from "../hooks/useIdleLock";
import {
  changedLabel,
  deletedAgoLabel,
  deletedRemainingLabel,
  usedLabel,
  usedUntilLabel,
} from "../relativeTime";
import EntryEditor, { type AppliedPassword } from "./EntryEditor";
import Generator from "./Generator";
import HealthScreen, { loginFlags } from "./Health";
import SettingsScreen from "./Settings";

interface Props {
  onLocked: () => void;
}

const REVEAL_DURATION_MS = 30_000;
const PASSWORD_MASK = "•".repeat(12);

type SortOrder = "used" | "added" | "name" | "changed";
type VaultNav = "all" | "favourites" | "recent" | "generator" | "health" | "settings" | "deleted";
type ClipboardNotice = { kind: ClipboardKind; startedAt: number };
type UndoNotice = { id: string; title: string; startedAt: number };

const UNDO_MS = 10_000;

function clockNow(): number {
  return Date.now();
}

function hasTextSelection(target: EventTarget | null): boolean {
  if (
    (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) &&
    target.selectionStart !== null &&
    target.selectionEnd !== null &&
    target.selectionStart !== target.selectionEnd
  ) {
    return true;
  }
  const selection = window.getSelection();
  return selection !== null && !selection.isCollapsed && selection.toString().length > 0;
}

export default function VaultList({ onLocked }: Props) {
  const [entries, setEntries] = useState<EntrySummary[]>([]);
  const [health, setHealth] = useState<VaultHealth | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortOrder>("used");
  const [nav, setNav] = useState<VaultNav>("all");
  const [undo, setUndo] = useState<UndoNotice | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<"new" | string | null>(null);
  const [generatorOverEditor, setGeneratorOverEditor] = useState(false);
  const [appliedPassword, setAppliedPassword] = useState<AppliedPassword | null>(null);
  // Bumped after every save so the details panel re-fetches notes and dates.
  const [detailsVersion, setDetailsVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<ClipboardNotice | null>(null);
  const [clearError, setClearError] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const remainingMs = useIdleLock(true, onLocked);
  const expireClipboard = useCallback(() => setClipboard(null), []);

  async function refresh() {
    try {
      setEntries(await listEntries());
    } catch (err) {
      setError(isApiError(err) ? err.message : "Could not load entries");
    }
    try {
      setHealth(await vaultHealth());
    } catch (err) {
      setError(isApiError(err) ? err.message : "Could not check vault health");
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
      }
      try {
        const report = await vaultHealth();
        if (!cancelled) setHealth(report);
      } catch (err) {
        if (!cancelled) setError(isApiError(err) ? err.message : "Could not check vault health");
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
  // "Date added" keeps the vault's stored order. Equal timestamps keep that order.
  // "Recently used" is the default; logins that have never been copied sort last.
  const storedOrder = (a: EntrySummary, b: EntrySummary) =>
    entries.findIndex((entry) => entry.id === a.id) -
    entries.findIndex((entry) => entry.id === b.id);
  const sorted = [...filtered].sort((a, b) => {
    if (nav === "recent" || sort === "used") {
      const aUsed = a.lastUsedAt ?? "";
      const bUsed = b.lastUsedAt ?? "";
      if (aUsed !== bUsed) return bUsed.localeCompare(aUsed);
    } else if (sort === "name") {
      return a.title.localeCompare(b.title);
    } else if (sort === "changed") {
      const byDate = (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
      if (byDate !== 0) return byDate;
    }
    return storedOrder(a, b);
  });
  const visible =
    nav === "favourites"
      ? sorted.filter((entry) => entry.favourite)
      : nav === "recent"
        ? sorted.filter((entry) => entry.lastUsedAt)
        : sorted;
  const favouriteRows = nav === "all" && !query ? visible.filter((entry) => entry.favourite) : [];
  const otherRows = nav === "all" && !query ? visible.filter((entry) => !entry.favourite) : visible;

  // Keep an explicit choice when it is still in the list. Otherwise show the first
  // visible login, so the details panel is filled as soon as the vault has entries.
  const selected =
    visible.find((entry) => entry.id === selectedId) ??
    (editing === null && nav !== "deleted" ? (visible[0] ?? null) : null);
  const highlightedId = editing === "new" ? null : (editing ?? selected?.id ?? null);
  const wide =
    (nav === "generator" || nav === "health" || nav === "settings" || nav === "deleted") &&
    editing === null;

  function selectEntry(id: string) {
    setSelectedId(id);
    setEditing(null);
    setGeneratorOverEditor(false);
    setNav((current) =>
      current === "generator" || current === "health" || current === "settings" ? "all" : current,
    );
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
      const key = e.key.toLowerCase();
      // A text selection, including one outside a field, must copy normally.
      if (mod && (key === "c" || key === "b") && hasTextSelection(e.target)) return;
      const inField =
        e.target instanceof HTMLElement && Boolean(e.target.closest("input, textarea, select"));
      if (inField && e.key !== "Escape") return;
      if (paletteOpen) return;
      if (mod && key === "f") {
        e.preventDefault();
        focusSearch();
      } else if (mod && key === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (mod && key === "l") {
        e.preventDefault();
        void handleLock();
      } else if (mod && key === "g") {
        e.preventDefault();
        if (editing !== null) setGeneratorOverEditor(true);
        else {
          setNav("generator");
          setEditing(null);
        }
      } else if (mod && key === "n") {
        e.preventDefault();
        setEditing("new");
        setGeneratorOverEditor(false);
        setNav((current) =>
          current === "generator" || current === "health" || current === "settings"
            ? "all"
            : current,
        );
      } else if (
        mod &&
        (key === "c" || key === "b") &&
        (nav === "all" || nav === "favourites" || nav === "recent") &&
        editing === null &&
        highlightedId
      ) {
        e.preventDefault();
        const copy = key === "c" ? copyPassword : copyUsername;
        const kind: ClipboardKind = key === "c" ? "password" : "username";
        void copy(highlightedId)
          .then(() => {
            setClearError(null);
            setClipboard({ kind, startedAt: Date.now() });
          })
          .catch((err) => setError(friendlyMessage(err)));
      } else if (e.key === "Escape") {
        setEditing(null);
      } else if (
        (e.key === "ArrowDown" || e.key === "ArrowUp") &&
        (nav === "all" || nav === "favourites" || nav === "recent") &&
        editing === null &&
        !(e.target instanceof HTMLElement && e.target.closest("input, textarea, select"))
      ) {
        if (visible.length === 0) return;
        e.preventDefault();
        const current = visible.findIndex((entry) => entry.id === highlightedId);
        const nextIndex =
          e.key === "ArrowDown"
            ? Math.min(visible.length - 1, current < 0 ? 0 : current + 1)
            : Math.max(0, current < 0 ? 0 : current - 1);
        const next = visible[nextIndex];
        if (!next) return;
        selectEntry(next.id);
        window.setTimeout(() => document.getElementById(`entry-${next.id}`)?.focus(), 0);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editing, focusSearch, handleLock, highlightedId, nav, paletteOpen, visible]);

  async function handleDelete(entry: EntrySummary) {
    try {
      await deleteEntry(entry.id);
      setSelectedId((current) => (current === entry.id ? null : current));
      setUndo({ id: entry.id, title: entry.title, startedAt: clockNow() });
      await refresh();
    } catch (err) {
      setError(isApiError(err) ? err.message : "Could not delete the entry");
    }
  }

  async function toggleFavourite(entry: EntrySummary) {
    const next = !entry.favourite;
    try {
      await setFavourite(entry.id, next);
      setEntries((current) =>
        current.map((item) => (item.id === entry.id ? { ...item, favourite: next } : item)),
      );
    } catch (err) {
      setError(friendlyMessage(err));
    }
  }

  async function undoDelete() {
    if (!undo) return;
    try {
      await restoreEntry(undo.id);
      setUndo(null);
      setNav("all");
      await refresh();
    } catch (err) {
      setError(friendlyMessage(err));
    }
  }

  function startNewEntry() {
    setEditing("new");
    setGeneratorOverEditor(false);
    setNav((current) =>
      current === "generator" || current === "health" || current === "settings" ? "all" : current,
    );
  }

  function noticeCopy(kind: ClipboardKind) {
    setClearError(null);
    setClipboard({ kind, startedAt: Date.now() });
  }

  async function copyFromPalette(id: string, kind: ClipboardKind) {
    try {
      if (kind === "username") await copyUsername(id);
      else await copyPassword(id);
      noticeCopy(kind);
      setPaletteOpen(false);
    } catch (err) {
      setError(friendlyMessage(err));
    }
  }

  async function clearNow() {
    try {
      await clearClipboard();
      setClearError(null);
      setClipboard(null);
    } catch (err) {
      setClearError(friendlyMessage(err));
    }
  }

  function openPalette() {
    setPaletteOpen(true);
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
  } else if (nav === "health") {
    details = health ? (
      <HealthScreen
        health={health}
        onGenerate={(id) => {
          setSelectedId(id);
          setEditing(id);
          setNav("all");
          setGeneratorOverEditor(true);
        }}
        onOpen={openEntryWebsite}
      />
    ) : (
      <p className="px-10 py-8 text-[14.5px] text-muted">Checking passwords…</p>
    );
  } else if (nav === "generator") {
    details = (
      <Generator
        onCopied={noticeCopy}
        onSaveAsLogin={(text) => {
          setAppliedPassword({ text, nonce: clockNow() });
          setEditing("new");
          setNav("all");
          setGeneratorOverEditor(false);
        }}
      />
    );
  } else if (nav === "deleted") {
    details = <DeletedScreen onChanged={() => void refresh()} />;
  } else if (selected) {
    details = (
      <EntryPanel
        key={`${selected.id}:${detailsVersion}`}
        entry={selected}
        health={health}
        onEdit={() => setEditing(selected.id)}
        onDelete={() => handleDelete(selected)}
        onCopied={noticeCopy}
        onFavourite={() => void toggleFavourite(selected)}
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
          onClick={openPalette}
          aria-keyshortcuts={shortcutKeys("K")}
          className="mb-3 flex h-10 w-full items-center gap-2 rounded-[12px] border border-panel-border bg-field px-3 text-left text-[14px] text-text-soft"
        >
          <Search size={16} strokeWidth={2} aria-hidden />
          <span className="flex-1">Search</span>
          <Kbd>{shortcutLabel("K")}</Kbd>
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
            icon={Star}
            label="Favourites"
            count={entries.filter((entry) => entry.favourite).length}
            active={nav === "favourites"}
            onClick={() => {
              setNav("favourites");
              setEditing(null);
              setGeneratorOverEditor(false);
            }}
          />
          <NavItem
            icon={Clock}
            label="Recently used"
            active={nav === "recent"}
            onClick={() => {
              setNav("recent");
              setEditing(null);
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
            icon={HeartPulse}
            label="Health"
            count={health ? health.issues.length : undefined}
            active={nav === "health"}
            onClick={() => {
              setNav("health");
              setEditing(null);
              setGeneratorOverEditor(false);
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
          <NavItem
            icon={Trash2}
            label="Recently deleted"
            active={nav === "deleted"}
            onClick={() => {
              setNav("deleted");
              setEditing(null);
              setGeneratorOverEditor(false);
            }}
          />
        </nav>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => void handleLock()}
          aria-label="Lock vault"
          aria-describedby="auto-lock-countdown"
          aria-keyshortcuts={shortcutKeys("L")}
          className="mt-2 flex min-h-[50px] w-full items-center gap-2.5 rounded-[12px] px-3 py-2 text-left hover:bg-nav-active-bg/60"
        >
          <Lock size={17} strokeWidth={2} aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-medium">Lock vault</span>
            <span id="auto-lock-countdown" className="block text-[11.5px] text-label">
              {formatAutoLock(remainingMs)}
            </span>
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
                  ? `${visible.length} ${visible.length === 1 ? "result" : "results"}`
                  : nav === "favourites"
                    ? "Favourites"
                    : nav === "recent"
                      ? "Recently used"
                      : "All logins"}
              </h2>
              {nav !== "recent" && (
                <label className="flex items-center gap-2 text-[12.5px] text-muted">
                  Sort
                  <select
                    aria-label="Sort"
                    value={sort}
                    onChange={(e) => setSort(e.target.value as SortOrder)}
                    className="h-8 rounded-[8px] border border-panel-border bg-field px-2 text-[13px] text-text"
                  >
                    <option value="used">Recently used</option>
                    <option value="name">Name</option>
                    <option value="changed">Recently changed</option>
                    <option value="added">Date added</option>
                  </select>
                </label>
              )}
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
            ) : visible.length === 0 ? (
              <div className="flex flex-1 items-center justify-center px-6 pb-16 text-center">
                <p className="text-[14px] text-muted">
                  {query
                    ? "No logins match that search."
                    : nav === "favourites"
                      ? "No favourites yet."
                      : "No recently used logins."}
                </p>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2.5 pb-4">
                {favouriteRows.length > 0 && (
                  <>
                    <h3 className="flex items-center gap-1.5 px-2 pt-1 text-[12px] font-semibold tracking-[0.06em] text-label uppercase">
                      <Star size={12} strokeWidth={2} aria-hidden />
                      Favourites
                    </h3>
                    <ul aria-label="Favourites" className="flex flex-col gap-1">
                      {favouriteRows.map((entry) => (
                        <LoginRow
                          key={entry.id}
                          entry={entry}
                          selected={entry.id === highlightedId}
                          onSelect={selectEntry}
                        />
                      ))}
                    </ul>
                  </>
                )}
                <ul className="flex flex-col gap-1">
                  {otherRows.map((entry) => {
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
                          {entry.lastUsedAt && (
                            <span className="shrink-0 text-[12px] text-muted">
                              {usedLabel(entry.lastUsedAt)}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
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
      {undo && (
        <UndoToast
          title={undo.title}
          startedAt={undo.startedAt}
          stacked={clipboard !== null}
          onUndo={() => void undoDelete()}
          onExpire={() => setUndo((current) => (current?.id === undo.id ? null : current))}
        />
      )}
      {clipboard && (
        <ClipboardToast
          kind={clipboard.kind}
          startedAt={clipboard.startedAt}
          onExpire={expireClipboard}
          onClear={() => void clearNow()}
          clearError={clearError}
        />
      )}
      {paletteOpen && (
        <CommandPalette
          entries={entries}
          onCopyPassword={(id) => void copyFromPalette(id, "password")}
          onCopyUsername={(id) => void copyFromPalette(id, "username")}
          onGenerate={() => {
            setPaletteOpen(false);
            if (editing !== null) setGeneratorOverEditor(true);
            else {
              setNav("generator");
              setEditing(null);
            }
          }}
          onAdd={() => {
            setPaletteOpen(false);
            startNewEntry();
          }}
          onLock={() => {
            setPaletteOpen(false);
            void handleLock();
          }}
          onClose={() => setPaletteOpen(false)}
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
  health,
  onEdit,
  onDelete,
  onCopied,
  onFavourite,
}: {
  entry: EntrySummary;
  health: VaultHealth | null;
  onEdit: () => void;
  onDelete: () => void;
  onCopied: (kind: ClipboardKind) => void;
  onFavourite: () => void;
}) {
  const [details, setDetails] = useState<EntryDetails | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copiesSupported, setCopiesSupported] = useState(true);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

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

  const host = entry.host ?? "";
  const flags = health ? loginFlags(health, entry.id) : null;

  async function openSite() {
    setOpenError(null);
    try {
      await openEntryWebsite(entry.id);
    } catch (err) {
      setOpenError(friendlyMessage(err));
    }
  }

  return (
    <div className="flex flex-col gap-5 px-8 py-7">
      <header className="flex items-center gap-4">
        <Avatar title={entry.title} url={entry.url} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[28px] font-semibold tracking-[-0.02em]">{entry.title}</h2>
          {host && (
            <button
              type="button"
              onClick={() => void openSite()}
              className="flex max-w-full items-center gap-1 truncate text-[14.5px] text-accent-text"
            >
              <span className="truncate">{host}</span>
              <ExternalLink size={14} strokeWidth={2} aria-hidden />
            </button>
          )}
          {openError && (
            <p role="alert" className="text-[13px] text-error-fg">
              {openError}
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label={entry.favourite ? "Remove from favourites" : "Add to favourites"}
          aria-pressed={entry.favourite === true}
          onClick={onFavourite}
          className={`flex size-10 shrink-0 items-center justify-center rounded-[12px] border border-panel-border bg-inset hover:bg-nav-active-bg ${
            entry.favourite ? "text-warn-fg" : "text-muted"
          }`}
        >
          <Star
            size={17}
            strokeWidth={2}
            fill={entry.favourite ? "currentColor" : "none"}
            aria-hidden
          />
        </button>
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
            aria-label="Copy password"
            aria-keyshortcuts={shortcutKeys("C")}
            onClick={() => void copy("password")}
            className="flex h-11 items-center gap-2 rounded-[12px] bg-accent-gradient px-4 text-[14.5px] font-semibold text-on-accent hover:opacity-95"
          >
            <Copy size={16} strokeWidth={2} aria-hidden />
            Copy password
            <Kbd className="border-on-accent/30 text-on-accent">{shortcutLabel("C")}</Kbd>
          </button>
          <button
            type="button"
            aria-label="Copy username"
            aria-keyshortcuts={shortcutKeys("B")}
            onClick={() => void copy("username")}
            className="flex h-11 items-center gap-2 rounded-[12px] border border-panel-border bg-inset px-4 text-[14.5px] font-medium text-text hover:bg-nav-active-bg"
          >
            <Copy size={16} strokeWidth={2} aria-hidden />
            Copy username
            <Kbd>{shortcutLabel("B")}</Kbd>
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
        {flags?.weak && (
          <span className="rounded-full bg-warn-bg px-2.5 py-1 text-[12.5px] font-medium text-warn-fg">
            Weak
          </span>
        )}
        {flags?.reused && (
          <span className="rounded-full bg-warn-bg px-2.5 py-1 text-[12.5px] font-medium text-warn-fg">
            Reused
          </span>
        )}
        {flags && !flags.weak && !flags.reused && (
          <span className="rounded-full bg-ok-bg px-2.5 py-1 text-[12.5px] font-medium text-ok-fg">
            Strong
          </span>
        )}
        {details && (
          <span className="rounded-full bg-inset px-2.5 py-1 text-[12.5px] font-medium text-muted">
            {changedLabel(details.updatedAt)}
          </span>
        )}
        {entry.lastUsedAt && (
          <span className="rounded-full bg-inset px-2.5 py-1 text-[12.5px] font-medium text-muted">
            {usedLabel(entry.lastUsedAt)}
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

      {(details?.history?.length ?? 0) > 0 && (
        <section className="rounded-[16px] border border-panel-border bg-inset px-[18px] py-4">
          <button
            type="button"
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen((open) => !open)}
            className="flex w-full items-center justify-between text-left"
          >
            <span className="text-[12px] font-semibold tracking-[0.06em] text-label uppercase">
              Password history
            </span>
            <span className="text-[13px] text-muted">{details?.history?.length} previous</span>
          </button>
          {historyOpen && (
            <ul className="mt-3 flex flex-col gap-2">
              {details?.history?.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-3 rounded-[12px] border border-panel-border px-3 py-2"
                >
                  <span>
                    <span className="block font-mono text-[14px] tracking-[0.18em] select-none">
                      {PASSWORD_MASK}
                    </span>
                    <span className="text-[12px] text-muted">
                      {usedUntilLabel(item.replacedAt)}
                    </span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Copy previous password ${usedUntilLabel(item.replacedAt)}`}
                    onClick={() => {
                      void copyHistoryPassword(entry.id, item.id)
                        .then(() => onCopied("password"))
                        .catch((err) => setCopyError(friendlyMessage(err)));
                    }}
                    className="flex h-8 items-center gap-1.5 rounded-[10px] border border-panel-border px-2.5 text-[13px] font-medium text-text hover:bg-nav-active-bg"
                  >
                    <Copy size={14} strokeWidth={2} aria-hidden />
                    Copy
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
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

function LoginRow({
  entry,
  selected,
  onSelect,
}: {
  entry: EntrySummary;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        id={`entry-${entry.id}`}
        onClick={() => onSelect(entry.id)}
        aria-current={selected ? "true" : undefined}
        className={`relative flex w-full items-center gap-3 rounded-[14px] px-3 py-2.5 text-left ${
          selected
            ? "bg-row-selected-bg ring-1 ring-row-selected-ring ring-inset"
            : "hover:bg-nav-active-bg/60"
        }`}
      >
        {selected && (
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
          <span className="block truncate text-[13px] text-muted">{entry.username}</span>
        </span>
        {entry.lastUsedAt && (
          <span className="shrink-0 text-[12px] text-muted">{usedLabel(entry.lastUsedAt)}</span>
        )}
      </button>
    </li>
  );
}

function DeletedScreen({ onChanged }: { onChanged: () => void }) {
  const [rows, setRows] = useState<EntrySummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setRows(await listDeletedEntries());
      setError(null);
    } catch (err) {
      setError(friendlyMessage(err));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await listDeletedEntries();
        if (!cancelled) setRows(result);
      } catch (err) {
        if (!cancelled) setError(friendlyMessage(err));
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function restore(row: EntrySummary) {
    try {
      await restoreEntry(row.id);
      await reload();
      onChanged();
    } catch (err) {
      setError(friendlyMessage(err));
    }
  }

  async function removeForever(row: EntrySummary) {
    if (!window.confirm(`Delete "${row.title}" forever? This cannot be undone.`)) return;
    try {
      await deleteForever(row.id);
      await reload();
    } catch (err) {
      setError(friendlyMessage(err));
    }
  }

  return (
    <div className="flex h-full flex-col px-8 py-7">
      <h2 className="text-[22px] font-semibold tracking-[-0.02em]">Recently deleted</h2>
      <p className="mt-2 max-w-[52ch] text-[14px] text-text-soft">
        Deleted logins are kept for 30 days, still encrypted, then removed.
      </p>
      {error && (
        <p role="alert" className="mt-4 text-[13.5px] text-error-fg">
          {error}
        </p>
      )}
      {!loaded ? null : rows.length === 0 ? (
        <p className="mt-8 text-[14px] text-muted">Nothing in Recently deleted.</p>
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex items-center gap-3 rounded-[14px] border border-panel-border px-3 py-2.5"
            >
              <Avatar title={row.title} url={row.url} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14.5px] font-semibold">{row.title}</span>
                <span className="block text-[12.5px] text-muted">
                  {row.deletedAt
                    ? `${deletedAgoLabel(row.deletedAt)} · ${deletedRemainingLabel(row.deletedAt)}`
                    : "Deleted"}
                </span>
              </span>
              <button
                type="button"
                onClick={() => void restore(row)}
                className="h-9 rounded-[10px] border border-panel-border px-3 text-[13px] font-medium hover:bg-nav-active-bg"
              >
                Restore
              </button>
              <button
                type="button"
                onClick={() => void removeForever(row)}
                className="h-9 rounded-[10px] border border-danger-border bg-danger-bg px-3 text-[13px] font-medium text-danger-fg hover:bg-danger-bg-hover"
              >
                Delete forever
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UndoToast({
  title,
  startedAt,
  stacked,
  onUndo,
  onExpire,
}: {
  title: string;
  startedAt: number;
  stacked: boolean;
  onUndo: () => void;
  onExpire: () => void;
}) {
  useEffect(() => {
    const remaining = UNDO_MS - (Date.now() - startedAt);
    const timer = window.setTimeout(onExpire, Math.max(0, remaining));
    return () => window.clearTimeout(timer);
  }, [startedAt, onExpire]);

  return (
    <div
      role="status"
      className={`fixed right-3 z-40 flex min-h-[52px] max-w-[calc(100%-24px)] items-center gap-3 rounded-[16px] border border-toast-border bg-toast-bg px-3.5 py-2 text-text ${
        stacked ? "bottom-20" : "bottom-3"
      }`}
    >
      <p className="text-[14px]">
        Deleted <span className="font-semibold">{title}</span>
      </p>
      <button
        type="button"
        onClick={onUndo}
        className="h-8 rounded-[10px] bg-accent-gradient px-3 text-[13px] font-semibold text-on-accent"
      >
        Undo
      </button>
    </div>
  );
}
