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
