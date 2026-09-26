const COMMANDS: &[&str] = &[
    "vault_exists",
    "backup_exists",
    "is_unlocked",
    "create_vault",
    "unlock",
    "lock",
    "list_entries",
    "get_password",
    "get_entry",
    "add_entry",
    "update_entry",
    "delete_entry",
    "generate_password",
    "score_password",
    "change_master_password",
    "copy_password",
    "copy_username",
    "copy_generated_password",
    "restore_from_backup",
    "export_vault",
    "clear_clipboard",
    "open_entry_website",
];

fn main() {
    // Declaring the commands makes Tauri require an explicit permission for each one,
    // granted in capabilities/default.json.
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
