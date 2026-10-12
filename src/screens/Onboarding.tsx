import { useEffect, useState } from "react";
import { friendlyMessage, vaultInfo } from "../api";
import EmergencyKit from "../components/EmergencyKit";
import { PRIMARY_BUTTON } from "../components/AuthCard";

interface Props {
  onContinue: () => void;
}

/** Shown once, after a vault is created. Unlock of an existing vault skips this. */
export default function Onboarding({ onContinue }: Props) {
  const [path, setPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showKit, setShowKit] = useState(false);

  useEffect(() => {
    let cancelled = false;
    vaultInfo()
      .then((info) => {
        if (!cancelled) setPath(info.path);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(friendlyMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center overflow-y-auto p-6 text-text">
      {showKit && path ? (
        <EmergencyKit path={path} onClose={() => setShowKit(false)} />
      ) : (
        <div className="flex w-[440px] flex-col gap-5 rounded-[20px] border border-panel-border bg-panel px-9 py-10">
          <div>
            <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Your vault is ready</h1>
            <p className="mt-3 text-[15px] text-text-soft">
              If you forget the master password, this vault cannot be opened. Write it down
              somewhere only you can find. quietkeys does not store it.
            </p>
          </div>
          {error && (
            <p role="alert" className="text-[13.5px] text-error-fg">
              {error}
            </p>
          )}
          {path && (
            <p className="font-mono text-[13px] break-all text-text" aria-label="Vault file">
              {path}
            </p>
          )}
          <button
            type="button"
            onClick={() => setShowKit(true)}
            disabled={!path}
            className="h-12 rounded-[12px] border border-panel-border text-[15px] font-medium disabled:text-disabled-fg"
          >
            Emergency Kit
          </button>
          <button type="button" onClick={onContinue} className={PRIMARY_BUTTON}>
            Continue
          </button>
        </div>
      )}
    </main>
  );
}
