import { useEffect, useState } from "react";
import {
  deleteEntry,
  getPassword,
  isApiError,
  listEntries,
  lock as apiLock,
  type EntrySummary,
} from "../api";
import EntryEditor from "./EntryEditor";

interface Props {
  onLocked: () => void;
}

const REVEAL_DURATION_MS = 30_000;

export default function VaultList({ onLocked }: Props) {
  const [entries, setEntries] = useState<EntrySummary[]>([]);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<"new" | string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLock() {
    await apiLock();
    onLocked();
  }

  async function handleDelete(entry: EntrySummary) {
    if (!window.confirm(`Delete "${entry.title}"? This cannot be undone.`)) return;
    try {
      await deleteEntry(entry.id);
      await refresh();
    } catch (err) {
      setError(isApiError(err) ? err.message : "Could not delete the entry");
    }
  }

  if (editing !== null) {
    return (
      <EntryEditor
        id={editing === "new" ? null : editing}
        onDone={() => {
          setEditing(null);
          refresh();
        }}
      />
    );
  }

  const query = search.toLowerCase();
  const filtered = entries.filter(
    (entry) =>
      entry.title.toLowerCase().includes(query) ||
      entry.username.toLowerCase().includes(query) ||
      entry.url.toLowerCase().includes(query),
  );

  return (
    <main className="min-h-screen bg-slate-900 p-6 text-slate-100">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">quietkeys</h1>
        <button onClick={handleLock} className="rounded bg-slate-700 px-3 py-1 text-sm">
          Lock
        </button>
      </div>
      <div className="mb-4 flex gap-2">
        <input
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 rounded bg-slate-800 px-3 py-2"
        />
        <button onClick={() => setEditing("new")} className="rounded bg-sky-600 px-3 py-2">
          Add
        </button>
      </div>
      {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
      {filtered.length === 0 ? (
        <p className="text-sm text-slate-400">
          {entries.length === 0 ? "No entries yet." : "No entries match your search."}
        </p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((entry) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              onEdit={() => setEditing(entry.id)}
              onDelete={() => handleDelete(entry)}
            />
          ))}
        </ul>
      )}
    </main>
  );
}

function EntryRow({
  entry,
  onEdit,
  onDelete,
}: {
  entry: EntrySummary;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [revealed, setRevealed] = useState<string | null>(null);

  // Hides the password again 30 seconds after it was revealed. Locking (which unmounts
  // this whole screen) discards it immediately regardless, since this state never lives
  // anywhere but here.
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

  return (
    <li className="flex items-center justify-between rounded bg-slate-800 px-3 py-2">
      <div>
        <div className="font-medium">{entry.title}</div>
        <div className="text-sm text-slate-400">{entry.username}</div>
        <div className="select-none text-sm" onContextMenu={(e) => e.preventDefault()}>
          {revealed !== null ? revealed : "••••••••"}
        </div>
      </div>
      <div className="flex gap-3">
        <button onClick={toggleReveal} className="text-sm text-sky-400">
          {revealed !== null ? "Hide" : "Reveal"}
        </button>
        <button onClick={onEdit} className="text-sm text-sky-400">
          Edit
        </button>
        <button onClick={onDelete} className="text-sm text-red-400">
          Delete
        </button>
      </div>
    </li>
  );
}
