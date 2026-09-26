// Mirrors MAX_*_CHARS in src-tauri/src/state.rs. Used only to show a live character
// counter in the entry editor; Rust remains the authority and rejects anything over the
// limit with a field_too_long error regardless of what the UI shows.
export const MAX_TITLE_CHARS = 256;
export const MAX_USERNAME_CHARS = 512;
export const MAX_PASSWORD_CHARS = 4096;
export const MAX_URL_CHARS = 2048;
export const MAX_NOTES_CHARS = 65536;

/** Counts Unicode characters (code points), matching Rust's `.chars().count()`. */
export function countChars(value: string): number {
  return [...value].length;
}
