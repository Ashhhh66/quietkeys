import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { addEntry, getEntry, getPassword, isApiError, updateEntry } from "../api";
import {
  MAX_NOTES_CHARS,
  MAX_PASSWORD_CHARS,
  MAX_TITLE_CHARS,
  MAX_URL_CHARS,
  MAX_USERNAME_CHARS,
  countChars,
} from "../entryLimits";

interface Props {
  /** `null` adds a new entry; a string edits the entry with that id. */
  id: string | null;
  onDone: () => void;
}

const REVEAL_DURATION_MS = 30_000;

export default function EntryEditor({ id, onDone }: Props) {
  const [title, setTitle] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  // Whether the user has revealed or typed a password themselves. Only then is a
  // password actually sent on save; PLAN.md 3.8: "a password is sent only when the
  // user reveals or copies it."
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(id !== null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id === null) return;
    let cancelled = false;
    (async () => {
      try {
        const details = await getEntry(id);
        if (cancelled) return;
        setTitle(details.title);
        setUsername(details.username);
        setUrl(details.url);
        setNotes(details.notes);
      } catch (err) {
        if (!cancelled) setError(isApiError(err) ? err.message : "Could not load entry");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Re-masks the password 30 seconds after it was last revealed or edited, without
  // discarding what was typed (the user may still be mid-edit); leaving this screen
  // (Save or Cancel) unmounts it and discards the value entirely either way.
  useEffect(() => {
    if (!passwordVisible) return;
    const timer = setTimeout(() => setPasswordVisible(false), REVEAL_DURATION_MS);
    return () => clearTimeout(timer);
  }, [passwordVisible, password]);

  async function handleReveal() {
    if (passwordVisible) {
      setPasswordVisible(false);
      return;
    }
    if (id === null) {
      // Nothing to fetch for a brand-new entry: just show what's already typed.
      setPasswordVisible(true);
      return;
    }
    if (passwordTouched) {
      // Already revealed/edited once this session; no need to fetch again.
      setPasswordVisible(true);
      return;
    }
    try {
      const revealed = await getPassword(id);
      setPassword(revealed);
      setPasswordTouched(true);
      setPasswordVisible(true);
    } catch (err) {
      setError(isApiError(err) ? err.message : "Could not reveal the password");
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (id === null) {
        await addEntry({ title, username, password, url, notes });
      } else {
        await updateEntry(id, {
          title,
          username,
          password: passwordTouched ? password : undefined,
          url,
          notes,
        });
      }
      onDone();
    } catch (err) {
      setError(isApiError(err) ? err.message : "Could not save the entry");
      setSaving(false);
    }
  }

  if (loading) {
    return <Centered>Loading…</Centered>;
  }

  return (
    <main className="min-h-screen bg-slate-900 p-6 text-slate-100">
      <form onSubmit={handleSubmit} className="max-w-md space-y-4">
        <h1 className="text-xl font-semibold">{id === null ? "Add entry" : "Edit entry"}</h1>
        <Field label="Title" value={title} max={MAX_TITLE_CHARS} onChange={setTitle} />
        <Field label="Username" value={username} max={MAX_USERNAME_CHARS} onChange={setUsername} />
        <div>
          <label className="mb-1 block text-sm">Password</label>
          <div className="flex gap-2">
            <input
              type={passwordVisible ? "text" : "password"}
              value={password}
              placeholder={id === null ? "" : "(unchanged — reveal to view or edit)"}
              onChange={(e) => {
                setPassword(e.target.value);
                setPasswordTouched(true);
              }}
              onContextMenu={(e) => e.preventDefault()}
              className="flex-1 rounded bg-slate-800 px-3 py-2 select-none"
            />
            <button type="button" onClick={handleReveal} className="text-sm text-sky-400">
              {passwordVisible ? "Hide" : "Reveal"}
            </button>
          </div>
          <Counter value={password} max={MAX_PASSWORD_CHARS} />
        </div>
        <Field label="URL" value={url} max={MAX_URL_CHARS} onChange={setUrl} />
        <div>
          <label className="mb-1 block text-sm" htmlFor="notes">
            Notes
          </label>
          <textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            className="w-full rounded bg-slate-800 px-3 py-2"
          />
          <Counter value={notes} max={MAX_NOTES_CHARS} />
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded bg-sky-600 px-4 py-2 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={onDone} className="rounded bg-slate-700 px-4 py-2">
            Cancel
          </button>
        </div>
      </form>
    </main>
  );
}

function Field({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: string;
  max: number;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded bg-slate-800 px-3 py-2"
      />
      <Counter value={value} max={max} />
    </div>
  );
}

function Counter({ value, max }: { value: string; max: number }) {
  const count = countChars(value);
  const over = count > max;
  return (
    <p className={`text-xs ${over ? "text-red-400" : "text-slate-500"}`}>
      {count}/{max}
    </p>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <main className="flex h-screen items-center justify-center bg-slate-900 text-slate-100">
      {children}
    </main>
  );
}
