//! The vault file format and safe load/save.
//!
//! On disk (section 4 of PLAN.md):
//! `{ version, kdf: { alg, m_kib, t, p, salt }, cipher: { alg, nonce }, ciphertext }`.
//! Everything except `cipher.nonce` and `ciphertext` is the header, and its serialized
//! bytes are the AAD for encryption, so any change to it makes decryption fail.

use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use secrecy::SecretString;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use crate::crypto::{self, KdfParams, Key, NONCE_LEN, SALT_LEN};
use crate::error::{Result, VaultError};

pub const FORMAT_VERSION: u32 = 1;
pub const KDF_ALG: &str = "argon2id";
pub const CIPHER_ALG: &str = "xchacha20poly1305";
pub const VAULT_FILE_NAME: &str = "vault.quietkeys";
pub const MIN_MASTER_PASSWORD_CHARS: usize = 12;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KdfHeader {
    pub alg: String,
    pub m_kib: u32,
    pub t: u32,
    pub p: u32,
    /// Base64 of the 16-byte salt.
    pub salt: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CipherHeader {
    pub alg: String,
}

/// The authenticated header. Field order is fixed by this struct, so serializing it always
/// produces the same bytes for the same values.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Header {
    pub version: u32,
    pub kdf: KdfHeader,
    pub cipher: CipherHeader,
}

impl Header {
    fn kdf_params(&self) -> KdfParams {
        KdfParams {
            m_kib: self.kdf.m_kib,
            t: self.kdf.t,
            p: self.kdf.p,
        }
    }
}

