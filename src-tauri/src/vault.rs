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
}

impl UnlockedVault {
    pub fn header(&self) -> &Header {
        &self.header
    }
}

/// Creates a new, empty vault at `path` using the default Argon2id params.
/// Refuses to overwrite an existing file.
pub fn create(path: &Path, password: &SecretString) -> Result<UnlockedVault> {
    create_with_params(path, password, KdfParams::default())
}

fn create_with_params(
    path: &Path,
    password: &SecretString,
    params: KdfParams,
) -> Result<UnlockedVault> {
    if path.exists() {
        return Err(VaultError::Io(io::ErrorKind::AlreadyExists));
    }
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
    let vault = UnlockedVault {
        header,
        key,
        data: VaultData::default(),
    };
    save(&vault, path)?;
    Ok(vault)
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

    Ok(UnlockedVault { header, key, data })
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
pub fn save(vault: &UnlockedVault, path: &Path) -> Result<()> {
    let plaintext =
        Zeroizing::new(serde_json::to_vec(&vault.data).map_err(|_| VaultError::InvalidFormat)?);
    let aad = aad_bytes(&vault.header)?;
    let (nonce, ciphertext) = crypto::encrypt(&vault.key, &aad, &plaintext)?;

    let file = VaultFile {
        version: vault.header.version,
        kdf: vault.header.kdf.clone(),
        cipher: CipherSection {
            alg: vault.header.cipher.alg.clone(),
            nonce: B64.encode(nonce),
        },
        ciphertext: B64.encode(ciphertext),
    };
    let bytes = serde_json::to_vec_pretty(&file).map_err(|_| VaultError::InvalidFormat)?;

    if path.exists() {
        let current = fs::read(path)?;
        if is_good_vault(&current, &vault.key) {
            write_atomic(&backup_path(path), &current)?;
        }
    }
    write_atomic(path, &bytes)
}

pub fn backup_path(path: &Path) -> PathBuf {
    sibling_with_suffix(path, ".bak")
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

fn write_and_sync(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut file = open_owner_only(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

#[cfg(unix)]
fn open_owner_only(path: &Path) -> io::Result<File> {
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    let file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)?;
    file.set_permissions(fs::Permissions::from_mode(0o600))?;
    Ok(file)
}

#[cfg(not(unix))]
fn open_owner_only(path: &Path) -> io::Result<File> {
    OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(path)
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

    const PASSWORD: &str = "correct horse battery staple";

    /// A unique temp directory, deleted when dropped.
    struct TestDir(PathBuf);

    impl TestDir {
        fn new() -> Self {
            let mut id = [0u8; 8];
            crypto::fill_random(&mut id).unwrap();
            let dir = std::env::temp_dir()
                .join(format!("quietkeys-test-{:016x}", u64::from_le_bytes(id)));
            fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }

        fn vault_path(&self) -> PathBuf {
            self.0.join(VAULT_FILE_NAME)
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

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
        save(&vault, &dir.vault_path()).unwrap();
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
        let vault = new_vault_with_entries(&dir);
        let path = dir.vault_path();
        let first = read_json(&path);
        save(&vault, &path).unwrap();
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
        assert!(save(&vault, &path).is_err());

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
        save(&vault, &path).unwrap();
        let backup = load(&backup_path(&path), &password()).unwrap();
        assert!(backup.data.entries.is_empty());

        vault.data.entries.push(sample_entry(2));
        save(&vault, &path).unwrap();
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
        save(&vault, &path).unwrap();
        let good_backup = fs::read(backup_path(&path)).unwrap();

        fs::write(&path, b"{ this is not a vault").unwrap();
        vault.data.entries.push(sample_entry(2));
        save(&vault, &path).unwrap();

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
        save(&vault, &path).unwrap();
        let good_backup = fs::read(backup_path(&path)).unwrap();

        let mut json = read_json(&path);
        json["kdf"]["t"] = Value::from(2);
        write_json(&path, &json);
        save(&vault, &path).unwrap();

        assert_eq!(fs::read(backup_path(&path)).unwrap(), good_backup);
    }

    #[test]
    fn vault_from_another_key_is_not_backed_up() {
        let dir = TestDir::new();
        let path = dir.vault_path();
        let vault = new_vault(&dir);

        let other_dir = TestDir::new();
        let other = create_with_params(
            &other_dir.vault_path(),
            &SecretString::from("a completely different password"),
            KdfParams::fast(),
        )
        .unwrap();
        save(&other, &path).unwrap();
        assert!(!backup_path(&path).exists());

        save(&vault, &path).unwrap();
        assert!(!backup_path(&path).exists());
        assert!(load(&path, &password()).is_ok());
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
        let vault = new_vault_with_entries(&dir);
        save(&vault, &dir.vault_path()).unwrap();
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

    #[cfg(unix)]
    #[test]
    fn vault_and_backup_are_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = TestDir::new();
        let vault = new_vault(&dir);
        save(&vault, &dir.vault_path()).unwrap();
        for path in [dir.vault_path(), backup_path(&dir.vault_path())] {
            let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600, "{}", path.display());
        }
    }
}
