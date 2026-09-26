import { invoke } from "@tauri-apps/api/core";

// Every type here mirrors what src-tauri/src/state.rs and error.rs actually send, using
// the same camelCase keys everywhere.

export type ApiErrorKind =
  | "decrypt_failed"
  | "unsupported_version"
  | "invalid_format"
  | "invalid_kdf_params"
  | "password_too_short"
  | "password_has_control_character"
  | "locked"
  | "entry_not_found"
  | "field_too_long"
  | "throttled"
  | "busy"
  | "already_unlocked"
  | "unsupported"
  | "invalid_generator_options"
  | "crypto"
  | "io";

export interface ApiError {
  kind: ApiErrorKind;
  message: string;
  /** Only present when `kind` is `"throttled"`. */
  secondsRemaining?: number;
}

export function isApiError(value: unknown): value is ApiError {
  return typeof value === "object" && value !== null && "kind" in value && "message" in value;
}

/** Short copy for kinds that have no screen-specific wording in DESIGN.md. */
export function friendlyMessage(err: unknown): string {
  if (!isApiError(err)) return "Something went wrong. Try again.";
  switch (err.kind) {
    case "busy":
      return "Another vault operation is already in progress. Try again in a moment.";
    case "already_unlocked":
      return "The vault is already unlocked.";
    case "unsupported":
      return "Copying isn't available on this system.";
    case "throttled": {
      const seconds = err.secondsRemaining ?? 0;
      return `Too many attempts. You can try again in ${seconds} ${seconds === 1 ? "second" : "seconds"}.`;
    }
    case "io":
      if (err.message.toLowerCase().includes("already exists")) {
        return "A file with that name already exists. Choose a different name.";
      }
      return err.message;
    default:
      return err.message;
  }
}

export interface PasswordOptions {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  digits: boolean;
  symbols: boolean;
  excludeAmbiguous: boolean;
}

export interface PasswordScore {
  score: number;
  warning: string | null;
  suggestions: string[];
}

export interface EntrySummary {
  id: string;
  title: string;
  username: string;
  url: string;
}

/** Every entry field except the password. */
export interface EntryDetails {
  id: string;
  title: string;
  username: string;
  url: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface EntryInput {
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string;
}

export interface UpdateEntryInput {
  title: string;
  username: string;
  /** `undefined` keeps the entry's existing password unchanged. */
  password?: string;
  url: string;
  notes: string;
}

type LockedListener = () => void;
let lockedListener: LockedListener | null = null;

/**
 * Registered once by App on startup. Whenever any command below comes back with kind
 * "locked" — whether because a call raced a lock, or (later) an idle auto-lock fired —
 * this fires so App can switch to the Unlock screen centrally, rather than every screen
 * having to check for it individually.
 */
export function onLocked(listener: LockedListener): void {
  lockedListener = listener;
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    if (isApiError(err) && err.kind === "locked") {
      lockedListener?.();
    }
    throw err;
  }
}

export const vaultExists = (): Promise<boolean> => call("vault_exists");

export const isUnlocked = (): Promise<boolean> => call("is_unlocked");

export const createVault = (masterPassword: string): Promise<void> =>
  call("create_vault", { masterPassword });

export const unlock = (masterPassword: string): Promise<void> => call("unlock", { masterPassword });

export const lock = (): Promise<void> => call("lock");

export const listEntries = (): Promise<EntrySummary[]> => call("list_entries");

export const getEntry = (id: string): Promise<EntryDetails> => call("get_entry", { id });

export const getPassword = (id: string): Promise<string> => call("get_password", { id });

export const addEntry = (entry: EntryInput): Promise<EntrySummary> => call("add_entry", { entry });

export const updateEntry = (id: string, entry: UpdateEntryInput): Promise<EntrySummary> =>
  call("update_entry", { id, entry });

export const deleteEntry = (id: string): Promise<void> => call("delete_entry", { id });

export const backupExists = (): Promise<boolean> => call("backup_exists");

export const generatePassword = (options: PasswordOptions): Promise<string> =>
  call("generate_password", { options });

export const scorePassword = (password: string): Promise<PasswordScore> =>
  call("score_password", { password });

export const changeMasterPassword = (current: string, newPassword: string): Promise<void> =>
  call("change_master_password", { current, new: newPassword });

export const copyPassword = (id: string): Promise<void> => call("copy_password", { id });

export const copyUsername = (id: string): Promise<void> => call("copy_username", { id });

export const restoreFromBackup = (masterPassword: string): Promise<void> =>
  call("restore_from_backup", { masterPassword });

/** The save dialog runs in Rust. Cancel is a success and writes nothing. */
export const exportVault = (): Promise<void> => call("export_vault");