/// The exact bytes used as associated data.
pub fn aad_bytes(header: &Header) -> Result<Vec<u8>> {
    serde_json::to_vec(header).map_err(|_| VaultError::InvalidFormat)
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct CipherSection {
    alg: String,
    nonce: String,
}

/// The whole file as stored on disk.
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct VaultFile {
    version: u32,
    kdf: KdfHeader,
    cipher: CipherSection,
    ciphertext: String,
}

impl VaultFile {
    fn header(&self) -> Header {
        Header {
            version: self.version,
            kdf: self.kdf.clone(),
            cipher: CipherHeader {
                alg: self.cipher.alg.clone(),
            },
        }
    }
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
pub struct Entry {
    pub id: String,
    pub title: String,
    pub username: String,
    pub password: String,
    pub url: String,
    pub notes: String,
    pub created_at: String,
    pub updated_at: String,
}

impl fmt::Debug for Entry {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Entry")
            .field("id", &self.id)
            .field("title", &self.title)
            .field("username", &self.username)
            .field("password", &"<redacted>")
            .field("url", &self.url)
            .field("notes", &"<redacted>")
            .field("created_at", &self.created_at)
            .field("updated_at", &self.updated_at)
            .finish()
    }
}

/// The decrypted contents of a vault.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
pub struct VaultData {
    pub entries: Vec<Entry>,
}

/// A decrypted vault held in memory. The key and data are wiped when this is dropped.
pub struct UnlockedVault {
    header: Header,
    key: Key,
    pub data: VaultData,
    upgrade: Option<PendingUpgrade>,
}

/// A stronger header and key, prepared at unlock time (the only time the password is
/// available) and switched to on the next successful save.
struct PendingUpgrade {
    header: Header,
    key: Key,
}

impl UnlockedVault {
    pub fn header(&self) -> &Header {
        &self.header
    }

    /// True if the vault was unlocked with params weaker than the defaults and will be
    /// re-encrypted with a new salt and the default params on the next save.
    pub fn needs_upgrade(&self) -> bool {
        self.upgrade.is_some()
    }
}

/// Creates a new, empty vault at `path` using the default Argon2id params.
/// Refuses to overwrite an existing file.
pub fn create(path: &Path, password: &SecretString) -> Result<UnlockedVault> {
    create_with_params(path, password, KdfParams::default())
}

/// Rules for a new master password, applied to the normalized form: at least
/// `MIN_MASTER_PASSWORD_CHARS` Unicode characters (not bytes) and no control characters.
/// Not applied at unlock, so an existing password is never locked out by a rule change.
pub fn check_new_master_password(password: &SecretString) -> Result<()> {
    let normalized = crypto::normalize_password(password);
    if normalized.chars().any(char::is_control) {
        return Err(VaultError::PasswordHasControlCharacter);
    }
    if normalized.chars().count() < MIN_MASTER_PASSWORD_CHARS {
        return Err(VaultError::PasswordTooShort {
            min_chars: MIN_MASTER_PASSWORD_CHARS,
        });
    }
    Ok(())
}

pub(crate) fn create_with_params(
    path: &Path,
    password: &SecretString,
    params: KdfParams,
) -> Result<UnlockedVault> {
    check_new_master_password(password)?;
    // Early exit before the slow key derivation. `write_new` is the real guarantee.
    if path.exists() {
        return Err(VaultError::Io(io::ErrorKind::AlreadyExists));
    }
    let (header, key) = new_header_and_key(password, params)?;
    let vault = UnlockedVault {
        header,
        key,
        data: VaultData::default(),
        upgrade: None,
    };
    let bytes = encrypt_to_file_bytes(&vault.data, &vault.header, &vault.key)?;
    write_new(path, &bytes)?;
    Ok(vault)
}

/// A fresh salt, a key derived from it, and the matching header.
fn new_header_and_key(password: &SecretString, params: KdfParams) -> Result<(Header, Key)> {
    let salt = crypto::random_salt()?;
    let key = crypto::derive_key(password, &salt, &params)?;
    let header = Header {
        version: FORMAT_VERSION,
        kdf: KdfHeader {
            alg: KDF_ALG.to_string(),
            m_kib: params.m_kib,
            t: params.t,
            p: params.p,
            salt: B64.encode(salt),
        },
        cipher: CipherHeader {
            alg: CIPHER_ALG.to_string(),
        },
    };
    Ok((header, key))
}

fn prepare_upgrade(password: &SecretString, header: &Header) -> Result<Option<PendingUpgrade>> {
    let current = header.kdf_params();
    let target = current.raised_to(&KdfParams::default());
    if target == current {
        return Ok(None);
    }
    let (header, key) = new_header_and_key(password, target)?;
    Ok(Some(PendingUpgrade { header, key }))
}

/// Reads, authenticates and decrypts the vault at `path`.
pub fn load(path: &Path, password: &SecretString) -> Result<UnlockedVault> {
    let bytes = fs::read(path)?;
    let file = parse_vault_file(&bytes)?;
    let header = file.header();

    let salt: [u8; SALT_LEN] = decode_fixed(&header.kdf.salt)?;
    let key = crypto::derive_key(password, &salt, &header.kdf_params())?;
    let plaintext = decrypt_file(&file, &key)?;
    let data: VaultData =
        serde_json::from_slice(&plaintext).map_err(|_| VaultError::InvalidFormat)?;
    let upgrade = prepare_upgrade(password, &header)?;

    Ok(UnlockedVault {
        header,
        key,
        data,
        upgrade,
    })
}

/// Authenticates and decrypts a parsed file with an already-derived key.
fn decrypt_file(file: &VaultFile, key: &Key) -> Result<Zeroizing<Vec<u8>>> {
    let nonce: [u8; NONCE_LEN] = decode_fixed(&file.cipher.nonce)?;
    let ciphertext = B64
        .decode(&file.ciphertext)
        .map_err(|_| VaultError::InvalidFormat)?;
    let aad = aad_bytes(&file.header())?;
    crypto::decrypt(key, &nonce, &aad, &ciphertext)
}

/// True only if `bytes` is a well-formed vault that authenticates under `key`.
fn is_good_vault(bytes: &[u8], key: &Key) -> bool {
    parse_vault_file(bytes)
        .and_then(|file| decrypt_file(&file, key))
        .is_ok()
}

/// Encrypts the vault with a fresh nonce and writes it to `path` atomically.
///
/// Before writing, the current file is copied to `<path>.bak`, but only if it decrypts
/// with this vault's key. A corrupted or foreign file never replaces a good backup.
///
/// If an upgrade is pending, the new file uses the upgraded header and key, and the vault
/// switches to them once the write has succeeded.
pub fn save(vault: &mut UnlockedVault, path: &Path) -> Result<()> {
    let (header, key) = match &vault.upgrade {
        Some(upgrade) => (&upgrade.header, &upgrade.key),
        None => (&vault.header, &vault.key),
    };
    let bytes = encrypt_to_file_bytes(&vault.data, header, key)?;

    if path.exists() {
        let current = fs::read(path)?;
        if is_good_vault(&current, &vault.key) {
            write_atomic(&backup_path(path), &current)?;
        }
    }
    write_atomic(path, &bytes)?;

    if let Some(upgrade) = vault.upgrade.take() {
        vault.header = upgrade.header;
        vault.key = upgrade.key;
    }
    Ok(())
}

// Covers the JSON keys and punctuation of one entry (about 100 bytes) plus some escaping.
const JSON_OVERHEAD_PER_ENTRY: usize = 256;
const JSON_OVERHEAD_BASE: usize = 32;

fn estimated_json_len(data: &VaultData) -> usize {
    let fields: usize = data
        .entries
        .iter()
        .map(|e| {
            e.id.len()
                + e.title.len()
                + e.username.len()
                + e.password.len()
                + e.url.len()
                + e.notes.len()
                + e.created_at.len()
                + e.updated_at.len()
        })
        .sum();
    JSON_OVERHEAD_BASE + fields + data.entries.len() * JSON_OVERHEAD_PER_ENTRY
}

/// Serializes into a buffer sized up front, because every time a `Vec` grows it leaves
/// the old, unwiped allocation behind in freed memory.
fn serialize_data(data: &VaultData) -> Result<Zeroizing<Vec<u8>>> {
    let mut buf = Zeroizing::new(Vec::with_capacity(estimated_json_len(data)));
    serde_json::to_writer(&mut *buf, data).map_err(|_| VaultError::InvalidFormat)?;
    Ok(buf)
}

fn encrypt_to_file_bytes(data: &VaultData, header: &Header, key: &Key) -> Result<Vec<u8>> {
    let plaintext = serialize_data(data)?;
    let aad = aad_bytes(header)?;
    let (nonce, ciphertext) = crypto::encrypt(key, &aad, &plaintext)?;

    let file = VaultFile {
        version: header.version,
        kdf: header.kdf.clone(),
        cipher: CipherSection {
            alg: header.cipher.alg.clone(),
            nonce: B64.encode(nonce),
        },
        ciphertext: B64.encode(ciphertext),
    };
    serde_json::to_vec_pretty(&file).map_err(|_| VaultError::InvalidFormat)
}

pub fn backup_path(path: &Path) -> PathBuf {
    sibling_with_suffix(path, ".bak")
}

/// `vault.quietkeys.pre-restore`, next to the vault. Holds the file that a restore replaced.
pub fn pre_restore_path(path: &Path) -> PathBuf {
    sibling_with_suffix(path, ".pre-restore")
}

/// Replaces the master password.
///
/// The current password is checked by deriving its key and decrypting the file (a mismatch
/// is `DecryptFailed`). The new password must pass [`check_new_master_password`]. The new
/// file uses a new salt and `params`. Any pending KDF upgrade is dropped, because this
/// write already uses the parameters the caller asked for.
///
/// The backup is not updated here. [`change_master_password`] copies the new file over it
/// immediately afterwards. A crash in between leaves the previous password able to open
/// the backup until the next successful [`save`], which copies the current file over it.
pub(crate) fn apply_new_master_key(
    vault: &mut UnlockedVault,
    path: &Path,
    current: &SecretString,
    new_password: &SecretString,
    params: KdfParams,
) -> Result<()> {
    let bytes = fs::read(path)?;
    let file = parse_vault_file(&bytes)?;
    let header = file.header();
    let salt: [u8; SALT_LEN] = decode_fixed(&header.kdf.salt)?;
    let derived = crypto::derive_key(current, &salt, &header.kdf_params())?;
    decrypt_file(&file, &derived)?;

    check_new_master_password(new_password)?;
    let (header, key) = new_header_and_key(new_password, params)?;
    let new_bytes = encrypt_to_file_bytes(&vault.data, &header, &key)?;
    write_atomic(path, &new_bytes)?;

    vault.header = header;
    vault.key = key;
    vault.upgrade = None;
    Ok(())
}

/// [`apply_new_master_key`] with the default Argon2 parameters, then copies that new file
/// over the backup so the previous password cannot open either file.
pub fn change_master_password(
    vault: &mut UnlockedVault,
    path: &Path,
    current: &SecretString,
    new_password: &SecretString,
) -> Result<()> {
    apply_new_master_key(vault, path, current, new_password, KdfParams::default())?;
    let current_bytes = fs::read(path)?;
    if !is_good_vault(&current_bytes, &vault.key) {
        return Err(VaultError::Crypto);
    }
    write_atomic(&backup_path(path), &current_bytes)?;
    Ok(())
}

/// Copies the encrypted vault file to `dest`. Refuses to overwrite anything, including
/// the vault and its backup, because both already exist. Never decrypts.
pub fn export_encrypted(vault_path: &Path, dest: &Path) -> Result<()> {
    let bytes = fs::read(vault_path)?;
    write_new(dest, &bytes)
}

/// Decrypts the backup, moves the current vault aside to [`pre_restore_path`], then puts
/// the backup's bytes in its place. If the write fails, the moved file is put back.
/// Does not touch the current vault when the backup is missing or the password is wrong.
pub fn restore_replacing(vault_path: &Path, password: &SecretString) -> Result<UnlockedVault> {
    let bak_path = backup_path(vault_path);
    let bak_bytes = fs::read(&bak_path)?;
    let file = parse_vault_file(&bak_bytes)?;
    let header = file.header();
    let salt: [u8; SALT_LEN] = decode_fixed(&header.kdf.salt)?;
    let key = crypto::derive_key(password, &salt, &header.kdf_params())?;
    let plaintext = decrypt_file(&file, &key)?;
    let data: VaultData =
        serde_json::from_slice(&plaintext).map_err(|_| VaultError::InvalidFormat)?;
    let upgrade = prepare_upgrade(password, &header)?;

    let had_current = vault_path.exists();
    let aside = pre_restore_path(vault_path);
    if had_current {
        fs::rename(vault_path, &aside)?;
    }
    if let Err(err) = write_new(vault_path, &bak_bytes) {
        if had_current {
            let _ = fs::rename(&aside, vault_path);
        }
        return Err(err);
    }

    Ok(UnlockedVault {
        header,
        key,
        data,
        upgrade,
    })
}

fn temp_path(path: &Path) -> PathBuf {
    sibling_with_suffix(path, ".tmp")
}

fn sibling_with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(suffix);
    path.with_file_name(name)
}

