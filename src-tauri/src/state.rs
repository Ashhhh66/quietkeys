//! The app's in-memory state: the vault path and, while unlocked, the decrypted vault.

use std::mem;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, TryLockError};
use std::time::{Duration, Instant};

use secrecy::SecretString;
use serde::{Deserialize, Serialize, Serializer};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;
use uuid::Uuid;
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use crate::clipboard::{self, ConcealedClipboard};
use crate::error::{Result, VaultError};
use crate::vault::{self, Entry, UnlockedVault, VaultData};

/// After this many wrong passwords in a row, further attempts are delayed.
const THROTTLE_AFTER_FAILURES: u32 = 3;
const THROTTLE_BASE_DELAY: Duration = Duration::from_secs(1);
const THROTTLE_MAX_DELAY: Duration = Duration::from_secs(30);

const MAX_TITLE_CHARS: usize = 256;
const MAX_USERNAME_CHARS: usize = 512;
const MAX_PASSWORD_CHARS: usize = 4096;
const MAX_URL_CHARS: usize = 2048;
const MAX_NOTES_CHARS: usize = 65536;

/// A source of the current time, so tests can move it forward without sleeping.
trait Clock: Send + Sync {
    fn now(&self) -> Instant;
}

struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> Instant {
        Instant::now()
    }
}

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

impl EntryInput {
    /// Rejects a field that is too long, counting Unicode characters, not bytes.
    fn check_lengths(&self) -> Result<()> {
        check_field_length("title", &self.title, MAX_TITLE_CHARS)?;
        check_field_length("username", &self.username, MAX_USERNAME_CHARS)?;
        check_field_length("password", &self.password, MAX_PASSWORD_CHARS)?;
        check_field_length("url", &self.url, MAX_URL_CHARS)?;
        check_field_length("notes", &self.notes, MAX_NOTES_CHARS)?;
        Ok(())
    }
}

/// What the UI sends when editing an entry. Unlike `EntryInput`, `password` is optional:
/// `None` keeps the entry's existing password unchanged, so the editor never has to
/// display or resend a password the user hasn't chosen to reveal or change. Wiped when
/// dropped.
#[derive(Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields)]
pub struct UpdateEntryInput {
    pub title: String,
    pub username: String,
    pub password: Option<String>,
    pub url: String,
    pub notes: String,
}

impl UpdateEntryInput {
    fn check_lengths(&self) -> Result<()> {
        check_field_length("title", &self.title, MAX_TITLE_CHARS)?;
        check_field_length("username", &self.username, MAX_USERNAME_CHARS)?;
        if let Some(password) = &self.password {
            check_field_length("password", password, MAX_PASSWORD_CHARS)?;
        }
        check_field_length("url", &self.url, MAX_URL_CHARS)?;
        check_field_length("notes", &self.notes, MAX_NOTES_CHARS)?;
        Ok(())
    }
}

fn check_field_length(field: &'static str, value: &str, max_chars: usize) -> Result<()> {
    if value.chars().count() > max_chars {
        Err(VaultError::FieldTooLong { field, max_chars })
    } else {
        Ok(())
    }
}

/// One row of the entry list. Deliberately has no password or notes field.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
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

/// Every entry field except the password: what the editor loads to prefill a form.
/// Passwords are still only ever sent one at a time, via `get_password`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryDetails {
    pub id: String,
    pub title: String,
    pub username: String,
    pub url: String,
    pub notes: String,
    pub created_at: String,
    pub updated_at: String,
}

