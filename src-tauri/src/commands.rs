//! The Tauri commands: the only bridge between the UI and the vault. Each one delegates to
//! `AppState`, which applies the locked check and holds all the logic.

use secrecy::SecretString;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

use crate::error::VaultError;
use crate::generator::{self, GeneratedSecret, PassphraseOptions, PasswordOptions, PasswordScore};
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
pub fn generate_password(options: PasswordOptions) -> CommandResult<GeneratedSecret> {
    let bits = generator::password_entropy_bits(&options)?;
    let value = generator::generate_password(&options)?.to_string();
    Ok(GeneratedSecret { value, bits })
}

/// Works while the vault is locked. The passphrase is returned to the UI.
#[tauri::command]
pub fn generate_passphrase(options: PassphraseOptions) -> CommandResult<GeneratedSecret> {
    generator::generate_passphrase(&options)
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
pub fn copy_generated_password(state: State<'_, AppState>, value: String) -> CommandResult<()> {
    state.copy_generated_password(value)
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
        .set_file_name(suggested_export_name(time::OffsetDateTime::now_utc()))
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

/// Clears the clipboard when its change counter still matches the last quietkeys copy.
#[tauri::command]
pub fn clear_clipboard(state: State<'_, AppState>) -> CommandResult<()> {
    state.clear_clipboard()
}

/// Opens the entry's stored website. The UI sends the entry id, never a URL.
/// The opener plugin is called from here; the webview has no opener permission.
#[tauri::command]
pub fn open_entry_website(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<()> {
    let url = state.entry_website_url(&id)?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|_| VaultError::WebsiteNotOpened)?;
    Ok(())
}

#[tauri::command]
pub fn set_favourite(
    state: State<'_, AppState>,
    id: String,
    favourite: bool,
) -> CommandResult<EntrySummary> {
    state.set_favourite(&id, favourite)
}

#[tauri::command]
pub fn restore_entry(state: State<'_, AppState>, id: String) -> CommandResult<EntrySummary> {
    state.restore_entry(&id)
}

#[tauri::command]
pub fn delete_forever(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    state.delete_forever(&id)
}

#[tauri::command]
pub fn list_deleted_entries(state: State<'_, AppState>) -> CommandResult<Vec<EntrySummary>> {
    state.list_deleted_entries()
}

#[tauri::command]
pub fn copy_history_password(
    state: State<'_, AppState>,
    entry_id: String,
    history_id: String,
) -> CommandResult<()> {
    state.copy_history_password(&entry_id, &history_id)
}

fn suggested_export_name(now: time::OffsetDateTime) -> String {
    format!(
        "quietkeys-backup-{:04}-{:02}-{:02}.quietkeys",
        now.year(),
        u8::from(now.month()),
        now.day()
    )
}

#[cfg(test)]
mod tests {
    use super::suggested_export_name;

    #[test]
    fn suggested_export_name_uses_the_given_date() {
        let date = time::Date::from_calendar_date(2026, time::Month::September, 26).unwrap();
        let now = date.midnight().assume_utc();
        assert_eq!(
            suggested_export_name(now),
            "quietkeys-backup-2026-09-26.quietkeys"
        );
    }
}
