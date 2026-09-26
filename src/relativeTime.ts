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

/** "Used today", counted from `now` so tests can pin the clock. */
export function usedLabel(iso: string, now = Date.now()): string {
  return changedLabel(iso, now).replace(/^Changed/, "Used");
}

const DAY_MS = 86_400_000;
export const DELETED_KEEP_DAYS = 30;

/** "Deleted 3 days ago". */
export function deletedAgoLabel(iso: string, now = Date.now()): string {
  return changedLabel(iso, now).replace(/^Changed/, "Deleted");
}

/** "removed forever in 27 days". */
export function deletedRemainingLabel(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "removed forever in 30 days";
  const age = Math.max(0, Math.floor((now - then) / DAY_MS));
  const left = Math.max(0, DELETED_KEEP_DAYS - age);
  return `removed forever in ${left} ${left === 1 ? "day" : "days"}`;
}

/** "Used until 12 Jun 2026". */
export function usedUntilLabel(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "Used until";
  const formatted = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(then);
  return `Used until ${formatted}`;
}

const STRENGTH = ["Very weak", "Weak", "Fair", "Strong", "Very strong"] as const;

export function strengthLabel(score: number): string | null {
  return STRENGTH[score] ?? null;
}

export function strengthIsWeak(score: number): boolean {
  return score <= 2;
}
