import { Check, X } from "lucide-react";
import { masterPasswordRules } from "../masterPassword";

export function passwordChecklistPasses(password: string, confirm: string): boolean {
  const rules = masterPasswordRules(password);
  return (
    rules.longEnough &&
    password.length > 0 &&
    rules.noControlCharacters &&
    confirm.length > 0 &&
    password === confirm
  );
}

export default function PasswordChecklist({
  password,
  confirm,
}: {
  password: string;
  confirm: string;
}) {
  const rules = masterPasswordRules(password);
  const passwordsMatch = confirm.length > 0 && password === confirm;
  return (
    <ul aria-label="Password requirements" className="flex flex-col gap-2 text-[13.5px]">
      <ChecklistItem met={rules.longEnough}>At least 12 characters</ChecklistItem>
      <ChecklistItem met={password.length > 0 && rules.noControlCharacters}>
        No hidden control characters
      </ChecklistItem>
      <ChecklistItem met={passwordsMatch}>Passwords match</ChecklistItem>
    </ul>
  );
}

function ChecklistItem({ met, children }: { met: boolean; children: string }) {
  return (
    <li className={`flex items-center gap-2.5 ${met ? "text-text-soft" : "text-muted"}`}>
      <span
        aria-hidden
        className={`flex size-5 shrink-0 items-center justify-center rounded-full ${
          met ? "bg-ok-bg text-ok-fg" : "bg-disabled-bg text-muted"
        }`}
      >
        {met ? <Check size={14} strokeWidth={2} /> : <X size={14} strokeWidth={2} />}
      </span>
      <span className="sr-only">{met ? "Met:" : "Not met:"}</span>
      <span>{children}</span>
    </li>
  );
}
