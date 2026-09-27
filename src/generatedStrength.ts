export type GeneratedLabel = "Fair" | "Strong" | "Very strong";

/** Under 50 Fair, 50–69 Strong, 70 and above Very strong. */
export function generatedStrength(bits: number): { label: GeneratedLabel; filled: number } {
  if (bits < 50) return { label: "Fair", filled: 3 };
  if (bits < 70) return { label: "Strong", filled: 4 };
  return { label: "Very strong", filled: 5 };
}
