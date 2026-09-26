import { useCallback, useEffect, useState } from "react";
import { Copy, RefreshCw } from "lucide-react";
import {
  clearClipboard,
  copyGeneratedPassword,
  friendlyMessage,
  generatePassphrase,
  generatePassword,
  isApiError,
  type PassphraseOptions,
  type PasswordOptions,
} from "../api";
import ClipboardToast, { type ClipboardKind } from "../components/ClipboardToast";
import { generatedStrength } from "../generatedStrength";

const DEFAULT_PASSWORD: PasswordOptions = {
  length: 20,
  uppercase: true,
  lowercase: true,
  digits: true,
  symbols: true,
  excludeAmbiguous: false,
};

const DEFAULT_PASSPHRASE: PassphraseOptions = {
  words: 5,
  separator: "-",
  capitalise: true,
  addNumber: true,
};

const SEPARATORS = [
  { value: "-", label: "-", name: "Hyphen" },
  { value: ".", label: ".", name: "Dot" },
  { value: "_", label: "_", name: "Underscore" },
  { value: " ", label: "space", name: "Space" },
] as const;

type Mode = "password" | "passphrase";

interface Shown {
  value: string;
  bits: number;
  mode: Mode;
  separator: string;
  numbered: boolean;
}

interface Props {
  /** Writes the value into the editor that is already open. */
  onUse?: (password: string) => void;
  /** Opens a new login with this value filled in as the password. */
  onSaveAsLogin?: (password: string) => void;
  onClose?: () => void;
  /** When set, the parent shows the clipboard toast. Otherwise this screen shows it. */
  onCopied?: (kind: ClipboardKind) => void;
}

