//! The app's in-memory state: the vault path and, while unlocked, the decrypted vault.

use std::mem;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};

use secrecy::SecretString;
use serde::{Deserialize, Serialize, Serializer};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;
use uuid::Uuid;
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use crate::error::{Result, VaultError};
use crate::vault::{self, Entry, UnlockedVault, VaultData};

/// What the UI sends when adding or editing an entry. Wiped when dropped.
#[derive(Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields)]
pub struct EntryInput {
    pub title: String,
    pub username: String,
    pub password: String,
    pub url: String,
    pub notes: String,
}

/// One row of the entry list. Deliberately has no password or notes field.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct EntrySummary {
    pub id: String,
    pub title: String,
    pub username: String,
    pub url: String,
}

impl From<&Entry> for EntrySummary {
    fn from(entry: &Entry) -> Self {
        Self {
            id: entry.id.clone(),
            title: entry.title.clone(),
            username: entry.username.clone(),
            url: entry.url.clone(),
        }
    }
}

/// A single password on its way to the UI. The Rust copy is wiped once it has been sent.
pub struct RevealedPassword(Zeroizing<String>);

impl RevealedPassword {
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl Serialize for RevealedPassword {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

pub struct AppState {
    vault_path: PathBuf,
    unlocked: Mutex<Option<UnlockedVault>>,
}

impl AppState {
    pub fn new(vault_path: PathBuf) -> Self {
        Self {
            vault_path,
            unlocked: Mutex::new(None),
        }
    }

    pub fn vault_exists(&self) -> bool {
        self.vault_path.exists()
    }

    pub fn is_unlocked(&self) -> bool {
        self.guard().is_some()
    }

    /// Creates the vault file and leaves it unlocked.
    pub fn create_vault(&self, password: &SecretString) -> Result<()> {
        let vault = vault::create(&self.vault_path, password)?;
        *self.guard() = Some(vault);
        Ok(())
    }

    /// On failure the current state (locked or unlocked) is left as it was.
    pub fn unlock(&self, password: &SecretString) -> Result<()> {
        let vault = vault::load(&self.vault_path, password)?;
        *self.guard() = Some(vault);
        Ok(())
    }

    /// Drops the unlocked vault, which wipes its key and entries. Does nothing if already
    /// locked.
    pub fn lock(&self) {
        *self.guard() = None;
    }

    pub fn list_entries(&self) -> Result<Vec<EntrySummary>> {
        self.with_vault(|vault, _| Ok(vault.data.entries.iter().map(EntrySummary::from).collect()))
    }

    pub fn get_password(&self, id: &str) -> Result<RevealedPassword> {
        self.with_vault(|vault, _| {
            let entry = find(&vault.data, id)?;
            Ok(RevealedPassword(Zeroizing::new(entry.password.clone())))
        })
    }

    pub fn add_entry(&self, mut input: EntryInput) -> Result<EntrySummary> {
        self.modify(|data| {
            let now = now_rfc3339()?;
            let entry = Entry {
                id: Uuid::new_v4().to_string(),
                title: mem::take(&mut input.title),
                username: mem::take(&mut input.username),
                password: mem::take(&mut input.password),
                url: mem::take(&mut input.url),
                notes: mem::take(&mut input.notes),
                created_at: now.clone(),
                updated_at: now,
            };
            let summary = EntrySummary::from(&entry);
            data.entries.push(entry);
            Ok(summary)
        })
    }

    pub fn update_entry(&self, id: &str, mut input: EntryInput) -> Result<EntrySummary> {
        self.modify(|data| {
            let now = now_rfc3339()?;
            let entry = find_mut(data, id)?;
            replace_wiping(&mut entry.title, mem::take(&mut input.title));
            replace_wiping(&mut entry.username, mem::take(&mut input.username));
            replace_wiping(&mut entry.password, mem::take(&mut input.password));
            replace_wiping(&mut entry.url, mem::take(&mut input.url));
            replace_wiping(&mut entry.notes, mem::take(&mut input.notes));
            entry.updated_at = now;
            Ok(EntrySummary::from(&*entry))
        })
    }

    pub fn delete_entry(&self, id: &str) -> Result<()> {
        self.modify(|data| {
            let index = data
                .entries
                .iter()
                .position(|e| e.id == id)
                .ok_or(VaultError::EntryNotFound)?;
            data.entries.remove(index);
            Ok(())
        })
    }

    /// The single gate for every protected operation: fails with `Locked` unless a vault
    /// is unlocked.
    fn with_vault<T>(
        &self,
        operation: impl FnOnce(&mut UnlockedVault, &Path) -> Result<T>,
    ) -> Result<T> {
        let mut guard = self.guard();
        let vault = guard.as_mut().ok_or(VaultError::Locked)?;
        operation(vault, &self.vault_path)
    }

    /// Applies a change and saves it. If either step fails, the in-memory data is restored
    /// so it always matches what is on disk.
    fn modify<T>(&self, change: impl FnOnce(&mut VaultData) -> Result<T>) -> Result<T> {
        self.with_vault(|vault, path| {
            let snapshot = vault.data.clone();
            let result = change(&mut vault.data).and_then(|value| {
                vault::save(vault, path)?;
                Ok(value)
            });
            if result.is_err() {
                vault.data = snapshot;
            }
            result
        })
    }

    fn guard(&self) -> MutexGuard<'_, Option<UnlockedVault>> {
        self.unlocked.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

fn find<'a>(data: &'a VaultData, id: &str) -> Result<&'a Entry> {
    data.entries
        .iter()
        .find(|e| e.id == id)
        .ok_or(VaultError::EntryNotFound)
}

fn find_mut<'a>(data: &'a mut VaultData, id: &str) -> Result<&'a mut Entry> {
    data.entries
        .iter_mut()
        .find(|e| e.id == id)
        .ok_or(VaultError::EntryNotFound)
}

