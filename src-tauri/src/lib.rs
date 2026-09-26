pub mod clipboard;
pub mod commands;
pub mod crypto;
pub mod error;
pub mod generator;
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
            commands::get_entry,
            commands::add_entry,
            commands::update_entry,
            commands::delete_entry,
            commands::generate_password,
            commands::score_password,
            commands::change_master_password,
            commands::copy_password,
            commands::copy_username,
            commands::restore_from_backup,
            commands::export_vault,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                // Tauri 2's RunEvent has no system-sleep variant on Windows or macOS, so
                // there is no lock-on-sleep hook. Idle auto-lock needs activity signals
                // from the UI and is not done here.
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

#[cfg(test)]
mod registration {
    use std::fs;
    use std::path::Path;

    /// Every command the frontend calls must be in the invoke handler and in the
    /// capability, or the UI fails at runtime with a permission error.
    #[test]
    fn every_frontend_command_is_registered_and_allowed() {
        let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
        let api = fs::read_to_string(manifest_dir.join("../src/api.ts")).unwrap();
        let lib_rs = fs::read_to_string(manifest_dir.join("src/lib.rs")).unwrap();
        let caps = fs::read_to_string(manifest_dir.join("capabilities/default.json")).unwrap();

        let mut commands = Vec::new();
        let mut rest = api.as_str();
        while let Some(start) = rest.find("call(\"") {
            rest = &rest[start + "call(\"".len()..];
            let end = rest.find('"').expect("command name");
            commands.push(&rest[..end]);
            rest = &rest[end..];
        }
        assert!(!commands.is_empty());

        for cmd in commands {
            assert!(
                lib_rs.contains(&format!("commands::{cmd}")),
                "{cmd} is called from src/api.ts but missing from generate_handler"
            );
            let permission = format!("allow-{}", cmd.replace('_', "-"));
            assert!(
                caps.contains(&permission),
                "{permission} is missing from capabilities/default.json"
            );
        }
    }
}
