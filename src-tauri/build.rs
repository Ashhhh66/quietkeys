const COMMANDS: &[&str] = &[
    "vault_exists",
    "create_vault",
    "unlock",
    "lock",
    "list_entries",
    "get_password",
    "add_entry",
    "update_entry",
    "delete_entry",
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
