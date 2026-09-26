//! The Tauri commands: the only bridge between the UI and the vault. Each one delegates to
//! `AppState`, which applies the locked check and holds all the logic.

use secrecy::SecretString;
use tauri::{AppHandle, Manager, State};

use crate::error::VaultError;
use crate::generator::{self, PasswordOptions, PasswordScore};
use crate::state::{
    AppState, EntryDetails, EntryInput, EntrySummary, RevealedPassword, UpdateEntryInput,
};

type CommandResult<T> = Result<T, VaultError>;

#[tauri::command]
pub fn vault_exists(state: State<'_, AppState>) -> bool {
    state.vault_exists()
}

#[tauri::command]
pub fn backup_exists(state: State<'_, AppState>) -> bool {
    state.backup_exists()
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

/// Works while the vault is locked. The generated password is returned to the UI; that is
/// the point of this command.
#[tauri::command]
pub fn generate_password(options: PasswordOptions) -> CommandResult<String> {
    Ok(generator::generate_password(&options)?.to_string())
}

/// Works while the vault is locked.
#[tauri::command]
pub fn score_password(password: String) -> PasswordScore {
    generator::score_password(&password)
}

#[tauri::command]
pub async fn change_master_password(
    app: AppHandle,
    current: String,
    new: String,
) -> CommandResult<()> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<AppState>()
            .change_master_password(&SecretString::from(current), &SecretString::from(new))
    })
    .await
    .map_err(|_| VaultError::Crypto)?
}

#[tauri::command]
pub fn copy_password(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    state.copy_password(&id)
}

#[tauri::command]
pub fn copy_username(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    state.copy_username(&id)
}

#[tauri::command]
pub async fn restore_from_backup(app: AppHandle, master_password: String) -> CommandResult<()> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<AppState>()
            .restore_from_backup(&SecretString::from(master_password))
    })
    .await
    .map_err(|_| VaultError::Crypto)?
}

/// Opens the native save dialog in Rust. Cancel returns without writing. The UI never
/// chooses the path.
#[tauri::command]
pub async fn export_vault(app: AppHandle) -> CommandResult<()> {
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .set_title("Export vault")
        .set_file_name(suggested_export_name())
        .save_file(move |path| {
            let _ = tx.send(path);
        });
    let picked = tauri::async_runtime::spawn_blocking(move || rx.recv())
        .await
        .map_err(|_| VaultError::Crypto)?
        .map_err(|_| VaultError::Crypto)?;
    let Some(file) = picked else {
        return Ok(());
    };
    let path = file
        .into_path()
        .map_err(|_| VaultError::Io(std::io::ErrorKind::InvalidInput))?;
    app.state::<AppState>().export_vault(&path)
}

fn suggested_export_name() -> String {
    let now = time::OffsetDateTime::now_utc();
    format!(
        "quietkeys-backup-{:04}-{:02}-{:02}.quietkeys",
        now.year(),
        u8::from(now.month()),
        now.day()
    )
}