impl From<&Entry> for EntryDetails {
    fn from(entry: &Entry) -> Self {
        Self {
            id: entry.id.clone(),
            title: entry.title.clone(),
            username: entry.username.clone(),
            url: entry.url.clone(),
            notes: entry.notes.clone(),
            created_at: entry.created_at.clone(),
            updated_at: entry.updated_at.clone(),
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

/// Tracks wrong-password attempts. A fresh vault (or one just unlocked) has no throttle.
#[derive(Default)]
struct ThrottleState {
    consecutive_failures: u32,
    locked_until: Option<Instant>,
}

/// The delay before the attempt that would follow this many consecutive failures.
/// `None` while at or below the threshold; then 1s, 2s, 4s, ..., capped at 30s.
fn throttle_delay(consecutive_failures: u32) -> Option<Duration> {
    let extra = consecutive_failures.checked_sub(THROTTLE_AFTER_FAILURES)?;
    Some(
        THROTTLE_BASE_DELAY
            .checked_mul(1u32.checked_shl(extra).unwrap_or(u32::MAX))
            .unwrap_or(THROTTLE_MAX_DELAY)
            .min(THROTTLE_MAX_DELAY),
    )
}

pub struct AppState {
    vault_path: PathBuf,
    unlocked: Mutex<Option<UnlockedVault>>,
    throttle: Mutex<ThrottleState>,
    /// Held for the whole body of `create_vault`, `unlock`, `change_master_password`, and
    /// `restore_from_backup`, so only one of them can run at a time. Its data is unused;
    /// only the ability to lock it matters.
    single_flight: Mutex<()>,
    clock: Arc<dyn Clock>,
    clipboard: Arc<dyn ConcealedClipboard>,
    /// The clipboard change counter from the last copy this process made. Not the copied
    /// text: that is never stored. `None` means there is nothing of ours to clear.
    copied_generation: Mutex<Option<u64>>,
    /// How long after a copy to clear the clipboard, if it is still ours. `Duration::ZERO`
    /// means "do not start a timer" (tests clear by calling `lock` or the clipboard directly).
    clipboard_clear_after: Duration,
}

impl AppState {
    pub fn new(vault_path: PathBuf) -> Self {
        Self::with_clock(vault_path, Arc::new(SystemClock))
    }

    fn with_clock(vault_path: PathBuf, clock: Arc<dyn Clock>) -> Self {
        Self::assemble(
            vault_path,
            clock,
            Arc::new(clipboard::OsClipboard),
            clipboard::CLEAR_AFTER,
        )
    }

    fn assemble(
        vault_path: PathBuf,
        clock: Arc<dyn Clock>,
        clipboard: Arc<dyn ConcealedClipboard>,
        clipboard_clear_after: Duration,
    ) -> Self {
        Self {
            vault_path,
            unlocked: Mutex::new(None),
            throttle: Mutex::new(ThrottleState::default()),
            single_flight: Mutex::new(()),
            clock,
            clipboard,
            copied_generation: Mutex::new(None),
            clipboard_clear_after,
        }
    }

    /// Rejects a second concurrent slow vault operation immediately as `Busy`, before it
    /// can run Argon2 or touch the throttle. `try_lock` never waits, so a busy caller
    /// finds out at once rather than blocking the UI thread.
    fn enter_single_flight(&self) -> Result<MutexGuard<'_, ()>> {
        match self.single_flight.try_lock() {
            Ok(guard) => Ok(guard),
            Err(TryLockError::WouldBlock) => Err(VaultError::Busy),
            Err(TryLockError::Poisoned(poisoned)) => {
                // A panic mid-derivation released the lock; nothing to restore (the data
                // is just `()`), so just clear the poison and let this caller in.
                self.single_flight.clear_poison();
                Ok(poisoned.into_inner())
            }
        }
    }

    pub fn vault_exists(&self) -> bool {
        self.vault_path.exists()
    }

    pub fn is_unlocked(&self) -> bool {
        self.guard().is_some()
    }

    /// Creates the vault file and leaves it unlocked.
    ///
    /// Fails with `Busy` if another slow vault operation is already running.
    pub fn create_vault(&self, password: &SecretString) -> Result<()> {
        let _slot = self.enter_single_flight()?;
        let vault = vault::create(&self.vault_path, password)?;
        *self.guard() = Some(vault);
        Ok(())
    }

    /// On failure the current state (locked or unlocked) is left as it was.
    ///
    /// After 3 wrong passwords in a row, further attempts are refused for an increasing
    /// delay (1s, 2s, 4s, ..., capped at 30s) without touching the vault file or running
    /// Argon2. A correct password resets the count. Only a wrong password (not a corrupt
    /// or unreadable file) counts as an attempt.
    ///
    /// Fails with `Busy` if another slow vault operation is already running; that check
    /// happens first, so a busy call never touches the throttle either.
    pub fn unlock(&self, password: &SecretString) -> Result<()> {
        let _slot = self.enter_single_flight()?;
        let now = self.clock.now();
        if let Some(seconds_remaining) = self.check_throttle(now) {
            return Err(VaultError::Throttled { seconds_remaining });
        }

        match vault::load(&self.vault_path, password) {
            Ok(vault) => {
                *self.guard() = Some(vault);
                self.reset_throttle();
                Ok(())
            }
            Err(err) => {
                if err == VaultError::DecryptFailed {
                    self.record_wrong_password(now);
                }
                Err(err)
            }
        }
    }

    /// `Some(seconds)` if a throttle from an earlier failure is still active.
    fn check_throttle(&self, now: Instant) -> Option<u64> {
        let throttle = self.throttle_guard();
        let locked_until = throttle.locked_until?;
        (now < locked_until).then(|| seconds_remaining(now, locked_until))
    }

    fn record_wrong_password(&self, now: Instant) {
        let mut throttle = self.throttle_guard();
        throttle.consecutive_failures += 1;
        throttle.locked_until = throttle_delay(throttle.consecutive_failures).map(|d| now + d);
    }

    fn reset_throttle(&self) {
        *self.throttle_guard() = ThrottleState::default();
    }

    /// Same poison handling as `guard()`: fail safe to "no throttle recorded" rather than
    /// risk half-updated counters, and clear the poison flag so it does not recur forever.
    fn throttle_guard(&self) -> MutexGuard<'_, ThrottleState> {
        match self.throttle.lock() {
            Ok(guard) => guard,
            Err(poisoned) => {
                let mut guard = poisoned.into_inner();
                *guard = ThrottleState::default();
                self.throttle.clear_poison();
                guard
            }
        }
    }

    /// Drops the unlocked vault, which wipes its key and entries. Also clears the
    /// clipboard when it still holds the value this process copied. Does nothing to the
    /// vault if already locked. A clipboard error (including "unsupported" on Linux)
    /// does not stop the lock.
    pub fn lock(&self) {
        self.clear_copied();
        *self.guard() = None;
    }

    /// Verifies `current` by decrypting the vault file with it, then re-encrypts under
    /// `new_password` with a new salt and the default Argon2 parameters. A wrong current
    /// password counts toward the unlock throttle. An invalid new password does not.
    /// Requires the vault to be unlocked, and that check happens before Argon2.
    pub fn change_master_password(
        &self,
        current: &SecretString,
        new_password: &SecretString,
    ) -> Result<()> {
        let _slot = self.enter_single_flight()?;
        let now = self.clock.now();
        if let Some(seconds_remaining) = self.check_throttle(now) {
            return Err(VaultError::Throttled { seconds_remaining });
        }
        let mut guard = self.guard();
        let Some(vault) = guard.as_mut() else {
            return Err(VaultError::Locked);
        };
        match vault::change_master_password(vault, &self.vault_path, current, new_password) {
            Ok(()) => {
                drop(guard);
                self.reset_throttle();
                Ok(())
            }
            Err(err) => {
                if err == VaultError::DecryptFailed {
                    drop(guard);
                    self.record_wrong_password(now);
                }
                Err(err)
            }
        }
    }

    /// Replaces the vault with its backup and leaves it unlocked. Refuses while already
    /// unlocked, before reading the backup. A wrong password counts toward the throttle
    /// and does not move the current file.
    pub fn restore_from_backup(&self, password: &SecretString) -> Result<()> {
        let _slot = self.enter_single_flight()?;
        if self.is_unlocked() {
            return Err(VaultError::AlreadyUnlocked);
        }
        let now = self.clock.now();
        if let Some(seconds_remaining) = self.check_throttle(now) {
            return Err(VaultError::Throttled { seconds_remaining });
        }
        match vault::restore_replacing(&self.vault_path, password) {
            Ok(vault) => {
                *self.guard() = Some(vault);
                self.reset_throttle();
                Ok(())
            }
            Err(err) => {
                if err == VaultError::DecryptFailed {
                    self.record_wrong_password(now);
                }
                Err(err)
            }
        }
    }

    /// Copies the encrypted vault file to `dest`, refusing to overwrite. Requires unlock.
    pub fn export_vault(&self, dest: &Path) -> Result<()> {
        self.with_vault(|_, _| vault::export_encrypted(&self.vault_path, dest))
    }

    /// Writes the entry's password to the OS clipboard from Rust. The password is not
    /// returned to the caller and is not kept after the copy.
    pub fn copy_password(&self, id: &str) -> Result<()> {
        let password = self.get_password(id)?;
        self.copy_to_clipboard(password.expose())
    }

    /// Writes the entry's username to the OS clipboard.
    pub fn copy_username(&self, id: &str) -> Result<()> {
        let username = self.with_vault(|vault, _| Ok(find(&vault.data, id)?.username.clone()))?;
        self.copy_to_clipboard(&username)
    }

    fn copy_to_clipboard(&self, text: &str) -> Result<()> {
        let generation = self.clipboard.copy_concealed(text)?;
        *self.generation_guard() = Some(generation);
        self.schedule_clear(generation);
        Ok(())
    }

    fn schedule_clear(&self, generation: u64) {
        if self.clipboard_clear_after.is_zero() {
            return;
        }
        let clipboard = Arc::clone(&self.clipboard);
        let delay = self.clipboard_clear_after;
        std::thread::spawn(move || {
            std::thread::sleep(delay);
            let _ = clipboard.clear_if_unchanged(generation);
        });
    }

    fn clear_copied(&self) {
        let generation = self.generation_guard().take();
        if let Some(generation) = generation {
            let _ = self.clipboard.clear_if_unchanged(generation);
        }
    }

    fn generation_guard(&self) -> MutexGuard<'_, Option<u64>> {
        match self.copied_generation.lock() {
            Ok(guard) => guard,
            Err(poisoned) => {
                self.copied_generation.clear_poison();
                poisoned.into_inner()
            }
        }
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

    /// Every field of one entry except the password.
    pub fn get_entry(&self, id: &str) -> Result<EntryDetails> {
        self.with_vault(|vault, _| Ok(EntryDetails::from(find(&vault.data, id)?)))
    }

    pub fn add_entry(&self, mut input: EntryInput) -> Result<EntrySummary> {
        self.modify(|data| {
            input.check_lengths()?;
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

    /// `input.password`: `None` keeps the entry's existing password; `Some(new)` replaces
    /// it. Every other field is always replaced.
    pub fn update_entry(&self, id: &str, mut input: UpdateEntryInput) -> Result<EntrySummary> {
        self.modify(|data| {
            input.check_lengths()?;
            let now = now_rfc3339()?;
            let entry = find_mut(data, id)?;
            replace_wiping(&mut entry.title, mem::take(&mut input.title));
            replace_wiping(&mut entry.username, mem::take(&mut input.username));
            if let Some(password) = input.password.take() {
                replace_wiping(&mut entry.password, password);
            }
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

    /// If a previous access panicked while holding this lock, the in-memory vault may be
    /// half-changed (for example, a field replaced but not yet saved). Rather than risk
    /// using that data, treat a poisoned lock as a lock: clear the vault, then clear the
    /// poison flag so later calls behave normally again (a `Mutex` stays poisoned forever
    /// otherwise, which would wipe every future unlock too).
    fn guard(&self) -> MutexGuard<'_, Option<UnlockedVault>> {
        match self.unlocked.lock() {
            Ok(guard) => guard,
            Err(poisoned) => {
                let mut guard = poisoned.into_inner();
                *guard = None;
                self.unlocked.clear_poison();
                guard
            }
        }
    }
}

/// Rounds up, so the UI never shows "0 seconds" while a throttle is still active.
fn seconds_remaining(now: Instant, locked_until: Instant) -> u64 {
    let remaining = locked_until.saturating_duration_since(now);
    remaining.as_secs() + u64::from(remaining.subsec_nanos() > 0)
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

    /// A vault created with the fast test KDF and placed in memory directly, so these
    /// tests do not run the default-parameter upgrade that `load` prepares.
    fn fast_unlocked(dir: &TestDir) -> AppState {
        fast_unlocked_with(dir, Arc::new(SystemClock), Arc::new(clipboard::OsClipboard))
    }

    fn fast_unlocked_with(
        dir: &TestDir,
        clock: Arc<dyn Clock>,
        clipboard: Arc<dyn ConcealedClipboard>,
    ) -> AppState {
        let vault = vault::create_with_params(
            &dir.vault_path(),
            &password(),
            crate::crypto::KdfParams::fast(),
        )
        .unwrap();
        let state = AppState::assemble(dir.vault_path(), clock, clipboard, Duration::ZERO);
        *state.guard() = Some(vault);
        state
    }

    fn update_input(n: u32) -> UpdateEntryInput {
        UpdateEntryInput {
            title: format!("Site {n}"),
            username: format!("user{n}@example.com"),
            password: Some(format!("secret-password-{n}")),
            url: format!("https://site{n}.example.com"),
            notes: format!("notes {n}"),
        }
    }

    fn update_input_with(field: &str, value: String) -> UpdateEntryInput {
        let mut entry = update_input(1);
        match field {
            "title" => entry.title = value,
            "username" => entry.username = value,
            "password" => entry.password = Some(value),
            "url" => entry.url = value,
            "notes" => entry.notes = value,
            _ => unreachable!(),
        }
        entry
    }

    /// Calls every protected operation and returns each result, without the value.
    fn call_every_protected_operation(state: &AppState) -> Vec<(&'static str, Result<()>)> {
        vec![
            ("list_entries", state.list_entries().map(drop)),
            ("get_password", state.get_password("any-id").map(drop)),
            ("get_entry", state.get_entry("any-id").map(drop)),
            ("add_entry", state.add_entry(input(9)).map(drop)),
            (
                "update_entry",
                state.update_entry("any-id", update_input(9)).map(drop),
            ),
            ("delete_entry", state.delete_entry("any-id")),
            (
                "change_master_password",
                state.change_master_password(&password(), &password()),
            ),
            (
                "export_vault",
                state.export_vault(Path::new("export.quietkeys")),
            ),
            ("copy_password", state.copy_password("any-id")),
            ("copy_username", state.copy_username("any-id")),
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

        let updated = state.update_entry(&added.id, update_input(2)).unwrap();
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
            state.update_entry("no-such-id", update_input(3)).err(),
            Some(VaultError::EntryNotFound)
        );
    }

    #[test]
    fn update_entry_with_password_none_keeps_the_existing_password() {
        let dir = TestDir::new();
        let state = unlocked_state(&dir);
        let added = state.add_entry(input(1)).unwrap();

        let mut without_password = update_input(2);
        without_password.password = None;
        state.update_entry(&added.id, without_password).unwrap();

        let on_disk = vault::load(&dir.vault_path(), &password()).unwrap();
        let entry = &on_disk.data.entries[0];
        assert_eq!(entry.password, "secret-password-1", "password unchanged");
        assert_eq!(entry.title, "Site 2", "other fields still updated");
        assert_eq!(entry.username, "user2@example.com");
    }

    #[test]
    fn update_entry_with_password_some_replaces_the_password() {
        let dir = TestDir::new();
        let state = unlocked_state(&dir);
        let added = state.add_entry(input(1)).unwrap();

        state.update_entry(&added.id, update_input(2)).unwrap();

        let on_disk = vault::load(&dir.vault_path(), &password()).unwrap();
        assert_eq!(on_disk.data.entries[0].password, "secret-password-2");
    }

    #[test]
    fn update_entry_still_checks_other_field_lengths_when_password_is_none() {
        let dir = TestDir::new();
        let state = unlocked_state(&dir);
        let added = state.add_entry(input(1)).unwrap();

        let mut too_long_title = update_input(2);
        too_long_title.password = None;
        too_long_title.title = "a".repeat(MAX_TITLE_CHARS + 1);
        assert_eq!(
            state.update_entry(&added.id, too_long_title).err(),
            Some(VaultError::FieldTooLong {
                field: "title",
                max_chars: MAX_TITLE_CHARS
            })
        );
    }

    #[test]
    fn get_entry_returns_every_field_except_the_password() {
        let dir = TestDir::new();
        let state = unlocked_state(&dir);
        let added = state.add_entry(input(1)).unwrap();

        let details = state.get_entry(&added.id).unwrap();
        assert_eq!(details.id, added.id);
        assert_eq!(details.title, "Site 1");
        assert_eq!(details.username, "user1@example.com");
        assert_eq!(details.url, "https://site1.example.com");
        assert_eq!(details.notes, "notes 1");
        assert_eq!(details.created_at, details.updated_at);
        OffsetDateTime::parse(&details.created_at, &Rfc3339).unwrap();

        let json = serde_json::to_string(&details).unwrap();
        assert!(!json.contains("secret-password"));
        assert!(!json.contains("password"));
        // camelCase keys, matching every other type sent to the frontend.
        assert!(json.contains("\"createdAt\""));
        assert!(json.contains("\"updatedAt\""));
        assert!(!json.contains("created_at"));
    }

    #[test]
    fn get_entry_fails_for_an_unknown_id() {
        let dir = TestDir::new();
        let state = unlocked_state(&dir);
        assert_eq!(
            state.get_entry("no-such-id").err(),
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
        assert!(state.update_entry(&kept.id, update_input(3)).is_err());
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

    // --- Field length limits ---

    fn input_with(field: &str, value: String) -> EntryInput {
        let mut entry = input(1);
        match field {
            "title" => entry.title = value,
            "username" => entry.username = value,
            "password" => entry.password = value,
            "url" => entry.url = value,
            "notes" => entry.notes = value,
            _ => unreachable!(),
        }
        entry
    }

    #[test]
    fn each_field_over_its_limit_is_rejected() {
        let dir = TestDir::new();
        let state = unlocked_state(&dir);
        let limits: [(&str, usize); 5] = [
            ("title", MAX_TITLE_CHARS),
            ("username", MAX_USERNAME_CHARS),
            ("password", MAX_PASSWORD_CHARS),
            ("url", MAX_URL_CHARS),
            ("notes", MAX_NOTES_CHARS),
        ];
        for (field, max_chars) in limits {
            let too_long = "a".repeat(max_chars + 1);
            assert_eq!(
                state.add_entry(input_with(field, too_long)).err(),
                Some(VaultError::FieldTooLong { field, max_chars }),
                "{field}"
            );
        }
        // Nothing above was actually saved.
        assert_eq!(state.list_entries().unwrap().len(), 0);
    }

    #[test]
    fn each_field_at_its_limit_is_accepted() {
        let dir = TestDir::new();
        let state = unlocked_state(&dir);
        for (field, max_chars) in [
            ("title", MAX_TITLE_CHARS),
            ("username", MAX_USERNAME_CHARS),
            ("password", MAX_PASSWORD_CHARS),
            ("url", MAX_URL_CHARS),
            ("notes", MAX_NOTES_CHARS),
        ] {
            let exactly_max = "a".repeat(max_chars);
            assert!(
                state.add_entry(input_with(field, exactly_max)).is_ok(),
                "{field}"
            );
        }
    }

    #[test]
    fn field_length_counts_characters_not_bytes() {
        let dir = TestDir::new();
        let state = unlocked_state(&dir);
        // Each 'é' is 2 bytes in UTF-8 but 1 character.
        let at_limit = "é".repeat(MAX_TITLE_CHARS);
        let over_limit = "é".repeat(MAX_TITLE_CHARS + 1);
        assert!(state.add_entry(input_with("title", at_limit)).is_ok());
        assert_eq!(
            state.add_entry(input_with("title", over_limit)).err(),
            Some(VaultError::FieldTooLong {
                field: "title",
                max_chars: MAX_TITLE_CHARS
            })
        );
    }

    #[test]
    fn locked_state_takes_priority_over_field_length() {
        let dir = TestDir::new();
        let state = AppState::new(dir.vault_path());
        let too_long = input_with("title", "a".repeat(MAX_TITLE_CHARS + 1));
        assert_eq!(state.add_entry(too_long).err(), Some(VaultError::Locked));
    }

    #[test]
    fn update_entry_also_checks_field_lengths() {
        let dir = TestDir::new();
        let state = unlocked_state(&dir);
        let added = state.add_entry(input(1)).unwrap();
        let too_long = update_input_with("notes", "a".repeat(MAX_NOTES_CHARS + 1));
        assert_eq!(
            state.update_entry(&added.id, too_long).err(),
            Some(VaultError::FieldTooLong {
                field: "notes",
                max_chars: MAX_NOTES_CHARS
            })
        );
        // The existing entry is unchanged.
        let on_disk = vault::load(&dir.vault_path(), &password()).unwrap();
        assert_eq!(on_disk.data.entries[0].notes, "notes 1");
    }

    // --- Unlock throttling ---

    struct FakeClock {
        base: Instant,
        offset_ms: std::sync::atomic::AtomicU64,
    }

    impl FakeClock {
        fn new() -> Arc<Self> {
            Arc::new(Self {
                base: Instant::now(),
                offset_ms: std::sync::atomic::AtomicU64::new(0),
            })
        }

        fn advance(&self, duration: Duration) {
            self.offset_ms.fetch_add(
                u64::try_from(duration.as_millis()).unwrap(),
                std::sync::atomic::Ordering::SeqCst,
            );
        }
    }

    impl Clock for FakeClock {
        fn now(&self) -> Instant {
            self.base
                + Duration::from_millis(self.offset_ms.load(std::sync::atomic::Ordering::SeqCst))
        }
    }

    fn unlocked_state_with_clock(dir: &TestDir, clock: Arc<FakeClock>) -> AppState {
        let state = AppState::with_clock(dir.vault_path(), clock);
        state.create_vault(&password()).unwrap();
        state
    }

    fn wrong_password() -> SecretString {
        SecretString::from("not the right password")
    }

    #[test]
    fn throttle_delay_doubles_and_caps_at_thirty_seconds() {
        assert_eq!(throttle_delay(0), None);
        assert_eq!(throttle_delay(2), None);
        assert_eq!(throttle_delay(3), Some(Duration::from_secs(1)));
        assert_eq!(throttle_delay(4), Some(Duration::from_secs(2)));
        assert_eq!(throttle_delay(5), Some(Duration::from_secs(4)));
        assert_eq!(throttle_delay(6), Some(Duration::from_secs(8)));
        assert_eq!(throttle_delay(7), Some(Duration::from_secs(16)));
        assert_eq!(throttle_delay(8), Some(Duration::from_secs(30)));
        assert_eq!(throttle_delay(9), Some(Duration::from_secs(30)));
        assert_eq!(throttle_delay(1000), Some(Duration::from_secs(30)));
    }

    #[test]
    fn unlock_is_throttled_after_three_wrong_passwords() {
        let dir = TestDir::new();
        let clock = FakeClock::new();
        let state = unlocked_state_with_clock(&dir, clock.clone());
        state.lock();

        for _ in 0..3 {
            assert_eq!(
                state.unlock(&wrong_password()),
                Err(VaultError::DecryptFailed)
            );
        }

        // The very next attempt is refused before it even tries the password, even if
        // the password is correct this time.
        assert_eq!(
            state.unlock(&password()),
            Err(VaultError::Throttled {
                seconds_remaining: 1
            })
        );
        assert!(!state.is_unlocked());

        // Waiting out the delay allows a real attempt again.
        clock.advance(Duration::from_secs(1));
        state.unlock(&password()).unwrap();
        assert!(state.is_unlocked());
    }

    #[test]
    fn throttled_attempts_do_not_run_argon2_or_extend_the_delay() {
        let dir = TestDir::new();
        let clock = FakeClock::new();
        let state = unlocked_state_with_clock(&dir, clock.clone());
        state.lock();

        for _ in 0..3 {
            state.unlock(&wrong_password()).unwrap_err();
        }
        // Several throttled attempts while the delay is active.
        for _ in 0..5 {
            assert_eq!(
                state.unlock(&wrong_password()),
                Err(VaultError::Throttled {
                    seconds_remaining: 1
                })
            );
        }

        clock.advance(Duration::from_secs(1));
        // A 4th real failure: if the throttled attempts above had counted, the delay
        // here would be based on 9 failures (30s), not 4 (2s).
        assert_eq!(
            state.unlock(&wrong_password()),
            Err(VaultError::DecryptFailed)
        );
        assert_eq!(
            state.unlock(&wrong_password()),
            Err(VaultError::Throttled {
                seconds_remaining: 2
            })
        );
    }

    #[test]
    fn successful_unlock_resets_the_throttle() {
        let dir = TestDir::new();
        let clock = FakeClock::new();
        let state = unlocked_state_with_clock(&dir, clock.clone());
        state.lock();

        for _ in 0..3 {
            state.unlock(&wrong_password()).unwrap_err();
        }
        clock.advance(Duration::from_secs(1));
        state.unlock(&password()).unwrap();
        state.lock();

        // A fresh cycle: exactly 3 wrong passwords give a 1s delay again, not more,
        // proving the earlier failures were forgotten.
        for _ in 0..3 {
            state.unlock(&wrong_password()).unwrap_err();
        }
        assert_eq!(
            state.unlock(&password()),
            Err(VaultError::Throttled {
                seconds_remaining: 1
            })
        );
    }

    #[test]
    fn unlock_failures_other_than_wrong_password_do_not_throttle() {
        let dir = TestDir::new();
        let clock = FakeClock::new();
        let state = unlocked_state_with_clock(&dir, clock.clone());
        state.lock();
        fs::write(dir.vault_path(), b"not a vault at all").unwrap();

        for _ in 0..5 {
            assert_eq!(state.unlock(&password()), Err(VaultError::InvalidFormat));
        }
        assert!(!matches!(
            state.unlock(&password()),
            Err(VaultError::Throttled { .. })
        ));
    }

    // --- Single-flight ---

    #[test]
    fn a_held_slot_rejects_unlock_and_create_vault_as_busy() {
        let dir = TestDir::new();
        let clock = FakeClock::new();
        let state = unlocked_state_with_clock(&dir, clock.clone());
        state.lock();

        let slot = state.enter_single_flight().unwrap();

        assert_eq!(state.unlock(&wrong_password()), Err(VaultError::Busy));
        assert_eq!(state.create_vault(&password()), Err(VaultError::Busy));
        assert_eq!(
            state.change_master_password(&password(), &password()),
            Err(VaultError::Busy)
        );
        assert_eq!(
            state.restore_from_backup(&password()),
            Err(VaultError::Busy)
        );
        // Neither call ran Argon2 or the throttle logic: no failure was recorded, and
        // the vault file (a fresh create would refuse to overwrite it) is untouched.
        assert_eq!(state.throttle_guard().consecutive_failures, 0);
        assert_eq!(state.check_throttle(clock.now()), None);

        drop(slot);
        state.unlock(&password()).unwrap();
        assert!(state.is_unlocked());
    }

    #[test]
    fn concurrent_unlock_attempts_respect_the_throttle() {
        let dir = TestDir::new();
        let clock = FakeClock::new();
        let state = Arc::new(unlocked_state_with_clock(&dir, clock.clone()));
        state.lock();

        // Several rounds of two threads racing for the single-flight slot. The loser of
        // each race is rejected as Busy near-instantly (try_lock never waits), so
        // normally exactly one real attempt gets through per round, but the assertions
        // below hold regardless of exactly how many do in any given round.
        let mut rounds: Vec<Vec<Result<()>>> = Vec::new();
        for _ in 0..6 {
            let barrier = Arc::new(std::sync::Barrier::new(2));
            let handles: Vec<_> = (0..2)
                .map(|_| {
                    let state = Arc::clone(&state);
                    let barrier = Arc::clone(&barrier);
                    std::thread::spawn(move || {
                        barrier.wait();
                        state.unlock(&wrong_password())
                    })
                })
                .collect();
            rounds.push(handles.into_iter().map(|h| h.join().unwrap()).collect());
        }

        let all_results: Vec<&Result<()>> = rounds.iter().flat_map(|round| round.iter()).collect();

        // Every attempt landed on one of the three expected outcomes.
        for result in &all_results {
            assert!(
                matches!(
                    result,
                    Err(VaultError::DecryptFailed)
                        | Err(VaultError::Busy)
                        | Err(VaultError::Throttled { .. })
                ),
                "unexpected result: {result:?}"
            );
        }

        // The throttle counted exactly the attempts that actually ran: Busy attempts
        // never touched it, and single-flight means no two real attempts could race on
        // updating it.
        let real_failures = all_results
            .iter()
            .filter(|r| matches!(r, Err(VaultError::DecryptFailed)))
            .count();
        assert_eq!(
            state.throttle_guard().consecutive_failures as usize,
            real_failures
        );

        // Once any round produces a Throttled result, no later round ever gets a real
        // attempt through as DecryptFailed: nothing bypasses an active throttle.
        let mut throttle_seen = false;
        for round in &rounds {
            if throttle_seen {
                assert!(
                    !round
                        .iter()
                        .any(|r| matches!(r, Err(VaultError::DecryptFailed))),
                    "a DecryptFailed happened after a throttle was already active: {round:?}"
                );
            }
            if round
                .iter()
                .any(|r| matches!(r, Err(VaultError::Throttled { .. })))
            {
                throttle_seen = true;
            }
        }
        assert!(
            throttle_seen,
            "the throttle never activated across 6 rounds: {all_results:?}"
        );
    }

    #[test]
    fn create_vault_and_unlock_share_the_single_flight_slot() {
        let dir = TestDir::new();
        let state = Arc::new(AppState::new(dir.vault_path()));
        let barrier = Arc::new(std::sync::Barrier::new(2));

        let state_a = Arc::clone(&state);
        let barrier_a = Arc::clone(&barrier);
        let create = std::thread::spawn(move || {
            barrier_a.wait();
            state_a.create_vault(&password())
        });

        let state_b = Arc::clone(&state);
        let barrier_b = Arc::clone(&barrier);
        let unlock = std::thread::spawn(move || {
            barrier_b.wait();
            state_b.unlock(&wrong_password())
        });

        let create_result = create.join().unwrap();
        let unlock_result = unlock.join().unwrap();

        // When the two calls overlap, one is rejected as Busy. When one finishes
        // before the other takes the slot, both run in sequence: create succeeds and
        // unlock then fails to decrypt, or unlock finds no file and create succeeds
        // afterwards. Either way they never both succeed, and at most one is Busy.
        let busy_count = [&create_result, &unlock_result]
            .into_iter()
            .filter(|r| matches!(r, Err(VaultError::Busy)))
            .count();
        assert!(busy_count <= 1, "{create_result:?} / {unlock_result:?}");
        assert!(
            create_result.is_ok() || matches!(create_result, Err(VaultError::Busy)),
            "{create_result:?}"
        );
        assert!(
            matches!(
                unlock_result,
                Err(VaultError::Busy)
                    | Err(VaultError::DecryptFailed)
                    | Err(VaultError::Io(std::io::ErrorKind::NotFound))
            ),
            "{unlock_result:?}"
        );
    }

    #[test]
    fn a_wrong_current_password_counts_toward_the_throttle() {
        let dir = TestDir::new();
        let clock = FakeClock::new();
        let state = fast_unlocked_with(&dir, clock.clone(), Arc::new(clipboard::OsClipboard));
        let replacement = SecretString::from("a brand new master password");

        for _ in 0..3 {
            assert_eq!(
                state.change_master_password(&wrong_password(), &replacement),
                Err(VaultError::DecryptFailed)
            );
        }
        assert_eq!(
            state.change_master_password(&password(), &replacement),
            Err(VaultError::Throttled {
                seconds_remaining: 1
            })
        );
        assert!(load_still_opens_with_original(&dir));
    }

    #[test]
    fn an_invalid_new_password_does_not_count_toward_the_throttle() {
        let dir = TestDir::new();
        let state = fast_unlocked(&dir);
        let err = state
            .change_master_password(&password(), &SecretString::from("too short"))
            .unwrap_err();
        assert!(matches!(err, VaultError::PasswordTooShort { .. }));
        assert_eq!(state.throttle_guard().consecutive_failures, 0);
        assert!(load_still_opens_with_original(&dir));
    }

    fn load_still_opens_with_original(dir: &TestDir) -> bool {
        vault::load(&dir.vault_path(), &password()).is_ok()
    }

    #[test]
    fn restore_refuses_while_unlocked() {
        let dir = TestDir::new();
        let state = fast_unlocked(&dir);
        assert_eq!(
            state.restore_from_backup(&password()),
            Err(VaultError::AlreadyUnlocked)
        );
        assert!(state.is_unlocked());
        assert!(!vault::pre_restore_path(&dir.vault_path()).exists());
    }

    #[test]
    fn a_missing_backup_does_not_throttle_or_move_the_vault() {
        let dir = TestDir::new();
        let state = fast_unlocked(&dir);
        state.lock();
        let before = fs::read(dir.vault_path()).unwrap();
        assert_eq!(
            state.restore_from_backup(&wrong_password()),
            Err(VaultError::Io(std::io::ErrorKind::NotFound))
        );
        assert_eq!(fs::read(dir.vault_path()).unwrap(), before);
        assert!(!vault::pre_restore_path(&dir.vault_path()).exists());
        assert_eq!(state.throttle_guard().consecutive_failures, 0);
    }

    #[test]
    fn a_wrong_restore_password_does_not_move_the_vault_and_counts_toward_the_throttle() {
        let dir = TestDir::new();
        let state = fast_unlocked(&dir);
        state.add_entry(input(1)).unwrap();
        state.add_entry(input(2)).unwrap();
        let current = fs::read(dir.vault_path()).unwrap();
        state.lock();

        assert_eq!(
            state.restore_from_backup(&wrong_password()),
            Err(VaultError::DecryptFailed)
        );
        assert_eq!(fs::read(dir.vault_path()).unwrap(), current);
        assert!(!vault::pre_restore_path(&dir.vault_path()).exists());
        assert_eq!(state.throttle_guard().consecutive_failures, 1);
        assert!(!state.is_unlocked());
    }

    #[test]
    fn clipboard_clears_only_the_generation_this_process_copied() {
        let dir = TestDir::new();
        let clipboard = Arc::new(clipboard::FakeClipboard::default());
        let state = fast_unlocked_with(
            &dir,
            Arc::new(SystemClock),
            Arc::clone(&clipboard) as Arc<dyn ConcealedClipboard>,
        );
        let added = state.add_entry(input(1)).unwrap();

        state.copy_password(&added.id).unwrap();
        let first = clipboard.current();
        state.copy_username(&added.id).unwrap();
        let second = clipboard.current();
        assert_ne!(first, second);

        clipboard.clear_if_unchanged(first).unwrap();
        assert_eq!(clipboard.current(), second);

        state.lock();
        assert!(!state.is_unlocked());
        assert_eq!(clipboard.current(), 0);
    }

    #[test]
    fn an_unsupported_clipboard_does_not_stop_lock() {
        struct UnsupportedClipboard;
        impl ConcealedClipboard for UnsupportedClipboard {
            fn copy_concealed(&self, _: &str) -> Result<u64> {
                Err(VaultError::Unsupported)
            }
            fn clear_if_unchanged(&self, _: u64) -> Result<()> {
                Err(VaultError::Unsupported)
            }
        }

        let dir = TestDir::new();
        let state = fast_unlocked_with(&dir, Arc::new(SystemClock), Arc::new(UnsupportedClipboard));
        let added = state.add_entry(input(1)).unwrap();
        assert_eq!(state.copy_password(&added.id), Err(VaultError::Unsupported));
        assert!(state.is_unlocked());
        state.lock();
        assert!(!state.is_unlocked());
    }

    // --- Poisoned lock ---

    #[test]
    fn poisoned_lock_clears_the_vault_instead_of_reusing_it() {
        let dir = TestDir::new();
        let state = Arc::new(unlocked_state(&dir));
        state.add_entry(input(1)).unwrap();
        assert!(state.is_unlocked());

        let poisoned = Arc::clone(&state);
        let handle = std::thread::spawn(move || {
            let _guard = poisoned.unlocked.lock().unwrap();
            panic!("simulated panic while holding the vault lock");
        });
        assert!(handle.join().is_err());

        assert!(!state.is_unlocked());
        assert_eq!(state.list_entries().err(), Some(VaultError::Locked));
        assert_eq!(state.get_password("any-id").err(), Some(VaultError::Locked));

        // The state still works normally afterwards.
        state.unlock(&password()).unwrap();
        assert_eq!(state.list_entries().unwrap().len(), 1);
    }
}
