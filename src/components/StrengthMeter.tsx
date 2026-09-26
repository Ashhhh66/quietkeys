import { usePasswordScore } from "../hooks/usePasswordScore";

/** Five steps, one per zxcvbn-style score from 0 through 4. */
export default function StrengthMeter({ password }: { password: string }) {
  const score = usePasswordScore(password);
  if (password.length === 0 || score === null) return null;

  const tone = score.score <= 1 ? "bg-error-fg" : score.score === 2 ? "bg-warn-fg" : "bg-ok-fg";
  const textTone =
    score.score <= 1 ? "text-error-fg" : score.score === 2 ? "text-warn-fg" : "text-ok-fg";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1" role="img" aria-label={`Password strength ${score.score} of 4`}>
        {[0, 1, 2, 3, 4].map((step) => (
          <span
            key={step}
            className={`h-1.5 flex-1 rounded-full ${step <= score.score ? tone : "bg-disabled-bg"}`}
          />
        ))}
      </div>
      {score.warning && <p className={`text-[13px] ${textTone}`}>{score.warning}</p>}
      {score.suggestions.length > 0 && (
        <ul className="flex flex-col gap-1 text-[13px] text-muted">
          {score.suggestions.map((suggestion) => (
            <li key={suggestion}>{suggestion}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
