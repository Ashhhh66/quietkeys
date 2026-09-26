import { useEffect, useRef } from "react";
import { lock } from "../api";
import { readAutoLockMinutes } from "../autoLock";

/** How often the last-activity timestamp is compared with the timeout. */
export const IDLE_CHECK_MS = 5_000;

const MOVE_THROTTLE_MS = 1_000;

/**
 * Locks the vault after the configured idle time. The timestamp is what gets stored, and
 * a check every few seconds picks up a clock jump (waking from sleep) on the next tick.
 */
export function useIdleLock(enabled: boolean, onIdle: () => void): void {
  const onIdleRef = useRef(onIdle);

  useEffect(() => {
    onIdleRef.current = onIdle;
  }, [onIdle]);

  useEffect(() => {
    if (!enabled) return;
    let lastActivity = Date.now();
    let lastMove = 0;
    let locking = false;

    const mark = () => {
      lastActivity = Date.now();
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

    const timer = window.setInterval(() => {
      if (locking) return;
      const timeoutMs = readAutoLockMinutes() * 60_000;
      if (Date.now() - lastActivity < timeoutMs) return;
      locking = true;
      void lock().finally(() => onIdleRef.current());
    }, IDLE_CHECK_MS);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mousedown", mark);
      window.removeEventListener("keydown", mark);
      window.removeEventListener("wheel", mark);
      window.removeEventListener("touchstart", mark);
      window.removeEventListener("focus", mark);
    };
  }, [enabled]);
}
