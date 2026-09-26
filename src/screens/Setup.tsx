import { useState, type FormEvent } from "react";
import { AlertCircle, Check, KeyRound, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { createVault, isApiError } from "../api";
import AuthCard, { ALERT, FIELD_INPUT, FIELD_LABEL, PRIMARY_BUTTON } from "../components/AuthCard";
import { checkNewMasterPassword, masterPasswordRules } from "../masterPassword";

interface Props {
  onCreated: () => void;
}

export default function Setup({ onCreated }: Props) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = checkNewMasterPassword(password);
  const rules = masterPasswordRules(password);
  const passwordsMatch = confirm.length > 0 && password === confirm;
  const canSubmit = check.ok && passwordsMatch && !submitting;

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
    <AuthCard width="wide">
      <div className="flex flex-col gap-3">
        <span className="flex size-11 items-center justify-center rounded-xl bg-accent text-on-accent">
          <KeyRound size={22} strokeWidth={2} aria-hidden />
        </span>
        <h1 className="text-[24px] font-semibold">Create your vault</h1>
        <p className="text-[14.5px] leading-normal text-muted">
          Choose a master password. It unlocks everything, so make it long and memorable.
        </p>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-[22px]">
        <div className="flex flex-col gap-2">
          <label className={FIELD_LABEL} htmlFor="master-password">
            Master password
          </label>
          <input
            id="master-password"
            type="password"
            autoComplete="new-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onContextMenu={(e) => e.preventDefault()}
            className={FIELD_INPUT}
          />
        </div>
        <div className="flex flex-col gap-2">
          <label className={FIELD_LABEL} htmlFor="confirm-password">
            Confirm master password
          </label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onContextMenu={(e) => e.preventDefault()}
            className={FIELD_INPUT}
          />
        </div>
        <ul aria-label="Password requirements" className="flex flex-col gap-2 text-[13.5px]">
          <ChecklistItem met={rules.longEnough}>At least 12 characters</ChecklistItem>
          <ChecklistItem met={password.length > 0 && rules.noControlCharacters}>
            No hidden control characters
          </ChecklistItem>
          <ChecklistItem met={passwordsMatch}>Passwords match</ChecklistItem>
        </ul>
        <p className={`${ALERT} border-warn-border bg-warn-bg text-[13px] text-warn-fg`}>
          <TriangleAlert size={16} strokeWidth={2} aria-hidden className="mt-px shrink-0" />
          There is no password reset. If you forget your master password, your vault can&apos;t be
          recovered.
        </p>
        {error && (
          <p role="alert" className={`${ALERT} border-error-border bg-error-bg text-error-fg`}>
            <AlertCircle size={16} strokeWidth={2} aria-hidden className="mt-px shrink-0" />
            {error}
          </p>
        )}
        <button type="submit" disabled={!canSubmit} className={PRIMARY_BUTTON}>
          {submitting && (
            <LoaderCircle size={18} strokeWidth={2} aria-hidden className="animate-spin" />
          )}
          {submitting ? "Creating…" : "Create vault"}
        </button>
      </form>
    </AuthCard>
  );
}

function ChecklistItem({ met, children }: { met: boolean; children: string }) {
  return (
    <li className={`flex items-center gap-2.5 ${met ? "text-text-soft" : "text-muted"}`}>
      <span
        aria-hidden
        className={`flex size-5 shrink-0 items-center justify-center rounded-full ${
          met ? "bg-ok-bg text-ok-fg" : "bg-disabled-bg text-muted"
        }`}
      >
        {met ? <Check size={14} strokeWidth={2} /> : <X size={14} strokeWidth={2} />}
      </span>
      <span className="sr-only">{met ? "Met:" : "Not met:"}</span>
      <span>{children}</span>
    </li>
  );
}
