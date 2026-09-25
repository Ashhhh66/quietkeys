//! The Tauri commands: the only bridge between the UI and the vault. Each one delegates to
//! `AppState`, which applies the locked check and holds all the logic.

use secrecy::SecretString;
use tauri::State;

use crate::error::VaultError;
use crate::state::{AppState, EntryInput, EntrySummary, RevealedPassword};

type CommandResult<T> = Result<T, VaultError>;

#[tauri::command]
pub fn vault_exists(state: State<'_, AppState>) -> bool {
    state.vault_exists()
}

// `create_vault` and `unlock` run Argon2id, so they are async to keep it off the main
// (UI) thread.
#[tauri::command]
pub async fn create_vault(
    state: State<'_, AppState>,
    master_password: String,
) -> CommandResult<()> {
    state.create_vault(&SecretString::from(master_password))
}

#[tauri::command]
pub async fn unlock(state: State<'_, AppState>, master_password: String) -> CommandResult<()> {
    state.unlock(&SecretString::from(master_password))
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
pub fn add_entry(state: State<'_, AppState>, entry: EntryInput) -> CommandResult<EntrySummary> {
    state.add_entry(entry)
}

#[tauri::command]
pub fn update_entry(
    state: State<'_, AppState>,
    id: String,
    entry: EntryInput,
) -> CommandResult<EntrySummary> {
    state.update_entry(&id, entry)
}

#[tauri::command]
pub fn delete_entry(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    state.delete_entry(&id)
}
