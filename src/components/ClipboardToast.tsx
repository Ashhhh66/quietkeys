import { useEffect, useState } from "react";

export const CLIPBOARD_CLEAR_MS = 30_000;

export type ClipboardKind = "password" | "username";

const RING_RADIUS = 14;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/**
 * Countdown for a concealed-clipboard copy. The text names what was copied
 * (password or username) and never the value itself.
 */
export default function ClipboardToast({
  kind,
  startedAt,
  onExpire,
}: {
  kind: ClipboardKind;
  startedAt: number;
  onExpire: () => void;
}) {
  const [now, setNow] = useState(startedAt);
  if (startedAt > now) setNow(startedAt);

  useEffect(() => {
    const remaining = CLIPBOARD_CLEAR_MS - (Date.now() - startedAt);
    const expire = window.setTimeout(onExpire, Math.max(0, remaining));
    const tick = window.setInterval(() => setNow(Date.now()), 250);
    return () => {
      window.clearTimeout(expire);
      window.clearInterval(tick);
    };
  }, [startedAt, onExpire]);

  const remaining = Math.max(0, CLIPBOARD_CLEAR_MS - (now - startedAt));
  const seconds = Math.ceil(remaining / 1000);
  if (seconds <= 0) return null;

  const title = kind === "password" ? "Password copied" : "Username copied";
  const offset = RING_LENGTH * (1 - remaining / CLIPBOARD_CLEAR_MS);

  return (
    <div
      role="status"
      className="clipboard-toast fixed right-3 bottom-3 z-40 flex h-[60px] max-w-[calc(100%-24px)] items-center gap-3 rounded-[16px] border border-toast-border bg-toast-bg px-3.5 text-text"
    >
      <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden className="shrink-0 text-accent">
        <circle
          cx="17"
          cy="17"
          r={RING_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.25"
          strokeWidth="3"
        />
        <circle
          cx="17"
          cy="17"
          r={RING_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={RING_LENGTH}
          strokeDashoffset={offset}
          transform="rotate(-90 17 17)"
        />
        <text
          x="17"
          y="17"
          textAnchor="middle"
          dominantBaseline="central"
          fill="currentColor"
          fontSize="11"
          className="font-sans"
        >
          {seconds}
        </text>
      </svg>
      <span className="min-w-0">
        <span className="block text-[14.5px] font-medium">{title}</span>
        <span className="block text-[12.5px] text-muted">
          Clears from clipboard in {seconds}s · not in history
        </span>
      </span>
    </div>
  );
}
