// Mirrors `normalize_password` and `check_new_master_password` in
// `src-tauri/src/crypto.rs` and `src-tauri/src/vault.rs`. This is validation only, purely
// for live feedback in the Setup screen — Rust remains the sole authority, since
// `create_vault` runs the same checks itself and the encryption key never crosses to the
// frontend (PLAN.md section 3, rules 1 and 6).
//
// Order matters and must match Rust exactly: map every Unicode space separator (\p{Zs},
// e.g. a non-breaking space) to a normal space, *then* apply NFC normalization, *then*
// reject control characters (\p{Cc}), *then* check the length.

const SPACE_SEPARATORS = /\p{Zs}/gu;
const CONTROL_CHARACTER = /\p{Cc}/u;

export const MIN_MASTER_PASSWORD_CHARS = 12;

/** Counts Unicode characters (code points), matching Rust's `.chars().count()`. */
export function countChars(value: string): number {
  return [...value].length;
}

export function normalizeMasterPassword(password: string): string {
  return password.replace(SPACE_SEPARATORS, " ").normalize("NFC");
}

export type MasterPasswordCheck =
  | { ok: true }
  | {
      ok: false;
      kind: "password_has_control_character" | "password_too_short";
      message: string;
    };

export function checkNewMasterPassword(password: string): MasterPasswordCheck {
  const normalized = normalizeMasterPassword(password);
  if (CONTROL_CHARACTER.test(normalized)) {
    return {
      ok: false,
      kind: "password_has_control_character",
      message: "The master password cannot contain control characters such as tabs or line breaks",
    };
  }
  const length = countChars(normalized);
  if (length < MIN_MASTER_PASSWORD_CHARS) {
    return {
      ok: false,
      kind: "password_too_short",
      message: `The master password must be at least ${MIN_MASTER_PASSWORD_CHARS} characters long`,
    };
  }
  return { ok: true };
}

/** The same two rules as `checkNewMasterPassword`, each reported on its own. */
export function masterPasswordRules(password: string): {
  longEnough: boolean;
  noControlCharacters: boolean;
} {
  const normalized = normalizeMasterPassword(password);
  return {
    longEnough: countChars(normalized) >= MIN_MASTER_PASSWORD_CHARS,
    noControlCharacters: !CONTROL_CHARACTER.test(normalized),
  };
}
