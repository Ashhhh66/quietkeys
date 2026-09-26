import { useEffect, useRef, useState } from "react";
import { lock } from "../api";
import { readAutoLockMinutes } from "../autoLock";

/** How often the last-activity timestamp is compared with the timeout. */
export const IDLE_CHECK_MS = 5_000;

const MOVE_THROTTLE_MS = 1_000;
const DISPLAY_TICK_MS = 1_000;

/** "Auto-locks in 4:12" from a remaining duration. */
export function formatAutoLock(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `Auto-locks in ${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Locks the vault after the configured idle time. The timestamp is what gets stored, and
 * a check every few seconds picks up a clock jump (waking from sleep) on the next tick.
 * The returned milliseconds update every second for the lock button's countdown.
 */
export function useIdleLock(enabled: boolean, onIdle: () => void): number {
  const onIdleRef = useRef(onIdle);
  const [remainingMs, setRemainingMs] = useState(() => readAutoLockMinutes() * 60_000);

  useEffect(() => {
    onIdleRef.current = onIdle;
  }, [onIdle]);

  useEffect(() => {
    if (!enabled) return;
    let lastActivity = Date.now();
    let lastMove = 0;
    let locking = false;

    const publish = () => {
      const timeoutMs = readAutoLockMinutes() * 60_000;
      setRemainingMs(Math.max(0, timeoutMs - (Date.now() - lastActivity)));
    };
    const mark = () => {
      lastActivity = Date.now();
      publish();
    };
    const onMouseMove = () => {
      const now = Date.now();
      if (now - lastMove < MOVE_THROTTLE_MS) return;
      lastMove = now;
      mark();
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mousedown", mark);
    window.addEventListener("keydown", mark);
    window.addEventListener("wheel", mark);
    window.addEventListener("touchstart", mark);
    window.addEventListener("focus", mark);

    const display = window.setInterval(publish, DISPLAY_TICK_MS);
    const timer = window.setInterval(() => {
      if (locking) return;
      const timeoutMs = readAutoLockMinutes() * 60_000;
      if (Date.now() - lastActivity < timeoutMs) return;
      locking = true;
      void lock().finally(() => onIdleRef.current());
    }, IDLE_CHECK_MS);

    return () => {
      window.clearInterval(display);
      window.clearInterval(timer);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mousedown", mark);
      window.removeEventListener("keydown", mark);
      window.removeEventListener("wheel", mark);
      window.removeEventListener("touchstart", mark);
      window.removeEventListener("focus", mark);
    };
  }, [enabled]);

  return remainingMs;
}