/// Checks the version before parsing the rest, so a newer format is reported as
/// `UnsupportedVersion` rather than `InvalidFormat`.
fn parse_vault_file(bytes: &[u8]) -> Result<VaultFile> {
    let value: Value = serde_json::from_slice(bytes).map_err(|_| VaultError::InvalidFormat)?;
    let value = migrate(value)?;
    let file: VaultFile = serde_json::from_value(value).map_err(|_| VaultError::InvalidFormat)?;
    if file.kdf.alg != KDF_ALG || file.cipher.alg != CIPHER_ALG {
        return Err(VaultError::InvalidFormat);
    }
    Ok(file)
}

/// Upgrades an older file to the current format. Each future version bump adds an arm
/// here (with tests) that converts the previous version.
fn migrate(value: Value) -> Result<Value> {
    let version = value
        .get("version")
        .and_then(Value::as_u64)
        .ok_or(VaultError::InvalidFormat)?;
    let version = u32::try_from(version).map_err(|_| VaultError::InvalidFormat)?;
    match version {
        FORMAT_VERSION => Ok(value),
        other => Err(VaultError::UnsupportedVersion(other)),
    }
}

fn decode_fixed<const N: usize>(encoded: &str) -> Result<[u8; N]> {
    let bytes = B64.decode(encoded).map_err(|_| VaultError::InvalidFormat)?;
    bytes.try_into().map_err(|_| VaultError::InvalidFormat)
}

/// Writes to a temp file in the same directory, flushes it to disk, then renames it over
/// `path`. A crash at any point leaves either the old file or the new one, never a mix.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = temp_path(path);
    let result = write_and_sync(&tmp, bytes).and_then(|()| fs::rename(&tmp, path));
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result?;
    sync_parent_dir(path)?;
    Ok(())
}

/// Writes a brand-new file. Fails with `AlreadyExists` if anything is at `path`; the OS
/// checks this at the moment of creation, so there is no window for a race.
fn write_new(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut file = open_owner_only(path, OpenMode::CreateNew)?;
    let written = file.write_all(bytes).and_then(|()| file.sync_all());
    drop(file);
    if let Err(err) = written {
        // The file is ours (we just created it), so remove it rather than leave a partial vault.
        let _ = fs::remove_file(path);
        return Err(err.into());
    }
    sync_parent_dir(path)?;
    Ok(())
}

fn write_and_sync(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut file = open_owner_only(path, OpenMode::CreateOrTruncate)?;
    file.write_all(bytes)?;
    file.sync_all()
}

#[derive(Clone, Copy)]
enum OpenMode {
    CreateOrTruncate,
    CreateNew,
}

fn write_options(mode: OpenMode) -> OpenOptions {
    let mut options = OpenOptions::new();
    options.write(true);
    match mode {
        OpenMode::CreateOrTruncate => options.create(true).truncate(true),
        OpenMode::CreateNew => options.create_new(true),
    };
    options
}

