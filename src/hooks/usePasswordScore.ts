import { useEffect, useState } from "react";
import { scorePassword, type PasswordScore } from "../api";

export const SCORE_DEBOUNCE_MS = 400;

/** Scores `password` 400ms after it stops changing. An empty value scores nothing. */
export function usePasswordScore(password: string): PasswordScore | null {
  const [score, setScore] = useState<PasswordScore | null>(null);

  useEffect(() => {
    if (password.length === 0) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      scorePassword(password)
        .then((result) => {
          if (!cancelled) setScore(result);
        })
        .catch(() => {
          if (!cancelled) setScore(null);
        });
    }, SCORE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [password]);

  if (password.length === 0) return null;
  return score;
}
