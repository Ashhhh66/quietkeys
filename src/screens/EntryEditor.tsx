import { useEffect, useId, useState, type FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import {
  addEntry,
  getEntry,
  getPassword,
  isApiError,
  updateEntry,
  type EntrySummary,
} from "../api";
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
  /** Called with the saved entry after a save, or with nothing on cancel. */
  onDone: (saved?: EntrySummary) => void;
}

const REVEAL_DURATION_MS = 30_000;

const LABEL = "block text-[12px] font-semibold tracking-[0.06em] text-label uppercase";
const INPUT =
  "w-full rounded-[10px] border border-input-border bg-input-bg-field px-3 text-[15px] text-text";

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
  const passwordId = useId();
  const notesId = useId();

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
      let saved: EntrySummary;
      if (id === null) {
        saved = await addEntry({ title, username, password, url, notes });
      } else {
        saved = await updateEntry(id, {
          title,
          username,
          password: passwordTouched ? password : undefined,
          url,
          notes,
        });
      }
      onDone(saved);
    } catch (err) {
      setError(isApiError(err) ? err.message : "Could not save the entry");
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="px-10 py-8 text-[14px] text-muted">Loading…</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6 px-10 py-8">
      <h2 className="text-[26px] font-semibold tracking-[-0.015em]">
        {id === null ? "Add login" : "Edit login"}
      </h2>
      <div className="divide-y divide-card-border rounded-[14px] border border-card-border bg-card">
        <Field label="Title" value={title} max={MAX_TITLE_CHARS} onChange={setTitle} autoFocus />
        <Field label="Username" value={username} max={MAX_USERNAME_CHARS} onChange={setUsername} />
        <div className="px-5 py-4">
          <label className={`${LABEL} mb-2`} htmlFor={passwordId}>
            Password
          </label>
          <div className="flex items-center gap-2">
            <input
              id={passwordId}
              type={passwordVisible ? "text" : "password"}
              value={password}
              placeholder={id === null ? "" : "(unchanged — reveal to view or edit)"}
              onChange={(e) => {
                setPassword(e.target.value);
                setPasswordTouched(true);
              }}
              onContextMenu={(e) => e.preventDefault()}
              className={`${INPUT} h-10 font-mono select-none placeholder:font-sans placeholder:text-muted`}
            />
            <button
              type="button"
              onClick={handleReveal}
              aria-label={passwordVisible ? "Hide password" : "Show password"}
              className="flex size-10 shrink-0 items-center justify-center rounded-[10px] text-icon-button hover:bg-nav-active-bg/60"
            >
              {passwordVisible ? (
                <EyeOff size={17} strokeWidth={2} aria-hidden />
              ) : (
                <Eye size={17} strokeWidth={2} aria-hidden />
              )}
            </button>
          </div>
          <Counter value={password} max={MAX_PASSWORD_CHARS} />
        </div>
        <Field label="Website" value={url} max={MAX_URL_CHARS} onChange={setUrl} />
      </div>
      <div className="rounded-[14px] border border-card-border bg-card px-5 py-4">
        <label className={`${LABEL} mb-2`} htmlFor={notesId}>
          Notes
        </label>
        <textarea
          id={notesId}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={5}
          className={`${INPUT} py-2.5 text-[14.5px] leading-[1.55]`}
        />
        <Counter value={notes} max={MAX_NOTES_CHARS} />
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-[10px] border border-error-border bg-error-bg px-3.5 py-3 text-[13.5px] text-error-fg"
        >
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="flex h-10 items-center rounded-[10px] bg-accent px-5 text-[14px] font-semibold text-on-accent hover:bg-accent-hover disabled:bg-disabled-bg disabled:text-disabled-fg"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => onDone()}
          className="flex h-10 items-center rounded-[10px] border border-input-border bg-card px-5 text-[14px] font-medium text-text hover:bg-nav-active-bg"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  value,
  max,
  onChange,
  autoFocus = false,
}: {
  label: string;
  value: string;
  max: number;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  const id = useId();
  return (
    <div className="px-5 py-4">
      <label className={`${LABEL} mb-2`} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        className={`${INPUT} h-10`}
      />
      <Counter value={value} max={max} />
    </div>
  );
}

function Counter({ value, max }: { value: string; max: number }) {
  const count = countChars(value);
  const over = count > max;
  return (
    <p className={`mt-1.5 text-right text-[12px] ${over ? "text-error-fg" : "text-muted"}`}>
      {count}/{max}
    </p>
  );
}
