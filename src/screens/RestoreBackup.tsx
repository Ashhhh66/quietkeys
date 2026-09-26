import { useEffect, useState, type FormEvent } from "react";
import { AlertCircle, Clock, LoaderCircle } from "lucide-react";
import { friendlyMessage, isApiError, restoreFromBackup } from "../api";
import { ALERT, FIELD_INPUT, FIELD_LABEL, PRIMARY_BUTTON } from "../components/AuthCard";

interface Props {
  onRestored: () => void;
}

type Failure = { kind: "wrong_password" } | { kind: "other"; message: string };

export default function RestoreBackup({ onRestored }: Props) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [throttleDeadline, setThrottleDeadline] = useState<number | null>(null);
  const [countdown, setCountdown] = useState(0);

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

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[13.5px] font-medium text-accent-text hover:underline"
      >
        Restore from backup
      </button>
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting || throttled || password.length === 0) return;
    setSubmitting(true);
    setFailure(null);
    try {
      await restoreFromBackup(password);
      setPassword("");
      onRestored();
    } catch (err) {
      if (isApiError(err) && err.kind === "throttled" && err.secondsRemaining !== undefined) {
        setThrottleDeadline(Date.now() + err.secondsRemaining * 1000);
        setCountdown(err.secondsRemaining);
      } else if (isApiError(err) && err.kind === "decrypt_failed") {
        setFailure({ kind: "wrong_password" });
      } else {
        setFailure({ kind: "other", message: friendlyMessage(err) });
      }
    } finally {
      setPassword("");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <p className="text-[13.5px] leading-normal text-muted">
        The current vault will be moved to vault.quietkeys.pre-restore.
      </p>
      <div className="flex flex-col gap-2">
        <label className={FIELD_LABEL} htmlFor="restore-password">
          Backup password
        </label>
        <input
          id="restore-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onContextMenu={(e) => e.preventDefault()}
          className={FIELD_INPUT}
        />
      </div>
      {failure && (
        <p role="alert" className={`${ALERT} border-error-border bg-error-bg text-error-fg`}>
          <AlertCircle size={16} strokeWidth={2} aria-hidden className="mt-px shrink-0" />
          {failure.kind === "wrong_password"
            ? "Incorrect password or corrupted vault."
            : failure.message}
        </p>
      )}
      {throttled && (
        <p role="status" className={`${ALERT} border-warn-border bg-warn-bg text-warn-fg`}>
          <Clock size={16} strokeWidth={2} aria-hidden className="mt-px shrink-0" />
          Too many attempts. You can try again in {countdown}{" "}
          {countdown === 1 ? "second" : "seconds"}.
        </p>
      )}
      <button type="submit" disabled={submitting || throttled} className={PRIMARY_BUTTON}>
        {submitting && (
          <LoaderCircle size={18} strokeWidth={2} aria-hidden className="animate-spin" />
        )}
        {submitting ? "Restoring…" : "Restore"}
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setPassword("");
          setFailure(null);
        }}
        className="text-[13.5px] font-medium text-muted hover:text-text"
      >
        Cancel
      </button>
    </form>
  );
}