export default function Generator({ onUse, onSaveAsLogin, onClose, onCopied }: Props) {
  const [mode, setMode] = useState<Mode>("password");
  const [passwordOptions, setPasswordOptions] = useState<PasswordOptions>(DEFAULT_PASSWORD);
  const [passphraseOptions, setPassphraseOptions] = useState<PassphraseOptions>(DEFAULT_PASSPHRASE);
  const [generation, setGeneration] = useState(0);
  const [shown, setShown] = useState<Shown | null>(null);
  const [working, setWorking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiesSupported, setCopiesSupported] = useState(true);
  const [copiedAt, setCopiedAt] = useState<number | null>(null);
  const [clearError, setClearError] = useState<string | null>(null);
  const expireCopy = useCallback(() => setCopiedAt(null), []);

  useEffect(() => {
    let cancelled = false;
    const pending =
      mode === "password"
        ? generatePassword(passwordOptions)
        : generatePassphrase(passphraseOptions);
    pending
      .then((result) => {
        if (cancelled) return;
        setShown({
          value: result.value,
          bits: result.bits,
          mode,
          separator: passphraseOptions.separator,
          numbered: passphraseOptions.addNumber,
        });
        setError(null);
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
  }, [mode, passwordOptions, passphraseOptions, generation]);

  function patchPassword(partial: Partial<PasswordOptions>) {
    setWorking(true);
    setPasswordOptions((current) => ({ ...current, ...partial }));
  }

  function patchPassphrase(partial: Partial<PassphraseOptions>) {
    setWorking(true);
    setPassphraseOptions((current) => ({ ...current, ...partial }));
  }

  function chooseMode(next: Mode) {
    setWorking(true);
    setMode(next);
  }

  function regenerate() {
    setWorking(true);
    setGeneration((current) => current + 1);
  }

  async function copy() {
    if (!shown) return;
    try {
      await copyGeneratedPassword(shown.value);
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

  const strength = shown ? generatedStrength(shown.bits) : null;

  return (
    <div className="flex flex-col gap-6 px-10 py-8">
      <header className="flex items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <h2 className="text-[28px] font-semibold tracking-[-0.02em]">Generator</h2>
          <div
            role="radiogroup"
            aria-label="Generator type"
            className="flex rounded-[12px] border border-panel-border bg-inset p-1"
          >
            {(
              [
                ["password", "Password"],
                ["passphrase", "Passphrase"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                onClick={() => chooseMode(value)}
                className={`h-9 rounded-[9px] px-3.5 text-[14px] font-medium ${
                  mode === value
                    ? "bg-accent-gradient text-on-accent"
                    : "text-text-soft hover:bg-nav-active-bg"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
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
      <div className="flex max-w-[720px] flex-col gap-5 rounded-[16px] border border-panel-border bg-inset px-[18px] py-4">
        <p
          className="font-mono text-[30px] leading-tight break-all whitespace-pre-wrap select-none"
          onContextMenu={(e) => e.preventDefault()}
        >
          {shown ? (
            shown.mode === "passphrase" ? (
              <PassphraseText
                value={shown.value}
                separator={shown.separator}
                numbered={shown.numbered}
              />
            ) : (
              shown.value
            )
          ) : working ? (
            "Generating…"
          ) : (
            "—"
          )}
        </p>
        {strength && shown && (
          <div className="flex flex-col gap-2">
            <div
              className="flex gap-1"
              role="img"
              aria-label={`${shown.bits.toFixed(1)} bits, ${strength.label}`}
            >
              {[0, 1, 2, 3, 4].map((step) => (
                <span
                  key={step}
                  className={`h-1.5 flex-1 rounded-full ${
                    step < strength.filled
                      ? strength.label === "Fair"
                        ? "bg-warn-fg"
                        : "bg-ok-fg"
                      : "bg-disabled-bg"
                  }`}
                />
              ))}
            </div>
            <p
              className={`text-[13.5px] font-medium ${
                strength.label === "Fair" ? "text-warn-fg" : "text-ok-fg"
              }`}
            >
              {shown.bits.toFixed(1)} bits · {strength.label}
            </p>
          </div>
        )}
        {mode === "password" ? (
          <>
            <label className="flex flex-col gap-2 text-[13.5px] text-text-soft">
              <span className="flex items-center justify-between">
                Length
                <span className="font-mono text-text">{passwordOptions.length}</span>
              </span>
              <input
                type="range"
                min={8}
                max={128}
                aria-label="Length"
                value={passwordOptions.length}
                onChange={(e) => patchPassword({ length: Number(e.target.value) })}
              />
            </label>
            <div className="flex flex-col gap-2 text-[14px]">
              <Toggle
                label="Uppercase"
                checked={passwordOptions.uppercase}
                onChange={(uppercase) => patchPassword({ uppercase })}
              />
              <Toggle
                label="Lowercase"
                checked={passwordOptions.lowercase}
                onChange={(lowercase) => patchPassword({ lowercase })}
              />
              <Toggle
                label="Digits"
                checked={passwordOptions.digits}
                onChange={(digits) => patchPassword({ digits })}
              />
              <Toggle
                label="Symbols"
                checked={passwordOptions.symbols}
                onChange={(symbols) => patchPassword({ symbols })}
              />
              <Toggle
                label="Exclude ambiguous characters"
                checked={passwordOptions.excludeAmbiguous}
                onChange={(excludeAmbiguous) => patchPassword({ excludeAmbiguous })}
              />
            </div>
          </>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <section className="rounded-[14px] border border-panel-border bg-panel px-4 py-3">
                <label className="flex flex-col gap-2 text-[13.5px] text-text-soft">
                  <span className="flex items-center justify-between">
                    Words
                    <span className="font-mono text-text">{passphraseOptions.words}</span>
                  </span>
                  <input
                    type="range"
                    min={3}
                    max={10}
                    aria-label="Words"
                    value={passphraseOptions.words}
                    onChange={(e) => patchPassphrase({ words: Number(e.target.value) })}
                  />
                </label>
              </section>
              <section className="rounded-[14px] border border-panel-border bg-panel px-4 py-3">
                <p className="text-[13.5px] text-text-soft">Separator</p>
                <div className="mt-2 flex gap-1.5" role="radiogroup" aria-label="Separator">
                  {SEPARATORS.map((item) => (
                    <button
                      key={item.name}
                      type="button"
                      role="radio"
                      aria-checked={passphraseOptions.separator === item.value}
                      aria-label={item.name}
                      onClick={() => patchPassphrase({ separator: item.value })}
                      className={`h-8 min-w-8 rounded-[8px] px-2 font-mono text-[14px] ${
                        passphraseOptions.separator === item.value
                          ? "bg-accent-gradient text-on-accent"
                          : "border border-panel-border text-text hover:bg-nav-active-bg"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </section>
              <Toggle
                boxed
                label="Capitalise the first word"
                checked={passphraseOptions.capitalise}
                onChange={(capitalise) => patchPassphrase({ capitalise })}
              />
              <Toggle
                boxed
                label="Add a number"
                checked={passphraseOptions.addNumber}
                onChange={(addNumber) => patchPassphrase({ addNumber })}
              />
            </div>
            <p className="rounded-[12px] bg-ok-bg px-4 py-3 text-[14px] text-ok-fg">
              Passphrases make great master passwords: long, strong, and something you can actually
              type.
            </p>
          </>
        )}
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
              disabled={!shown}
              onClick={() => void copy()}
              className="flex h-11 items-center gap-2 rounded-[12px] bg-accent-gradient px-4 text-[14.5px] font-semibold text-on-accent hover:opacity-95 disabled:bg-disabled-bg disabled:bg-none disabled:text-disabled-fg disabled:opacity-100"
            >
              <Copy size={16} strokeWidth={2} aria-hidden />
              Copy
            </button>
          )}
          <button
            type="button"
            onClick={regenerate}
            disabled={working}
            className="flex h-11 items-center gap-2 rounded-[12px] border border-panel-border bg-panel px-4 text-[14.5px] font-medium text-text hover:bg-nav-active-bg disabled:bg-disabled-bg disabled:text-disabled-fg"
          >
            <RefreshCw size={16} strokeWidth={2} aria-hidden />
            Regenerate
          </button>
          {onUse && (
            <button
              type="button"
              disabled={!shown}
              onClick={() => shown && onUse(shown.value)}
              className="flex h-11 items-center rounded-[12px] border border-panel-border bg-panel px-4 text-[14.5px] font-medium text-text hover:bg-nav-active-bg disabled:text-disabled-fg"
            >
              Use this password
            </button>
          )}
          {onSaveAsLogin && (
            <button
              type="button"
              disabled={!shown}
              onClick={() => shown && onSaveAsLogin(shown.value)}
              className="flex h-11 items-center rounded-[12px] border border-panel-border bg-panel px-4 text-[14.5px] font-medium text-text hover:bg-nav-active-bg disabled:text-disabled-fg"
            >
              Save as new login
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

function PassphraseText({
  value,
  separator,
  numbered,
}: {
  value: string;
  separator: string;
  numbered: boolean;
}) {
  const parts = value.split(separator);
  return (
    <>
      {parts.map((part, index) => {
        const isNumber = numbered && index === parts.length - 1;
        return (
          <span key={`${index}-${part}`}>
            {index > 0 && <span className="text-accent">{separator}</span>}
            <span className={isNumber ? "text-warn-fg" : undefined}>{part}</span>
          </span>
        );
      })}
    </>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  boxed = false,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  boxed?: boolean;
}) {
  return (
    <label
      className={`flex h-10 items-center justify-between gap-3 text-[14px] ${
        boxed ? "rounded-[14px] border border-panel-border bg-panel px-4" : ""
      }`}
    >
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
