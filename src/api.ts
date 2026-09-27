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
  | "website_not_opened"
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

export interface PassphraseOptions {
  words: number;
  separator: string;
  capitalise: boolean;
  addNumber: boolean;
}

/** A generated password or passphrase, with entropy from the options that produced it. */
export interface GeneratedSecret {
  value: string;
  bits: number;
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
  /** RFC3339 timestamp. Not a secret. */
  updatedAt?: string;
  /** Host as the url crate normalises it. Empty or omitted when the URL cannot be opened. */
  host?: string;
  favourite?: boolean;
  lastUsedAt?: string | null;
  /** Present on recently deleted rows. */
  deletedAt?: string | null;
}

export interface HistoryMeta {
  id: string;
  replacedAt: string;
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
  /** Previous passwords by id and date. The passwords themselves are not included. */
  history?: HistoryMeta[];
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

export const generatePassword = (options: PasswordOptions): Promise<GeneratedSecret> =>
  call("generate_password", { options });

export const generatePassphrase = (options: PassphraseOptions): Promise<GeneratedSecret> =>
  call("generate_passphrase", { options });

export const scorePassword = (password: string): Promise<PasswordScore> =>
  call("score_password", { password });

export const changeMasterPassword = (current: string, newPassword: string): Promise<void> =>
  call("change_master_password", { current, new: newPassword });

export const copyPassword = (id: string): Promise<void> => call("copy_password", { id });

export const copyUsername = (id: string): Promise<void> => call("copy_username", { id });

export const copyGeneratedPassword = (value: string): Promise<void> =>
  call("copy_generated_password", { value });

export const restoreFromBackup = (masterPassword: string): Promise<void> =>
  call("restore_from_backup", { masterPassword });

/** The save dialog runs in Rust. Cancel is a success and writes nothing. */
export const exportVault = (): Promise<void> => call("export_vault");

/** Clears the clipboard only when it still holds the last quietkeys copy. */
export const clearClipboard = (): Promise<void> => call("clear_clipboard");

/** Opens the entry's stored website. The UI sends the id, never a URL. */
export const openEntryWebsite = (id: string): Promise<void> => call("open_entry_website", { id });

export interface VaultInfo {
  /** Home folder shortened, so the username is not included. */
  path: string;
  /** RFC3339. Not a secret. */
  lastSaved: string;
  backup: BackupStatus;
  kdf: string;
  cipher: string;
}

export type BackupStatus =
  { status: "missing" } | { status: "healthy"; savedAt: string } | { status: "unreadable" };

export const vaultInfo = (): Promise<VaultInfo> => call("vault_info");

/** Reveals the vault file. The UI sends no path. */
export const showVaultInFolder = (): Promise<void> => call("show_vault_in_folder");

/** Opens the fixed security section of the README. The UI sends no URL. */
export const openEncryptionReadme = (): Promise<void> => call("open_encryption_readme");

export const setFavourite = (id: string, favourite: boolean): Promise<EntrySummary> =>
  call("set_favourite", { id, favourite });

export const restoreEntry = (id: string): Promise<EntrySummary> => call("restore_entry", { id });

export const deleteForever = (id: string): Promise<void> => call("delete_forever", { id });

export const listDeletedEntries = (): Promise<EntrySummary[]> => call("list_deleted_entries");

export const copyHistoryPassword = (entryId: string, historyId: string): Promise<void> =>
  call("copy_history_password", { entryId, historyId });
