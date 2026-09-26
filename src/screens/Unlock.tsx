import { useEffect, useState, type FormEvent } from "react";
import { isApiError, unlock } from "../api";

interface Props {
  onUnlocked: () => void;
}

export default function Unlock({ onUnlocked }: Props) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [throttleDeadline, setThrottleDeadline] = useState<number | null>(null);
  const [countdown, setCountdown] = useState(0);

  // Ticks the countdown down to zero once a Throttled error sets a deadline, without
  // depending on the clock drifting: it's always computed from the actual deadline.
  useEffect(() => {
    if (throttleDeadline === null) return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((throttleDeadline - Date.now()) / 1000));
      setCountdown(remaining);
      if (remaining <= 0) setThrottleDeadline(null);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [throttleDeadline]);

  const throttled = countdown > 0;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting || throttled) return;
    setSubmitting(true);
    setError(null);
    try {
      await unlock(password);
      onUnlocked();
    } catch (err) {
      if (isApiError(err)) {
        if (err.kind === "throttled" && err.secondsRemaining !== undefined) {
          setThrottleDeadline(Date.now() + err.secondsRemaining * 1000);
          setCountdown(err.secondsRemaining);
        }
        setError(err.message);
      } else {
        setError("Could not unlock the vault");
      }
    } finally {
      // Cleared after every submit attempt, success or failure (section 3.15).
      setPassword("");
      setSubmitting(false);
    }
  }

  return (
    <main className="flex h-screen items-center justify-center bg-slate-900 text-slate-100">
      <form onSubmit={handleSubmit} className="w-80 space-y-4">
        <h1 className="text-xl font-semibold">Unlock quietkeys</h1>
        <input
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onContextMenu={(e) => e.preventDefault()}
          className="w-full rounded bg-slate-800 px-3 py-2 select-none"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={submitting || throttled}
          className="w-full rounded bg-sky-600 py-2 disabled:opacity-50"
        >
          {throttled ? `Try again in ${countdown}s` : submitting ? "Unlocking…" : "Unlock"}
        </button>
      </form>
    </main>
  );
}
