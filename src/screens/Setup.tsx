import { useState, type FormEvent } from "react";
import { createVault, isApiError } from "../api";
import { checkNewMasterPassword } from "../masterPassword";

interface Props {
  onCreated: () => void;
}

export default function Setup({ onCreated }: Props) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = checkNewMasterPassword(password);
  const showFeedback = password.length > 0 && !check.ok;
  const mismatch = password.length > 0 && confirm.length > 0 && password !== confirm;
  const canSubmit = check.ok && confirm.length > 0 && !mismatch && !submitting;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await createVault(password);
      onCreated();
    } catch (err) {
      setError(isApiError(err) ? err.message : "Could not create the vault");
    } finally {
      // Cleared after every submit, whether it succeeded or failed (section 3.15 /
      // frontend hygiene): there is no reason to keep a typed password around longer
      // than it takes to send it.
      setPassword("");
      setConfirm("");
      setSubmitting(false);
    }
  }

  return (
    <main className="flex h-screen items-center justify-center bg-slate-900 text-slate-100">
      <form onSubmit={handleSubmit} className="w-80 space-y-4">
        <h1 className="text-xl font-semibold">Create your vault</h1>
        <div>
          <label className="mb-1 block text-sm" htmlFor="master-password">
            Master password
          </label>
          <input
            id="master-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onContextMenu={(e) => e.preventDefault()}
            className="w-full rounded bg-slate-800 px-3 py-2 select-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm" htmlFor="confirm-password">
            Confirm password
          </label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onContextMenu={(e) => e.preventDefault()}
            className="w-full rounded bg-slate-800 px-3 py-2 select-none"
          />
        </div>
        {showFeedback && <p className="text-sm text-amber-400">{check.message}</p>}
        {mismatch && <p className="text-sm text-amber-400">Passwords do not match.</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full rounded bg-sky-600 py-2 disabled:opacity-50"
        >
          {submitting ? "Creating…" : "Create vault"}
        </button>
      </form>
    </main>
  );
}
