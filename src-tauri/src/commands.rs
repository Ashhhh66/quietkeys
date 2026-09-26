//! The Tauri commands: the only bridge between the UI and the vault. Each one delegates to
//! `AppState`, which applies the locked check and holds all the logic.

use secrecy::SecretString;
use tauri::{AppHandle, Manager, State};

use crate::error::VaultError;
use crate::state::{
    AppState, EntryDetails, EntryInput, EntrySummary, RevealedPassword, UpdateEntryInput,
};

type CommandResult<T> = Result<T, VaultError>;

#[tauri::command]
pub fn vault_exists(state: State<'_, AppState>) -> bool {
    state.vault_exists()
}

#[tauri::command]
pub fn is_unlocked(state: State<'_, AppState>) -> bool {
    state.is_unlocked()
}

// `create_vault` and `unlock` run Argon2id, which is slow on purpose (that's the point of
// a key-derivation function) and would otherwise freeze the window. `spawn_blocking` runs
// it on a background thread; `AppHandle` (unlike `State`) can move into that thread's
// `'static` closure, and `app.state()` fetches the same `AppState` from inside it.
#[tauri::command]
pub async fn create_vault(app: AppHandle, master_password: String) -> CommandResult<()> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<AppState>()
            .create_vault(&SecretString::from(master_password))
    })
    .await
    .map_err(|_| VaultError::Crypto)?
}

#[tauri::command]
pub async fn unlock(app: AppHandle, master_password: String) -> CommandResult<()> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<AppState>()
            .unlock(&SecretString::from(master_password))
    })
    .await
    .map_err(|_| VaultError::Crypto)?
}

#[tauri::command]
pub fn lock(state: State<'_, AppState>) {
    state.lock();
}

#[tauri::command]
pub fn list_entries(state: State<'_, AppState>) -> CommandResult<Vec<EntrySummary>> {
    state.list_entries()
}

#[tauri::command]
pub fn get_password(state: State<'_, AppState>, id: String) -> CommandResult<RevealedPassword> {
    state.get_password(&id)
}

#[tauri::command]
pub fn get_entry(state: State<'_, AppState>, id: String) -> CommandResult<EntryDetails> {
    state.get_entry(&id)
}

#[tauri::command]
pub fn add_entry(state: State<'_, AppState>, entry: EntryInput) -> CommandResult<EntrySummary> {
    state.add_entry(entry)
}

#[tauri::command]
pub fn update_entry(
    state: State<'_, AppState>,
    id: String,
    entry: UpdateEntryInput,
) -> CommandResult<EntrySummary> {
    state.update_entry(&id, entry)
}

#[tauri::command]
pub fn delete_entry(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    state.delete_entry(&id)
}