/// Wipes the old value before replacing it, so it isn't left behind in freed memory.
fn replace_wiping(field: &mut String, value: String) {
    field.zeroize();
    *field = value;
}

fn now_rfc3339() -> Result<String> {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|_| VaultError::InvalidFormat)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;
    use crate::test_util::TestDir;

    const PASSWORD: &str = "correct horse battery staple";

    fn password() -> SecretString {
        SecretString::from(PASSWORD)
    }

    fn input(n: u32) -> EntryInput {
        EntryInput {
            title: format!("Site {n}"),
            username: format!("user{n}@example.com"),
            password: format!("secret-password-{n}"),
            url: format!("https://site{n}.example.com"),
            notes: format!("notes {n}"),
        }
    }

    fn unlocked_state(dir: &TestDir) -> AppState {
        let state = AppState::new(dir.vault_path());
        state.create_vault(&password()).unwrap();
        state
    }

    /// Calls every protected operation and returns each result, without the value.
    fn call_every_protected_operation(state: &AppState) -> Vec<(&'static str, Result<()>)> {
        vec![
            ("list_entries", state.list_entries().map(drop)),
            ("get_password", state.get_password("any-id").map(drop)),
            ("add_entry", state.add_entry(input(9)).map(drop)),
            (
                "update_entry",
                state.update_entry("any-id", input(9)).map(drop),
            ),
            ("delete_entry", state.delete_entry("any-id")),
        ]
    }

    fn assert_all_locked(state: &AppState) {
        for (name, result) in call_every_protected_operation(state) {
            assert_eq!(result, Err(VaultError::Locked), "{name}");
        }
    }

    #[test]
    fn protected_operations_fail_before_unlock() {
        let dir = TestDir::new();
        let state = AppState::new(dir.vault_path());
        assert_all_locked(&state);

        unlocked_state(&dir).lock();
        let state = AppState::new(dir.vault_path());
        let before = fs::read(dir.vault_path()).unwrap();
        assert_all_locked(&state);
        assert_eq!(fs::read(dir.vault_path()).unwrap(), before);
    }

    #[test]
    fn protected_operations_fail_after_lock() {
        let dir = TestDir::new();
        let state = unlocked_state(&dir);
        state.add_entry(input(1)).unwrap();
        state.lock();
        assert_all_locked(&state);
    }

    #[test]
    fn lock_clears_state_and_unlock_restores_it() {
        let dir = TestDir::new();
        let state = unlocked_state(&dir);
        let added = state.add_entry(input(1)).unwrap();
        assert!(state.is_unlocked());

        state.lock();
        assert!(!state.is_unlocked());
        assert!(state.guard().is_none());

        state.unlock(&password()).unwrap();
        assert_eq!(state.list_entries().unwrap(), vec![added]);
    }

    #[test]
    fn lock_when_already_locked_does_nothing() {
        let dir = TestDir::new();
        let state = AppState::new(dir.vault_path());
        state.lock();
        state.lock();
        assert!(!state.is_unlocked());
    }

    #[test]
    fn vault_exists_after_create() {
        let dir = TestDir::new();
        let state = AppState::new(dir.vault_path());
        assert!(!state.vault_exists());
        assert!(!state.is_unlocked());
        state.create_vault(&password()).unwrap();
        assert!(state.vault_exists());
        assert!(state.is_unlocked());
    }

    #[test]
    fn create_vault_fails_if_one_exists() {
        let dir = TestDir::new();
        let state = unlocked_state(&dir);
        state.add_entry(input(1)).unwrap();
        state.lock();

        assert_eq!(
            state.create_vault(&password()),
            Err(VaultError::Io(std::io::ErrorKind::AlreadyExists))
        );
        assert!(!state.is_unlocked());
        state.unlock(&password()).unwrap();
        assert_eq!(state.list_entries().unwrap().len(), 1);
    }

    #[test]
    fn wrong_password_stays_locked() {
        let dir = TestDir::new();
        unlocked_state(&dir).lock();
        let state = AppState::new(dir.vault_path());
        assert_eq!(
            state.unlock(&SecretString::from("not the right password")),
            Err(VaultError::DecryptFailed)
        );
        assert!(!state.is_unlocked());
        assert_all_locked(&state);
    }

    #[test]
    fn list_entries_never_contains_passwords_or_notes() {
        let dir = TestDir::new();
        let state = unlocked_state(&dir);
        state.add_entry(input(1)).unwrap();
        state.add_entry(input(2)).unwrap();

        let entries = state.list_entries().unwrap();
        assert_eq!(entries.len(), 2);
        let json = serde_json::to_string(&entries).unwrap();
        assert!(!json.contains("secret-password"));
        assert!(!json.contains("password"));
        assert!(!json.contains("notes"));
        let keys: Vec<String> = serde_json::to_value(&entries[0])
            .unwrap()
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect();
        assert_eq!(keys, ["id", "title", "url", "username"]);
    }

    #[test]
    fn get_password_returns_only_the_requested_password() {
        let dir = TestDir::new();
        let state = unlocked_state(&dir);
        let first = state.add_entry(input(1)).unwrap();
        let second = state.add_entry(input(2)).unwrap();

        assert_eq!(
            state.get_password(&first.id).unwrap().expose(),
            "secret-password-1"
        );
        let revealed = state.get_password(&second.id).unwrap();
        assert_eq!(
            serde_json::to_string(&revealed).unwrap(),
            "\"secret-password-2\""
        );
        assert_eq!(
            state.get_password("no-such-id").err(),
            Some(VaultError::EntryNotFound)
        );
    }

    #[test]
    fn add_entry_sets_uuid_and_timestamps_and_saves() {
        let dir = TestDir::new();
        let state = unlocked_state(&dir);
        let summary = state.add_entry(input(1)).unwrap();

        let id = Uuid::parse_str(&summary.id).unwrap();
        assert_eq!(id.get_version_num(), 4);
        assert_eq!(summary.title, "Site 1");

        let on_disk = vault::load(&dir.vault_path(), &password()).unwrap();
        let entry = &on_disk.data.entries[0];
        assert_eq!(entry.id, summary.id);
        assert_eq!(entry.password, "secret-password-1");
        assert_eq!(entry.created_at, entry.updated_at);
        OffsetDateTime::parse(&entry.created_at, &Rfc3339).unwrap();
    }

    #[test]
    fn add_entry_ids_are_unique() {
        let dir = TestDir::new();
        let state = unlocked_state(&dir);
        let a = state.add_entry(input(1)).unwrap();
        let b = state.add_entry(input(1)).unwrap();
        assert_ne!(a.id, b.id);
    }

    #[test]
    fn update_entry_keeps_created_at_and_saves() {
        let dir = TestDir::new();
        let state = unlocked_state(&dir);
        let added = state.add_entry(input(1)).unwrap();
        let created_at = vault::load(&dir.vault_path(), &password())
            .unwrap()
            .data
            .entries[0]
            .created_at
            .clone();

        let updated = state.update_entry(&added.id, input(2)).unwrap();
        assert_eq!(updated.id, added.id);
        assert_eq!(updated.title, "Site 2");

        let on_disk = vault::load(&dir.vault_path(), &password()).unwrap();
        let entry = &on_disk.data.entries[0];
        assert_eq!(entry.created_at, created_at);
        assert_eq!(entry.password, "secret-password-2");
        assert_eq!(entry.notes, "notes 2");
        let created = OffsetDateTime::parse(&entry.created_at, &Rfc3339).unwrap();
        let modified = OffsetDateTime::parse(&entry.updated_at, &Rfc3339).unwrap();
        assert!(modified >= created);

        assert_eq!(
            state.update_entry("no-such-id", input(3)).err(),
            Some(VaultError::EntryNotFound)
        );
    }

    #[test]
    fn delete_entry_removes_and_saves() {
        let dir = TestDir::new();
        let state = unlocked_state(&dir);
        let first = state.add_entry(input(1)).unwrap();
        let second = state.add_entry(input(2)).unwrap();

        state.delete_entry(&first.id).unwrap();
        assert_eq!(state.list_entries().unwrap(), vec![second.clone()]);
        let on_disk = vault::load(&dir.vault_path(), &password()).unwrap();
        assert_eq!(on_disk.data.entries.len(), 1);
        assert_eq!(on_disk.data.entries[0].id, second.id);

        assert_eq!(
            state.delete_entry(&first.id),
            Err(VaultError::EntryNotFound)
        );
    }

    #[test]
    fn failed_save_leaves_memory_matching_disk() {
        let dir = TestDir::new();
        let state = unlocked_state(&dir);
        let kept = state.add_entry(input(1)).unwrap();

        // A directory where the temp file should go makes every save fail.
        let tmp = dir.0.join(format!("{}.tmp", vault::VAULT_FILE_NAME));
        fs::create_dir(&tmp).unwrap();

        assert!(state.add_entry(input(2)).is_err());
        assert!(state.update_entry(&kept.id, input(3)).is_err());
        assert!(state.delete_entry(&kept.id).is_err());

        assert_eq!(state.list_entries().unwrap(), vec![kept.clone()]);
        assert_eq!(
            state.get_password(&kept.id).unwrap().expose(),
            "secret-password-1"
        );
        let on_disk = vault::load(&dir.vault_path(), &password()).unwrap();
        assert_eq!(on_disk.data.entries.len(), 1);
    }

    #[test]
    fn entry_input_rejects_unknown_fields() {
        let json =
            r#"{"title":"t","username":"u","password":"p","url":"x","notes":"n","id":"forged"}"#;
        assert!(serde_json::from_str::<EntryInput>(json).is_err());
    }
}
