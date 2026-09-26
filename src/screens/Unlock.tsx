import { useEffect, useState, type FormEvent } from "react";
import { AlertCircle, Clock, LoaderCircle, Lock, ShieldCheck } from "lucide-react";
import { isApiError, unlock } from "../api";
import AuthCard, { ALERT, FIELD_INPUT, FIELD_LABEL, PRIMARY_BUTTON } from "../components/AuthCard";

interface Props {
  onUnlocked: () => void;
}

type Failure = { kind: "wrong_password" } | { kind: "other"; message: string };

export default function Unlock({ onUnlocked }: Props) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
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
    setFailure(null);
    try {
      await unlock(password);
      onUnlocked();
    } catch (err) {
      if (isApiError(err)) {
        if (err.kind === "throttled" && err.secondsRemaining !== undefined) {
          setThrottleDeadline(Date.now() + err.secondsRemaining * 1000);
          setCountdown(err.secondsRemaining);
        } else if (err.kind === "decrypt_failed") {
          setFailure({ kind: "wrong_password" });
        } else {
          setFailure({ kind: "other", message: err.message });
        }
      } else {
        setFailure({ kind: "other", message: "Could not unlock the vault" });
      }
    } finally {
      // Cleared after every submit attempt, success or failure (section 3.15).
      setPassword("");
      setSubmitting(false);
    }
  }

  return (
    <AuthCard width="narrow">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-accent text-on-accent">
          <Lock size={26} strokeWidth={2} aria-hidden />
        </span>
        <h1 className="text-[24px] font-semibold">quietkeys</h1>
        <p className="text-[14.5px] text-muted">Enter your master password to unlock your vault.</p>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-[22px]">
        <div className="flex flex-col gap-2">
          <label className={FIELD_LABEL} htmlFor="unlock-password">
            Master password
          </label>
          <input
            id="unlock-password"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            aria-invalid={failure?.kind === "wrong_password" ? true : undefined}
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
          {throttled ? (
            `Try again in ${countdown}s`
          ) : submitting ? (
            <>
              <LoaderCircle size={18} strokeWidth={2} aria-hidden className="animate-spin" />
              <span className="sr-only">Unlocking…</span>
            </>
          ) : (
            "Unlock"
          )}
        </button>
      </form>
      <p className="flex items-center justify-center gap-1.5 text-[12.5px] text-label">
        <ShieldCheck size={13} strokeWidth={2} aria-hidden />
        Your vault never leaves this computer.
      </p>
    </AuthCard>
  );
}
