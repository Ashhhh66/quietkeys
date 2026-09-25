pub mod commands;
pub mod crypto;
pub mod error;
pub mod state;
pub mod vault;

#[cfg(test)]
mod test_util;

use std::fs;
use std::io;
use std::path::Path;

use tauri::{Manager, RunEvent};

use crate::state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = app.path().app_local_data_dir()?;
            create_private_dir(&dir)?;
            app.manage(AppState::new(dir.join(vault::VAULT_FILE_NAME)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::vault_exists,
            commands::is_unlocked,
            commands::create_vault,
            commands::unlock,
            commands::lock,
            commands::list_entries,
            commands::get_password,
            commands::add_entry,
            commands::update_entry,
            commands::delete_entry,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                app.state::<AppState>().lock();
            }
        });
}

fn create_private_dir(dir: &Path) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(dir, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}