#[cfg(unix)]
fn open_owner_only(path: &Path, mode: OpenMode) -> io::Result<File> {
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    let file = write_options(mode).mode(0o600).open(path)?;
    file.set_permissions(fs::Permissions::from_mode(0o600))?;
    Ok(file)
}

/// Windows has no mode bits: a new file inherits the access rules of its folder. This
/// relies on the vault living in the per-user app data folder, which only the user (plus
/// administrators and SYSTEM) can access by default.
#[cfg(not(unix))]
fn open_owner_only(path: &Path, mode: OpenMode) -> io::Result<File> {
    write_options(mode).open(path)
}

#[cfg(unix)]
fn sync_parent_dir(path: &Path) -> io::Result<()> {
    match path.parent() {
        Some(dir) if !dir.as_os_str().is_empty() => File::open(dir)?.sync_all(),
        _ => Ok(()),
    }
}

#[cfg(not(unix))]
fn sync_parent_dir(_path: &Path) -> io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::MIN_PARAMS;
    use crate::test_util::TestDir;

    const PASSWORD: &str = "correct horse battery staple";

    fn password() -> SecretString {
        SecretString::from(PASSWORD)
    }

    fn sample_entry(n: u32) -> Entry {
        Entry {
            id: format!("00000000-0000-4000-8000-{n:012}"),
            title: format!("Site {n}"),
            username: format!("user{n}@example.com"),
            password: format!("p@ss-{n}"),
            url: format!("https://site{n}.example.com"),
            notes: "some notes".to_string(),
            created_at: "2026-09-25T20:00:00Z".to_string(),
            updated_at: "2026-09-25T20:00:00Z".to_string(),
        }
    }

    fn new_vault(dir: &TestDir) -> UnlockedVault {
        create_with_params(&dir.vault_path(), &password(), KdfParams::fast()).unwrap()
    }

    fn new_vault_with_entries(dir: &TestDir) -> UnlockedVault {
        let mut vault = new_vault(dir);
        vault.data.entries.push(sample_entry(1));
        vault.data.entries.push(sample_entry(2));
        save(&mut vault, &dir.vault_path()).unwrap();
        vault
    }

    fn read_json(path: &Path) -> Value {
        serde_json::from_slice(&fs::read(path).unwrap()).unwrap()
    }

    fn write_json(path: &Path, value: &Value) {
        fs::write(path, serde_json::to_vec_pretty(value).unwrap()).unwrap();
    }

    fn load_err(path: &Path) -> VaultError {
        match load(path, &password()) {
            Ok(_) => panic!("load unexpectedly succeeded"),
            Err(err) => err,
        }
    }

    #[test]
    fn header_bytes_are_identical_after_round_trip() {
        let dir = TestDir::new();
        let vault = new_vault_with_entries(&dir);
        let original_aad = aad_bytes(vault.header()).unwrap();

        let file = parse_vault_file(&fs::read(dir.vault_path()).unwrap()).unwrap();
        let rebuilt_aad = aad_bytes(&file.header()).unwrap();
        assert_eq!(original_aad, rebuilt_aad);

        let reparsed: Header = serde_json::from_slice(&original_aad).unwrap();
        assert_eq!(aad_bytes(&reparsed).unwrap(), original_aad);
    }

    #[test]
    fn file_matches_documented_layout() {
        let dir = TestDir::new();
        new_vault(&dir);
        let json = read_json(&dir.vault_path());
        assert_eq!(json["version"], 1);
        assert_eq!(json["kdf"]["alg"], "argon2id");
        assert_eq!(json["cipher"]["alg"], "xchacha20poly1305");
        let salt = B64.decode(json["kdf"]["salt"].as_str().unwrap()).unwrap();
        let nonce = B64
            .decode(json["cipher"]["nonce"].as_str().unwrap())
            .unwrap();
        assert_eq!(salt.len(), 16);
        assert_eq!(nonce.len(), 24);
        assert!(json["ciphertext"].is_string());
    }

    #[test]
    fn round_trip_returns_identical_data() {
        let dir = TestDir::new();
        let vault = new_vault_with_entries(&dir);
        let loaded = load(&dir.vault_path(), &password()).unwrap();
        assert_eq!(loaded.data, vault.data);
        assert_eq!(loaded.header(), vault.header());
        assert_eq!(*loaded.key, *vault.key);
    }

    #[test]
    fn plaintext_is_not_visible_in_file() {
        let dir = TestDir::new();
        new_vault_with_entries(&dir);
        let raw = fs::read_to_string(dir.vault_path()).unwrap();
        assert!(!raw.contains("p@ss-1"));
        assert!(!raw.contains("user1@example.com"));
    }

    #[test]
    fn wrong_password_fails() {
        let dir = TestDir::new();
        new_vault_with_entries(&dir);
        let result = load(&dir.vault_path(), &SecretString::from("wrong password"));
        assert_eq!(result.err(), Some(VaultError::DecryptFailed));
    }

    #[test]
    fn changing_any_ciphertext_byte_fails() {
        let dir = TestDir::new();
        new_vault_with_entries(&dir);
        let path = dir.vault_path();
        let original = read_json(&path);
        let ciphertext = B64
            .decode(original["ciphertext"].as_str().unwrap())
            .unwrap();

        for i in 0..ciphertext.len() {
            let mut tampered = ciphertext.clone();
            tampered[i] ^= 0x01;
            let mut json = original.clone();
            json["ciphertext"] = Value::from(B64.encode(&tampered));
            write_json(&path, &json);
            assert_eq!(load_err(&path), VaultError::DecryptFailed, "byte {i}");
        }
    }

    #[test]
    fn changing_the_header_or_nonce_fails() {
        let dir = TestDir::new();
        new_vault_with_entries(&dir);
        let path = dir.vault_path();
        let original = read_json(&path);

        let other_salt = Value::from(B64.encode([9u8; SALT_LEN]));
        let other_nonce = Value::from(B64.encode([9u8; NONCE_LEN]));
        type Mutation = Box<dyn Fn(&mut Value)>;
        let cases: Vec<(&str, Mutation, VaultError)> = vec![
            (
                "salt",
                Box::new(move |j| j["kdf"]["salt"] = other_salt.clone()),
                VaultError::DecryptFailed,
            ),
            (
                "m_kib",
                Box::new(|j| j["kdf"]["m_kib"] = Value::from(128)),
                VaultError::DecryptFailed,
            ),
            (
                "t",
                Box::new(|j| j["kdf"]["t"] = Value::from(2)),
                VaultError::DecryptFailed,
            ),
            (
                "p",
                Box::new(|j| j["kdf"]["p"] = Value::from(2)),
                VaultError::DecryptFailed,
            ),
            (
                "nonce",
                Box::new(move |j| j["cipher"]["nonce"] = other_nonce.clone()),
                VaultError::DecryptFailed,
            ),
            (
                "version",
                Box::new(|j| j["version"] = Value::from(0)),
                VaultError::UnsupportedVersion(0),
            ),
            (
                "kdf alg",
                Box::new(|j| j["kdf"]["alg"] = Value::from("argon2i")),
                VaultError::InvalidFormat,
            ),
            (
                "cipher alg",
                Box::new(|j| j["cipher"]["alg"] = Value::from("chacha20poly1305")),
                VaultError::InvalidFormat,
            ),
            (
                "unknown field",
                Box::new(|j| j["kdf"]["extra"] = Value::from(1)),
                VaultError::InvalidFormat,
            ),
            (
                "huge m_kib",
                Box::new(|j| j["kdf"]["m_kib"] = Value::from(u32::MAX)),
                VaultError::InvalidKdfParams,
            ),
        ];

        for (name, mutate, expected) in cases {
            let mut json = original.clone();
            mutate(&mut json);
            write_json(&path, &json);
            assert_eq!(load_err(&path), expected, "{name}");
        }

        write_json(&path, &original);
        assert!(load(&path, &password()).is_ok());
    }

    #[test]
    fn unknown_version_is_rejected() {
        let dir = TestDir::new();
        new_vault(&dir);
        let path = dir.vault_path();
        let mut json = read_json(&path);
        json["version"] = Value::from(2);
        write_json(&path, &json);
        assert_eq!(load_err(&path), VaultError::UnsupportedVersion(2));
    }

    #[test]
    fn garbage_file_is_invalid_format() {
        let dir = TestDir::new();
        let path = dir.vault_path();
        fs::write(&path, b"not json at all").unwrap();
        assert_eq!(load_err(&path), VaultError::InvalidFormat);
    }

    #[test]
    fn two_saves_of_identical_data_differ() {
        let dir = TestDir::new();
        let mut vault = new_vault_with_entries(&dir);
        let path = dir.vault_path();
        let first = read_json(&path);
        save(&mut vault, &path).unwrap();
        let second = read_json(&path);

        assert_ne!(first["cipher"]["nonce"], second["cipher"]["nonce"]);
        assert_ne!(first["ciphertext"], second["ciphertext"]);
        assert_eq!(first["kdf"], second["kdf"]);
        assert_eq!(load(&path, &password()).unwrap().data, vault.data);
    }

    #[test]
    fn failed_save_leaves_old_vault_intact() {
        let dir = TestDir::new();
        let mut vault = new_vault_with_entries(&dir);
        let path = dir.vault_path();
        let before = fs::read(&path).unwrap();

        // A directory where the temp file should go makes the write fail.
        fs::create_dir(temp_path(&path)).unwrap();
        vault.data.entries.push(sample_entry(3));
        assert!(save(&mut vault, &path).is_err());

        assert_eq!(fs::read(&path).unwrap(), before);
        let loaded = load(&path, &password()).unwrap();
        assert_eq!(loaded.data.entries.len(), 2);
    }

    #[test]
    fn save_keeps_backup_of_previous_vault() {
        let dir = TestDir::new();
        let path = dir.vault_path();
        let mut vault = new_vault(&dir);
        assert!(!backup_path(&path).exists());

        vault.data.entries.push(sample_entry(1));
        save(&mut vault, &path).unwrap();
        let backup = load(&backup_path(&path), &password()).unwrap();
        assert!(backup.data.entries.is_empty());

        vault.data.entries.push(sample_entry(2));
        save(&mut vault, &path).unwrap();
        let backup = load(&backup_path(&path), &password()).unwrap();
        assert_eq!(backup.data.entries.len(), 1);
        assert_eq!(load(&path, &password()).unwrap().data.entries.len(), 2);
    }

    #[test]
    fn corrupted_vault_does_not_replace_good_backup() {
        let dir = TestDir::new();
        let path = dir.vault_path();
        let mut vault = new_vault(&dir);
        vault.data.entries.push(sample_entry(1));
        save(&mut vault, &path).unwrap();
        let good_backup = fs::read(backup_path(&path)).unwrap();

        fs::write(&path, b"{ this is not a vault").unwrap();
        vault.data.entries.push(sample_entry(2));
        save(&mut vault, &path).unwrap();

        assert_eq!(fs::read(backup_path(&path)).unwrap(), good_backup);
        let backup = load(&backup_path(&path), &password()).unwrap();
        assert!(backup.data.entries.is_empty());
        assert_eq!(load(&path, &password()).unwrap().data.entries.len(), 2);
    }

    #[test]
    fn tampered_vault_does_not_replace_good_backup() {
        let dir = TestDir::new();
        let path = dir.vault_path();
        let mut vault = new_vault(&dir);
        vault.data.entries.push(sample_entry(1));
        save(&mut vault, &path).unwrap();
        let good_backup = fs::read(backup_path(&path)).unwrap();

        let mut json = read_json(&path);
        json["kdf"]["t"] = Value::from(2);
        write_json(&path, &json);
        save(&mut vault, &path).unwrap();

        assert_eq!(fs::read(backup_path(&path)).unwrap(), good_backup);
    }

    #[test]
    fn vault_from_another_key_is_not_backed_up() {
        let dir = TestDir::new();
        let path = dir.vault_path();
        let mut vault = new_vault(&dir);

        let other_dir = TestDir::new();
        let mut other = create_with_params(
            &other_dir.vault_path(),
            &SecretString::from("a completely different password"),
            KdfParams::fast(),
        )
        .unwrap();
        save(&mut other, &path).unwrap();
        assert!(!backup_path(&path).exists());

        save(&mut vault, &path).unwrap();
        assert!(!backup_path(&path).exists());
        assert!(load(&path, &password()).is_ok());
    }

    #[test]
    fn weaker_vault_is_upgraded_to_defaults_on_next_save() {
        let dir = TestDir::new();
        let path = dir.vault_path();
        let weak = MIN_PARAMS;
        let mut created = create_with_params(&path, &password(), weak).unwrap();
        assert!(!created.needs_upgrade());
        created.data.entries.push(sample_entry(1));
        save(&mut created, &path).unwrap();

        let mut loaded = load(&path, &password()).unwrap();
        assert!(loaded.needs_upgrade());
        assert_eq!(loaded.header().kdf_params(), weak);
        let old_salt = loaded.header().kdf.salt.clone();
        assert_eq!(read_json(&path)["kdf"]["m_kib"], weak.m_kib);

        save(&mut loaded, &path).unwrap();
        assert!(!loaded.needs_upgrade());
        assert_eq!(loaded.header().kdf_params(), KdfParams::default());
        assert_ne!(loaded.header().kdf.salt, old_salt);

        let reloaded = load(&path, &password()).unwrap();
        assert!(!reloaded.needs_upgrade());
        assert_eq!(reloaded.header().kdf_params(), KdfParams::default());
        assert_eq!(reloaded.data, loaded.data);
        assert_eq!(
            load(&path, &SecretString::from("wrong password")).err(),
            Some(VaultError::DecryptFailed)
        );

        let backup = load(&backup_path(&path), &password()).unwrap();
        assert_eq!(backup.header().kdf_params(), weak);
        assert_eq!(backup.data, loaded.data);
    }

    #[test]
    fn failed_save_keeps_upgrade_pending() {
        let dir = TestDir::new();
        let path = dir.vault_path();
        create_with_params(&path, &password(), MIN_PARAMS).unwrap();
        let mut loaded = load(&path, &password()).unwrap();

        fs::create_dir(temp_path(&path)).unwrap();
        assert!(save(&mut loaded, &path).is_err());
        assert!(loaded.needs_upgrade());
        assert_eq!(loaded.header().kdf_params(), MIN_PARAMS);

        fs::remove_dir(temp_path(&path)).unwrap();
        save(&mut loaded, &path).unwrap();
        assert_eq!(loaded.header().kdf_params(), KdfParams::default());
        assert!(load(&path, &password()).is_ok());
    }

    #[test]
    fn vault_with_default_params_is_not_marked_for_upgrade() {
        let dir = TestDir::new();
        let path = dir.vault_path();
        create(&path, &password()).unwrap();
        let loaded = load(&path, &password()).unwrap();
        assert!(!loaded.needs_upgrade());
        assert_eq!(loaded.header().kdf_params(), KdfParams::default());
    }

    #[test]
    fn backup_and_temp_paths_sit_next_to_vault() {
        let path = Path::new("dir").join("vault.quietkeys");
        assert_eq!(
            backup_path(&path),
            Path::new("dir").join("vault.quietkeys.bak")
        );
        assert_eq!(
            temp_path(&path),
            Path::new("dir").join("vault.quietkeys.tmp")
        );
    }

    #[test]
    fn no_temp_files_left_after_save() {
        let dir = TestDir::new();
        let mut vault = new_vault_with_entries(&dir);
        save(&mut vault, &dir.vault_path()).unwrap();
        let mut names: Vec<String> = fs::read_dir(&dir.0)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        assert_eq!(names, ["vault.quietkeys", "vault.quietkeys.bak"]);
    }

    #[test]
    fn create_refuses_to_overwrite_existing_vault() {
        let dir = TestDir::new();
        new_vault_with_entries(&dir);
        let result = create_with_params(&dir.vault_path(), &password(), KdfParams::fast());
        assert_eq!(
            result.err(),
            Some(VaultError::Io(io::ErrorKind::AlreadyExists))
        );
        assert_eq!(
            load(&dir.vault_path(), &password())
                .unwrap()
                .data
                .entries
                .len(),
            2
        );
    }

    #[test]
    fn master_password_must_be_at_least_12_characters() {
        let dir = TestDir::new();
        let path = dir.vault_path();
        let result = create_with_params(
            &path,
            &SecretString::from("a".repeat(11)),
            KdfParams::fast(),
        );
        assert_eq!(
            result.err(),
            Some(VaultError::PasswordTooShort { min_chars: 12 })
        );
        assert!(!path.exists());

        let vault = create_with_params(
            &path,
            &SecretString::from("a".repeat(12)),
            KdfParams::fast(),
        );
        assert!(vault.is_ok());
    }

    #[test]
    fn master_password_length_counts_characters_not_bytes() {
        let eleven_multibyte = SecretString::from("é".repeat(11));
        assert_eq!(
            check_new_master_password(&eleven_multibyte),
            Err(VaultError::PasswordTooShort { min_chars: 12 })
        );
        assert!(check_new_master_password(&SecretString::from("é".repeat(12))).is_ok());
    }

    #[test]
    fn master_password_length_is_counted_after_normalization() {
        // 22 code points, but 11 characters once each e + accent is composed.
        let eleven_decomposed = SecretString::from("e\u{301}".repeat(11));
        assert_eq!(
            check_new_master_password(&eleven_decomposed),
            Err(VaultError::PasswordTooShort { min_chars: 12 })
        );
        assert!(check_new_master_password(&SecretString::from("e\u{301}".repeat(12))).is_ok());
    }

    #[test]
    fn new_master_password_with_control_character_is_rejected() {
        for pw in [
            "correct horse\tbattery",
            "correct horse\nbattery",
            "correct horse battery\u{7f}",
            "\u{0}correct horse battery",
            "correct horse\u{85}battery",
        ] {
            assert_eq!(
                check_new_master_password(&SecretString::from(pw)),
                Err(VaultError::PasswordHasControlCharacter),
                "{pw:?}"
            );
        }
        let dir = TestDir::new();
        let result = create_with_params(
            &dir.vault_path(),
            &SecretString::from("correct horse\tbattery"),
            KdfParams::fast(),
        );
        assert_eq!(result.err(), Some(VaultError::PasswordHasControlCharacter));
        assert!(!dir.vault_path().exists());
    }

    fn assert_created_with_unlocks_with(created_with: &str, unlocks_with: &str) {
        let dir = TestDir::new();
        let path = dir.vault_path();
        let mut vault =
            create_with_params(&path, &SecretString::from(created_with), KdfParams::fast())
                .unwrap();
        vault.data.entries.push(sample_entry(1));
        save(&mut vault, &path).unwrap();
        let loaded = load(&path, &SecretString::from(unlocks_with)).unwrap();
        assert_eq!(loaded.data, vault.data);
    }

    #[test]
    fn composed_accent_vault_unlocks_with_decomposed_accent() {
        assert_created_with_unlocks_with("caf\u{e9} au lait 2026", "cafe\u{301} au lait 2026");
    }

    #[test]
    fn decomposed_accent_vault_unlocks_with_composed_accent() {
        assert_created_with_unlocks_with("cafe\u{301} au lait 2026", "caf\u{e9} au lait 2026");
    }

    #[test]
    fn non_breaking_space_vault_unlocks_with_normal_space() {
        assert_created_with_unlocks_with("correct\u{a0}horse battery", "correct horse battery");
    }

    #[test]
    fn normal_space_vault_unlocks_with_non_breaking_space() {
        assert_created_with_unlocks_with("correct horse battery", "correct\u{a0}horse battery");
    }

    #[test]
    fn different_accents_still_fail_to_unlock() {
        let dir = TestDir::new();
        let path = dir.vault_path();
        create_with_params(
            &path,
            &SecretString::from("caf\u{e9} au lait 2026"),
            KdfParams::fast(),
        )
        .unwrap();
        let result = load(&path, &SecretString::from("caf\u{e8} au lait 2026"));
        assert_eq!(result.err(), Some(VaultError::DecryptFailed));
    }

    #[test]
    fn serialized_data_fits_the_preallocated_buffer() {
        let mut data = VaultData::default();
        assert!(serialize_data(&data).unwrap().len() <= estimated_json_len(&data));

        for n in 0..50 {
            let mut entry = sample_entry(n);
            entry.notes = "line one\nline \"two\"\t\\ tab".repeat(4);
            entry.title = "Ünïcödé títle 🔑".to_string();
            data.entries.push(entry);
        }
        let capacity = estimated_json_len(&data);
        let buf = serialize_data(&data).unwrap();
        assert!(buf.len() <= capacity, "{} > {}", buf.len(), capacity);
        assert_eq!(buf.capacity(), capacity);
        assert_eq!(&buf[..], &serde_json::to_vec(&data).unwrap()[..]);
    }

    #[test]
    fn write_new_never_overwrites_an_existing_file() {
        let dir = TestDir::new();
        let path = dir.vault_path();
        fs::write(&path, b"existing contents").unwrap();
        assert_eq!(
            write_new(&path, b"new contents").err(),
            Some(VaultError::Io(io::ErrorKind::AlreadyExists))
        );
        assert_eq!(fs::read(&path).unwrap(), b"existing contents");
    }

    #[test]
    fn create_writes_only_the_vault_file() {
        let dir = TestDir::new();
        new_vault(&dir);
        let names: Vec<String> = fs::read_dir(&dir.0)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, ["vault.quietkeys"]);
        assert!(load(&dir.vault_path(), &password()).is_ok());
    }

    #[test]
    fn missing_file_is_io_not_found() {
        let dir = TestDir::new();
        assert_eq!(
            load_err(&dir.vault_path()),
            VaultError::Io(io::ErrorKind::NotFound)
        );
    }

    #[test]
    fn entry_debug_output_redacts_secrets() {
        let debug = format!("{:?}", sample_entry(1));
        assert!(!debug.contains("p@ss-1"));
        assert!(!debug.contains("some notes"));
        assert!(debug.contains("<redacted>"));
    }

    #[test]
    fn rejected_new_master_password_leaves_the_file_unchanged() {
        let dir = TestDir::new();
        let mut vault = new_vault(&dir);
        let before = fs::read(dir.vault_path()).unwrap();
        let err = change_master_password(
            &mut vault,
            &dir.vault_path(),
            &password(),
            &SecretString::from("too short"),
        )
        .unwrap_err();
        assert!(matches!(err, VaultError::PasswordTooShort { .. }));
        assert_eq!(fs::read(dir.vault_path()).unwrap(), before);
        assert!(load(&dir.vault_path(), &password()).is_ok());
    }

    #[test]
    fn wrong_current_password_does_not_rekey() {
        let dir = TestDir::new();
        let mut vault = new_vault(&dir);
        let err = change_master_password(
            &mut vault,
            &dir.vault_path(),
            &SecretString::from("not the current one"),
            &SecretString::from("a brand new master password"),
        )
        .unwrap_err();
        assert_eq!(err, VaultError::DecryptFailed);
        assert!(load(&dir.vault_path(), &password()).is_ok());
    }

    #[test]
    fn crash_between_vault_and_backup_is_repaired_by_the_next_save() {
        let dir = TestDir::new();
        let path = dir.vault_path();
        let mut vault = new_vault_with_entries(&dir);
        let bak = backup_path(&path);
        let bak_before = fs::read(&bak).unwrap();
        let new_password = SecretString::from("a brand new master password");

        // The vault file is rekeyed and the backup is intentionally not. That is the
        // window a crash leaves behind.
        apply_new_master_key(
            &mut vault,
            &path,
            &password(),
            &new_password,
            KdfParams::fast(),
        )
        .unwrap();
        assert!(!vault.needs_upgrade());
        assert_eq!(fs::read(&bak).unwrap(), bak_before);
        assert!(load(&bak, &password()).is_ok());
        assert!(matches!(
            load(&path, &password()),
            Err(VaultError::DecryptFailed)
        ));

        save(&mut vault, &path).unwrap();
        assert!(matches!(
            load(&bak, &password()),
            Err(VaultError::DecryptFailed)
        ));
        assert!(matches!(
            load(&path, &password()),
            Err(VaultError::DecryptFailed)
        ));
        assert!(load(&bak, &new_password).is_ok());
        assert!(load(&path, &new_password).is_ok());
    }

    #[test]
    fn change_master_password_uses_default_params_and_retires_the_old_password() {
        let dir = TestDir::new();
        let path = dir.vault_path();
        let mut created = create_with_params(&path, &password(), KdfParams::fast()).unwrap();
        created.data.entries.push(sample_entry(1));
        save(&mut created, &path).unwrap();

        let mut vault = load(&path, &password()).unwrap();
        assert!(vault.needs_upgrade());
        let old_salt = vault.header().kdf.salt.clone();
        let new_password = SecretString::from("a brand new master password");
        change_master_password(&mut vault, &path, &password(), &new_password).unwrap();

        assert!(!vault.needs_upgrade());
        assert_ne!(vault.header().kdf.salt, old_salt);
        let defaults = KdfParams::default();
        assert_eq!(vault.header().kdf.m_kib, defaults.m_kib);
        assert_eq!(vault.header().kdf.t, defaults.t);
        assert_eq!(vault.header().kdf.p, defaults.p);

        let bak = backup_path(&path);
        assert!(matches!(
            load(&path, &password()),
            Err(VaultError::DecryptFailed)
        ));
        assert!(matches!(
            load(&bak, &password()),
            Err(VaultError::DecryptFailed)
        ));
        assert_eq!(load(&path, &new_password).unwrap().data.entries.len(), 1);
        assert!(load(&bak, &new_password).is_ok());
    }

    #[test]
    fn export_refuses_to_overwrite_and_stays_encrypted() {
        let dir = TestDir::new();
        let mut vault = new_vault_with_entries(&dir);
        let path = dir.vault_path();
        let dest = dir.0.join("copy.quietkeys");
        export_encrypted(&path, &dest).unwrap();
        assert_eq!(fs::read(&dest).unwrap(), fs::read(&path).unwrap());
        let exported = fs::read(&dest).unwrap();
        assert!(!exported
            .windows(b"p@ss-1".len())
            .any(|window| window == b"p@ss-1"));

        assert_eq!(
            export_encrypted(&path, &dest).unwrap_err(),
            VaultError::Io(io::ErrorKind::AlreadyExists)
        );
        assert_eq!(
            export_encrypted(&path, &path).unwrap_err(),
            VaultError::Io(io::ErrorKind::AlreadyExists)
        );
        save(&mut vault, &path).unwrap();
        assert_eq!(
            export_encrypted(&path, &backup_path(&path)).unwrap_err(),
            VaultError::Io(io::ErrorKind::AlreadyExists)
        );
    }

    #[test]
    fn a_mistaken_restore_can_be_undone_from_the_pre_restore_file() {
        let dir = TestDir::new();
        let path = dir.vault_path();
        let mut vault = new_vault(&dir);
        vault.data.entries.push(sample_entry(1));
        save(&mut vault, &path).unwrap();
        // The backup is the empty vault. The file now has the entry.
        vault.data.entries.push(sample_entry(2));
        save(&mut vault, &path).unwrap();
        let current = fs::read(&path).unwrap();

        let restored = restore_replacing(&path, &password()).unwrap();
        assert_eq!(restored.data.entries.len(), 1);
        assert_eq!(fs::read(pre_restore_path(&path)).unwrap(), current);

        // Putting the pre-restore file back undoes the restore.
        fs::rename(pre_restore_path(&path), &path).unwrap();
        let undone = load(&path, &password()).unwrap();
        assert_eq!(undone.data.entries.len(), 2);
    }

    #[test]
    fn a_wrong_restore_password_does_not_move_the_vault() {
        let dir = TestDir::new();
        let path = dir.vault_path();
        let _vault = new_vault_with_entries(&dir);
        let before = fs::read(&path).unwrap();
        let err = restore_replacing(&path, &SecretString::from("not the password"));
        assert!(matches!(err, Err(VaultError::DecryptFailed)));
        assert_eq!(fs::read(&path).unwrap(), before);
        assert!(!pre_restore_path(&path).exists());
    }

    #[test]
    fn a_missing_backup_is_not_found_and_leaves_the_vault() {
        let dir = TestDir::new();
        let path = dir.vault_path();
        let _vault = new_vault(&dir);
        let before = fs::read(&path).unwrap();
        let err = restore_replacing(&path, &password());
        assert!(matches!(err, Err(VaultError::Io(io::ErrorKind::NotFound))));
        assert_eq!(fs::read(&path).unwrap(), before);
        assert!(!pre_restore_path(&path).exists());
    }

    #[cfg(unix)]
    #[test]
    fn vault_and_backup_are_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = TestDir::new();
        let mut vault = new_vault(&dir);
        save(&mut vault, &dir.vault_path()).unwrap();
        for path in [dir.vault_path(), backup_path(&dir.vault_path())] {
            let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600, "{}", path.display());
        }
    }
}
