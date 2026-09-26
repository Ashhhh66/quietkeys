import { useCallback, useEffect, useState } from "react";
import { Copy, RefreshCw } from "lucide-react";
import {
  clearClipboard,
  copyGeneratedPassword,
  friendlyMessage,
  generatePassword,
  isApiError,
  type PasswordOptions,
} from "../api";
import ClipboardToast, { type ClipboardKind } from "../components/ClipboardToast";
import StrengthMeter from "../components/StrengthMeter";

const DEFAULT_OPTIONS: PasswordOptions = {
  length: 20,
  uppercase: true,
  lowercase: true,
  digits: true,
  symbols: true,
  excludeAmbiguous: false,
};

interface Props {
  /** Writes the password into the editor and closes this panel. */
  onUse?: (password: string) => void;
  onClose?: () => void;
  /** When set, the parent shows the clipboard toast. Otherwise this screen shows it. */
  onCopied?: (kind: ClipboardKind) => void;
}

export default function Generator({ onUse, onClose, onCopied }: Props) {
  const [options, setOptions] = useState<PasswordOptions>(DEFAULT_OPTIONS);
  const [password, setPassword] = useState("");
  const [working, setWorking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiesSupported, setCopiesSupported] = useState(true);
  const [copiedAt, setCopiedAt] = useState<number | null>(null);
  const [clearError, setClearError] = useState<string | null>(null);
  const expireCopy = useCallback(() => setCopiedAt(null), []);

  useEffect(() => {
    let cancelled = false;
    generatePassword(DEFAULT_OPTIONS)
      .then((value) => {
        if (!cancelled) setPassword(value);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(friendlyMessage(err));
      })
      .finally(() => {
        if (!cancelled) setWorking(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function regenerate() {
    setWorking(true);
    setError(null);
    try {
      setPassword(await generatePassword(options));
    } catch (err) {
      setError(friendlyMessage(err));
    } finally {
      setWorking(false);
    }
  }

  function patch(partial: Partial<PasswordOptions>) {
    setOptions((current) => ({ ...current, ...partial }));
  }

  async function copy() {
    try {
      await copyGeneratedPassword(password);
      setClearError(null);
      if (onCopied) onCopied("password");
      else setCopiedAt(Date.now());
    } catch (err) {
      if (isApiError(err) && err.kind === "unsupported") {
        setCopiesSupported(false);
        setCopiedAt(null);
        return;
      }
      setError(friendlyMessage(err));
    }
  }

  async function clearNow() {
    try {
      await clearClipboard();
      setClearError(null);
      setCopiedAt(null);
    } catch (err) {
      setClearError(friendlyMessage(err));
    }
  }

  return (
    <div className="flex flex-col gap-6 px-10 py-8">
      <header className="flex items-center justify-between gap-4">
        <h2 className="text-[28px] font-semibold tracking-[-0.02em]">Generator</h2>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 items-center rounded-[12px] border border-panel-border bg-panel px-4 text-[14px] font-medium text-text hover:bg-nav-active-bg"
          >
            Close
          </button>
        )}
      </header>
      <div className="flex max-w-[640px] flex-col gap-5 rounded-[16px] border border-panel-border bg-inset px-[18px] py-4">
        <p
          className="font-mono text-[15.5px] break-all select-none"
          onContextMenu={(e) => e.preventDefault()}
        >
          {password || (working ? "Generating…" : "—")}
        </p>
        <StrengthMeter password={password} />
        <label className="flex flex-col gap-2 text-[13.5px] text-text-soft">
          <span className="flex items-center justify-between">
            Length
            <span className="font-mono text-text">{options.length}</span>
          </span>
          <input
            type="range"
            min={8}
            max={128}
            aria-label="Length"
            value={options.length}
            onChange={(e) => patch({ length: Number(e.target.value) })}
          />
        </label>
        <div className="flex flex-col gap-2 text-[14px]">
          <Toggle
            label="Uppercase"
            checked={options.uppercase}
            onChange={(uppercase) => patch({ uppercase })}
          />
          <Toggle
            label="Lowercase"
            checked={options.lowercase}
            onChange={(lowercase) => patch({ lowercase })}
          />
          <Toggle
            label="Digits"
            checked={options.digits}
            onChange={(digits) => patch({ digits })}
          />
          <Toggle
            label="Symbols"
            checked={options.symbols}
            onChange={(symbols) => patch({ symbols })}
          />
          <Toggle
            label="Exclude ambiguous characters"
            checked={options.excludeAmbiguous}
            onChange={(excludeAmbiguous) => patch({ excludeAmbiguous })}
          />
        </div>
        {error && (
          <p
            role="alert"
            className="rounded-[10px] border border-error-border bg-error-bg px-3.5 py-3 text-[13.5px] text-error-fg"
          >
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {copiesSupported && (
            <button
              type="button"
              aria-label="Copy password"
              disabled={password.length === 0}
              onClick={() => void copy()}
              className="flex h-11 items-center gap-2 rounded-[12px] bg-accent-gradient px-4 text-[14.5px] font-semibold text-on-accent hover:opacity-95 disabled:bg-disabled-bg disabled:bg-none disabled:text-disabled-fg disabled:opacity-100"
            >
              <Copy size={16} strokeWidth={2} aria-hidden />
              Copy
            </button>
          )}
          <button
            type="button"
            onClick={() => void regenerate()}
            disabled={working}
            className="flex h-11 items-center gap-2 rounded-[12px] border border-panel-border bg-panel px-4 text-[14.5px] font-medium text-text hover:bg-nav-active-bg disabled:bg-disabled-bg disabled:text-disabled-fg"
          >
            <RefreshCw size={16} strokeWidth={2} aria-hidden />
            Regenerate
          </button>
          {onUse && (
            <button
              type="button"
              disabled={password.length === 0}
              onClick={() => onUse(password)}
              className="flex h-11 items-center rounded-[12px] border border-panel-border bg-panel px-4 text-[14.5px] font-medium text-text hover:bg-nav-active-bg disabled:text-disabled-fg"
            >
              Use this password
            </button>
          )}
        </div>
      </div>
      {copiedAt !== null && onCopied === undefined && (
        <ClipboardToast
          kind="password"
          startedAt={copiedAt}
          onExpire={expireCopy}
          onClear={() => void clearNow()}
          clearError={clearError}
        />
      )}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex h-10 items-center justify-between gap-3">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 accent-accent"
      />
    </label>
  );
}
