/** "Changed 3 months ago", counted from `now` so tests can pin the clock. */
export function changedLabel(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "Changed";
  const days = Math.floor((now - then) / 86_400_000);
  if (days <= 0) return "Changed today";
  if (days === 1) return "Changed yesterday";
  if (days < 30) return `Changed ${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `Changed ${months} ${months === 1 ? "month" : "months"} ago`;
  const years = Math.floor(months / 12);
  return `Changed ${years} ${years === 1 ? "year" : "years"} ago`;
}

const STRENGTH = ["Very weak", "Weak", "Fair", "Strong", "Very strong"] as const;

export function strengthLabel(score: number): string | null {
  return STRENGTH[score] ?? null;
}

export function strengthIsWeak(score: number): boolean {
  return score <= 2;
}
