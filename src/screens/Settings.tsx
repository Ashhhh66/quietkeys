import { useEffect, useState, type FormEvent } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { LoaderCircle } from "lucide-react";
import { changeMasterPassword, exportVault, friendlyMessage, isApiError } from "../api";
import {
  AUTO_LOCK_CHOICES,
  readAutoLockMinutes,
  writeAutoLockMinutes,
  type AutoLockMinutes,
} from "../autoLock";
import PasswordChecklist, { passwordChecklistPasses } from "../components/PasswordChecklist";
import StrengthMeter from "../components/StrengthMeter";
import ThemeSwitch from "../components/ThemeSwitch";

const LABEL = "block text-[12px] font-semibold tracking-[0.06em] text-label uppercase";
const INPUT =
  "h-10 w-full rounded-[10px] border border-input-border bg-input-bg-field px-3 text-[15px] text-text";

export default function Settings() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [minutes, setMinutes] = useState<AutoLockMinutes>(readAutoLockMinutes);
  const [version, setVersion] = useState("");
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const canChange = passwordChecklistPasses(next, confirm) && current.length > 0 && !submitting;

  useEffect(() => {
    let cancelled = false;
    getVersion()
      .then((value) => {
        if (!cancelled) setVersion(value);
      })
      .catch(() => {
        if (!cancelled) setVersion("");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleChange(e: FormEvent) {
    e.preventDefault();
    if (!canChange) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      await changeMasterPassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      setSuccess(
        "Master password changed. Backups you exported earlier still open with your old password.",
      );
    } catch (err) {
      if (isApiError(err) && err.kind === "decrypt_failed") {
        setError("Incorrect password or corrupted vault.");
      } else {
        setError(friendlyMessage(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    setExportError(null);
    try {
      await exportVault();
    } catch (err) {
      setExportError(friendlyMessage(err));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 px-10 py-8">
      <h2 className="text-[28px] font-semibold tracking-[-0.02em]">Settings</h2>

      <form
        onSubmit={handleChange}
        className="flex max-w-[640px] flex-col gap-4 rounded-[16px] border border-panel-border bg-inset px-[18px] py-4"
      >
        <h3 className="text-[16px] font-semibold">Change master password</h3>
        <Field
          id="current-master-password"
          label="Current password"
          value={current}
          autoComplete="current-password"
          onChange={setCurrent}
        />
        <Field
          id="new-master-password"
          label="New password"
          value={next}
          autoComplete="new-password"
          onChange={setNext}
        />
        <StrengthMeter password={next} />
        <Field
          id="confirm-master-password"
          label="Confirm new password"
          value={confirm}
          autoComplete="new-password"
          onChange={setConfirm}
        />
        <PasswordChecklist password={next} confirm={confirm} />
        {error && (
          <p
            role="alert"
            className="rounded-[10px] border border-error-border bg-error-bg px-3.5 py-3 text-[13.5px] text-error-fg"
          >
            {error}
          </p>
        )}
        {success && (
          <p role="status" className="rounded-[10px] bg-ok-bg px-3.5 py-3 text-[13.5px] text-ok-fg">
            {success}
          </p>
        )}
        <button
          type="submit"
          disabled={!canChange}
          className="flex h-10 items-center justify-center gap-2 rounded-[12px] bg-accent-gradient text-[14px] font-semibold text-on-accent hover:opacity-95 disabled:bg-disabled-bg disabled:bg-none disabled:text-disabled-fg disabled:opacity-100"
        >
          {submitting && (
            <LoaderCircle size={18} strokeWidth={2} aria-hidden className="animate-spin" />
          )}
          {submitting ? "Changing…" : "Change master password"}
        </button>
      </form>

      <section className="flex max-w-[640px] flex-col gap-3 rounded-[16px] border border-panel-border bg-inset px-[18px] py-4">
        <h3 className="text-[16px] font-semibold">Auto-lock</h3>
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">Lock after</legend>
          {AUTO_LOCK_CHOICES.map((choice) => (
            <label key={choice} className="flex h-10 items-center gap-3 text-[14px]">
              <input
                type="radio"
                name="auto-lock"
                checked={minutes === choice}
                onChange={() => {
                  setMinutes(choice);
                  writeAutoLockMinutes(choice);
                }}
              />
              {choice} {choice === 1 ? "minute" : "minutes"}
            </label>
          ))}
        </fieldset>
      </section>

      <section className="max-w-[640px] rounded-[16px] border border-panel-border bg-inset px-[18px] py-4">
        <h3 className="mb-2 text-[16px] font-semibold">Theme</h3>
        <ThemeSwitch />
      </section>

      <section className="flex max-w-[640px] flex-col gap-3 rounded-[16px] border border-panel-border bg-inset px-[18px] py-4">
        <h3 className="text-[16px] font-semibold">Export backup</h3>
        <button
          type="button"
          onClick={() => void handleExport()}
          disabled={exporting}
          className="flex h-10 w-fit items-center rounded-[12px] bg-accent-gradient px-4 text-[14px] font-semibold text-on-accent hover:opacity-95 disabled:bg-disabled-bg disabled:bg-none disabled:text-disabled-fg disabled:opacity-100"
        >
          {exporting ? "Exporting…" : "Export backup"}
        </button>
        {exportError && (
          <p role="alert" className="text-[13.5px] text-error-fg">
            {exportError}
          </p>
        )}
      </section>

      {version && <p className="text-[13px] text-muted">Version {version}</p>}
    </div>
  );
}

function Field({
  id,
  label,
  value,
  autoComplete,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  autoComplete: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className={LABEL} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="password"
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onContextMenu={(e) => e.preventDefault()}
        className={INPUT}
      />
    </div>
  );
}
