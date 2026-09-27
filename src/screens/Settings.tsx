import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { LoaderCircle, Shield } from "lucide-react";
import {
  readDensity,
  readTextSize,
  setDensity,
  setTextSize,
  type Density,
  type TextSize,
} from "../appearance";
import {
  changeMasterPassword,
  exportVault,
  friendlyMessage,
  isApiError,
  openEncryptionReadme,
  showVaultInFolder,
  vaultInfo,
  type BackupStatus,
  type VaultInfo,
} from "../api";
import {
  AUTO_LOCK_CHOICES,
  readAutoLockMinutes,
  writeAutoLockMinutes,
  type AutoLockMinutes,
} from "../autoLock";
import PasswordChecklist, { passwordChecklistPasses } from "../components/PasswordChecklist";
import StrengthMeter from "../components/StrengthMeter";
import ShortcutsDialog from "../components/ShortcutsDialog";
import ThemeSwitch from "../components/ThemeSwitch";
import { agoLabel } from "../relativeTime";

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
  const [density, setDensityChoice] = useState<Density>(readDensity);
  const [textSize, setTextSizeChoice] = useState<TextSize>(readTextSize);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [info, setInfo] = useState<VaultInfo | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [showError, setShowError] = useState<string | null>(null);

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
    vaultInfo()
      .then((value) => {
        if (!cancelled) setInfo(value);
      })
      .catch((err: unknown) => {
        if (!cancelled) setInfoError(friendlyMessage(err));
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

  async function showInFolder() {
    setShowError(null);
    try {
      await showVaultInFolder();
    } catch (err) {
      setShowError(friendlyMessage(err));
    }
  }

  async function openHowItWorks() {
    setShowError(null);
    try {
      await openEncryptionReadme();
    } catch (err) {
      setShowError(friendlyMessage(err));
    }
  }

  return (
    <div className="flex flex-col gap-6 px-10 py-8">
      <h2 className="text-[28px] font-semibold tracking-[-0.02em]">Settings</h2>

      <section className="flex max-w-[860px] flex-col gap-4 rounded-[20px] border border-ok-fg bg-ok-bg px-6 py-5">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-accent-gradient text-on-accent">
            <Shield size={18} strokeWidth={2} aria-hidden />
          </span>
          <div>
            <h3 className="text-[18px] font-semibold">Where your data lives</h3>
            <p className="mt-1 text-[14px] text-text-soft">
              Everything stays on this computer. Nothing is ever uploaded.
            </p>
          </div>
        </div>
        {infoError && (
          <p role="alert" className="text-[13.5px] text-error-fg">
            {infoError}
          </p>
        )}
        {info && (
          <div className="grid gap-3 sm:grid-cols-2">
            <InfoCell title="Vault file">
              <p className="font-mono text-[13px] break-all text-text">{info.path}</p>
              <button
                type="button"
                onClick={() => void showInFolder()}
                className="mt-2 h-8 rounded-[10px] border border-panel-border bg-panel px-3 text-[13px] font-medium text-text hover:bg-nav-active-bg"
              >
                Show in folder
              </button>
            </InfoCell>
            <InfoCell title="Last saved">
              <p className="text-[14.5px] text-text">{agoLabel(info.lastSaved)}</p>
            </InfoCell>
            <InfoCell title="Backup">
              <p className="text-[14.5px] text-text">{backupLabel(info.backup)}</p>
              <button
                type="button"
                onClick={() => void handleExport()}
                disabled={exporting}
                className="mt-2 h-8 rounded-[10px] bg-accent-gradient px-3 text-[13px] font-semibold text-on-accent hover:opacity-95 disabled:bg-disabled-bg disabled:bg-none disabled:text-disabled-fg disabled:opacity-100"
              >
                {exporting ? "Exporting…" : "Export a copy"}
              </button>
              {exportError && (
                <p role="alert" className="mt-2 text-[13.5px] text-error-fg">
                  {exportError}
                </p>
              )}
            </InfoCell>
            <InfoCell title="Encryption">
              <p className="text-[14.5px] text-text">{algorithmLabel(info.kdf, info.cipher)}</p>
              <button
                type="button"
                onClick={() => void openHowItWorks()}
                className="mt-2 h-8 rounded-[10px] border border-panel-border bg-panel px-3 text-[13px] font-medium text-accent-text hover:bg-nav-active-bg"
              >
                How it works
              </button>
            </InfoCell>
          </div>
        )}
        {showError && (
          <p role="alert" className="text-[13.5px] text-error-fg">
            {showError}
          </p>
        )}
      </section>

      <div className="grid max-w-[860px] gap-3 lg:grid-cols-2">
        <section className="flex flex-col gap-4 rounded-[16px] border border-panel-border bg-inset px-[18px] py-4">
          <h3 className="text-[16px] font-semibold">Security</h3>
          <div>
            <p className={LABEL}>Auto-lock</p>
            <div
              role="radiogroup"
              aria-label="Auto-lock"
              className="mt-2 flex rounded-[12px] border border-panel-border bg-panel p-1"
            >
              {AUTO_LOCK_CHOICES.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  role="radio"
                  aria-checked={minutes === choice}
                  onClick={() => {
                    setMinutes(choice);
                    writeAutoLockMinutes(choice);
                  }}
                  className={`h-8 flex-1 rounded-[8px] text-[13px] font-medium ${
                    minutes === choice
                      ? "bg-accent-gradient text-on-accent"
                      : "text-text-soft hover:bg-nav-active-bg"
                  }`}
                >
                  {choice}m
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 text-[14px]">
            <span>Clear clipboard</span>
            <span className="text-muted">30 seconds</span>
          </div>
          <form onSubmit={handleChange} className="flex flex-col gap-4">
            <h4 className="text-[14px] font-semibold">Master password</h4>
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
              <p
                role="status"
                className="rounded-[10px] bg-ok-bg px-3.5 py-3 text-[13.5px] text-ok-fg"
              >
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
        </section>

        <section className="flex flex-col gap-4 rounded-[16px] border border-panel-border bg-inset px-[18px] py-4">
          <h3 className="text-[16px] font-semibold">Appearance</h3>
          <div>
            <p className={LABEL}>Theme</p>
            <ThemeSwitch />
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className={LABEL}>Density</legend>
            {(
              [
                ["comfortable", "Comfortable"],
                ["compact", "Compact"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex items-center gap-2 text-[14.5px] text-text">
                <input
                  type="radio"
                  name="density"
                  checked={density === value}
                  onChange={() => {
                    setDensity(value);
                    setDensityChoice(value);
                  }}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <fieldset className="flex flex-col gap-2">
            <legend className={LABEL}>Text size</legend>
            {(
              [
                ["a", "A"],
                ["a+", "A+"],
                ["a++", "A++"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex items-center gap-2 text-[14.5px] text-text">
                <input
                  type="radio"
                  name="text-size"
                  checked={textSize === value}
                  onChange={() => {
                    setTextSize(value);
                    setTextSizeChoice(value);
                  }}
                />
                {label}
              </label>
            ))}
          </fieldset>
        </section>
      </div>

      <footer className="flex max-w-[860px] items-center justify-between gap-4">
        <p className="text-[13px] text-muted">
          <span>{version ? `Version ${version}` : "quietkeys"}</span>
          <span> · MIT</span>
        </p>
        <button
          type="button"
          onClick={() => setShortcutsOpen(true)}
          className="flex h-10 items-center rounded-[12px] border border-panel-border bg-panel px-4 text-[14px] font-medium text-text hover:bg-nav-active-bg"
        >
          Keyboard shortcuts
        </button>
      </footer>
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
    </div>
  );
}

function backupLabel(backup: BackupStatus): string {
  if (backup.status === "missing") return "No backup yet";
  if (backup.status === "unreadable") {
    return "Backup can't be opened. Your next save will replace it.";
  }
  return `Healthy · saved ${agoLabel(backup.savedAt)}`;
}

function algorithmLabel(kdf: string, cipher: string): string {
  const kdfName = kdf === "argon2id" ? "Argon2id" : kdf;
  const cipherName = cipher === "xchacha20poly1305" ? "XChaCha20-Poly1305" : cipher;
  return `${kdfName} · ${cipherName}`;
}

function InfoCell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-[14px] border border-panel-border bg-panel px-4 py-3">
      <h4 className="text-[12px] font-semibold tracking-[0.06em] text-label uppercase">{title}</h4>
      <div className="mt-2">{children}</div>
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
