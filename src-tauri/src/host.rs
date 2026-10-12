//! The local socket the native host talks to, and the messages it is allowed to send.
//!
//! The native host holds no secrets. This side does. Pairing tokens are stored only as
//! SHA-256. A request is refused while the vault is locked, and a token that was revoked
//! is the same as one that was never issued.

use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread::JoinHandle;
use std::time::Duration;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use interprocess::local_socket::traits::Listener;
use serde::Deserialize;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::Manager;
use zeroize::{Zeroize, Zeroizing};

use crate::crypto;
use crate::error::{Result, VaultError};
use crate::state::AppState;

const MAX_MESSAGE: usize = 64 * 1024;
const PAIRINGS_FILE: &str = "pairings.json";
const MAX_PAIR_FAILURES: u8 = 5;

pub(crate) struct PendingPair {
    code: String,
    failures: u8,
}

pub(crate) struct PendingSave {
    pub url: String,
    pub username: String,
    pub password: Zeroizing<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingInfo {
    pub id: String,
    pub label: String,
    pub created_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingSaveInfo {
    pub host: String,
    pub username: String,
}

pub struct PairingCode(pub String);

impl Serialize for PairingCode {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredPairing {
    id: String,
    label: String,
    created_at: String,
    token_sha256: String,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum Request {
    Status {
        #[serde(default)]
        token: Option<String>,
    },
    Pair {
        code: String,
    },
    FindLogins {
        token: String,
        url: String,
    },
    GetLogin {
        token: String,
        id: String,
        url: String,
    },
    SaveLogin {
        token: String,
        url: String,
        username: String,
        #[serde(deserialize_with = "de_secret")]
        password: Zeroizing<String>,
    },
}

fn de_secret<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<Zeroizing<String>, D::Error> {
    let value = String::deserialize(deserializer)?;
    Ok(Zeroizing::new(value))
}

pub const NATIVE_HOST_NAME: &str = "com.quietkeys.native_host";

/// Chrome extension ids are 32 characters from a–p. Phase 9 replaces this placeholder.
pub const CHROME_EXTENSION_ID: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

pub fn windows_registry_key() -> &'static str {
    r"Software\Google\Chrome\NativeMessagingHosts\com.quietkeys.native_host"
}

/// Where Chrome looks for the host manifest. On Windows the registry points at the file.
pub fn chrome_manifest_path(home: &Path) -> PathBuf {
    let dir = if cfg!(target_os = "macos") {
        home.join("Library/Application Support/Google/Chrome/NativeMessagingHosts")
    } else if cfg!(windows) {
        home.join("AppData/Local/quietkeys")
    } else {
        home.join(".config/google-chrome/NativeMessagingHosts")
    };
    dir.join(format!("{NATIVE_HOST_NAME}.json"))
}

/// Manifest JSON. `allowed_origins` contains only this extension.
pub fn chrome_manifest(host_exe: &Path, extension_id: &str) -> Result<String> {
    if extension_id.len() != 32
        || !extension_id
            .bytes()
            .all(|byte| (b'a'..=b'p').contains(&byte))
    {
        return Err(VaultError::HostRejected);
    }
    let value = serde_json::json!({
        "name": NATIVE_HOST_NAME,
        "description": "quietkeys",
        "path": host_exe,
        "type": "stdio",
        "allowed_origins": [format!("chrome-extension://{extension_id}/")]
    });
    serde_json::to_string_pretty(&value).map_err(|_| VaultError::InvalidFormat)
}

pub fn write_chrome_manifest(dest: &Path, host_exe: &Path, extension_id: &str) -> Result<()> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = chrome_manifest(host_exe, extension_id)?;
    fs::write(dest, json)?;
    Ok(())
}

pub(crate) fn clear_pending(state: &AppState) {
    *state
        .pending_pair
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
    *state
        .pending_save
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
}

pub fn begin_pairing(state: &AppState) -> Result<PairingCode> {
    state.ensure_unlocked()?;
    let code = pairing_code()?;
    *pair_guard(&state.pending_pair) = Some(PendingPair {
        code: code.clone(),
        failures: 0,
    });
    Ok(PairingCode(code))
}

pub fn list_pairings(state: &AppState) -> Result<Vec<PairingInfo>> {
    state.ensure_unlocked()?;
    Ok(read_pairings(state.data_dir())
        .into_iter()
        .map(|pairing| PairingInfo {
            id: pairing.id,
            label: pairing.label,
            created_at: pairing.created_at,
        })
        .collect())
}

pub fn revoke_pairing(state: &AppState, id: &str) -> Result<()> {
    state.ensure_unlocked()?;
    let mut pairings = read_pairings(state.data_dir());
    let before = pairings.len();
    pairings.retain(|pairing| pairing.id != id);
    if pairings.len() == before {
        return Err(VaultError::EntryNotFound);
    }
    write_pairings(state.data_dir(), &pairings)?;
    Ok(())
}

pub fn pending_save(state: &AppState) -> Result<Option<PendingSaveInfo>> {
    state.ensure_unlocked()?;
    let guard = save_guard(&state.pending_save);
    Ok(guard.as_ref().map(|pending| PendingSaveInfo {
        host: crate::domain::display_host(&pending.url).unwrap_or_default(),
        username: pending.username.clone(),
    }))
}

pub fn confirm_pending_save(state: &AppState) -> Result<()> {
    state.ensure_unlocked()?;
    let pending = save_guard(&state.pending_save)
        .take()
        .ok_or(VaultError::HostRejected)?;
    state.add_login_from_host(pending.url, pending.username, pending.password.to_string())
}

pub fn dismiss_pending_save(state: &AppState) -> Result<()> {
    state.ensure_unlocked()?;
    *save_guard(&state.pending_save) = None;
    Ok(())
}

/// One request in, one reply out. Used by the native host and by tests.
pub fn transact(endpoint: &str, request: &[u8]) -> io::Result<Vec<u8>> {
    let name = socket_name(endpoint)?;
    let mut stream = interprocess::local_socket::ConnectOptions::new()
        .name(name)
        .wait_mode(interprocess::ConnectWaitMode::Timeout(Duration::from_secs(
            2,
        )))
        .connect_sync()?;
    write_frame(&mut stream, request)?;
    read_frame(&mut stream).map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "frame"))
}

pub fn serve(endpoint: &str, state: &AppState, shutdown: &AtomicBool) -> io::Result<()> {
    let listener = bind(endpoint)?;
    while !shutdown.load(Ordering::Relaxed) {
        let mut connection = listener.accept()?;
        let _ = exchange(&mut connection, state);
    }
    Ok(())
}

pub struct Serving {
    shutdown: std::sync::Arc<AtomicBool>,
    endpoint: String,
    thread: Option<JoinHandle<()>>,
}

impl Serving {
    pub fn spawn(endpoint: String, state: std::sync::Arc<AppState>) -> Self {
        let shutdown = std::sync::Arc::new(AtomicBool::new(false));
        let flag = std::sync::Arc::clone(&shutdown);
        let endpoint_thread = endpoint.clone();
        let thread = std::thread::spawn(move || {
            let _ = serve(&endpoint_thread, &state, &flag);
        });
        let serving = Self {
            shutdown,
            endpoint,
            thread: Some(thread),
        };
        for _ in 0..50 {
            if transact(&serving.endpoint, br#"{"type":"status"}"#).is_ok() {
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        serving
    }
}

impl Drop for Serving {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::Relaxed);
        let _ = transact(&self.endpoint, br#"{"type":"status"}"#);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// Reads native-messaging frames from stdin and relays each one. Holds nothing.
pub fn run_stdio() -> i32 {
    let endpoint = std::env::var("QUIETKEYS_IPC").unwrap_or_else(|_| default_endpoint());
    let mut input = io::stdin().lock();
    let mut output = io::stdout().lock();
    loop {
        let mut request = match read_frame(&mut input) {
            Ok(bytes) => bytes,
            Err(FrameError::End) => return 0,
            Err(FrameError::Rejected) => {
                let _ = write_frame(&mut output, br#"{"error":"rejected"}"#);
                return 1;
            }
        };
        let mut reply = transact(&endpoint, &request)
            .unwrap_or_else(|_| br#"{"error":"unavailable"}"#.to_vec());
        request.zeroize();
        let wrote = write_frame(&mut output, &reply);
        reply.zeroize();
        if wrote.is_err() {
            return 1;
        }
    }
}

pub fn default_endpoint() -> String {
    #[cfg(windows)]
    {
        user_pipe_name()
    }
    #[cfg(not(windows))]
    {
        user_data_dir()
            .join("quietkeys-host.sock")
            .to_string_lossy()
            .into_owned()
    }
}

pub fn spawn_for_app(app: tauri::AppHandle) {
    std::thread::Builder::new()
        .name("quietkeys-host".into())
        .spawn(move || {
            let endpoint = default_endpoint();
            let listener = match bind(&endpoint) {
                Ok(listener) => listener,
                Err(_) => return,
            };
            loop {
                let Ok(mut connection) = listener.accept() else {
                    continue;
                };
                let state = app.state::<AppState>();
                let _ = exchange(&mut connection, &state);
            }
        })
        .ok();
}

fn exchange(connection: &mut impl ReadWrite, state: &AppState) -> io::Result<()> {
    let mut request = match read_frame(connection) {
        Ok(bytes) => bytes,
        Err(FrameError::End) => return Ok(()),
        Err(FrameError::Rejected) => {
            let _ = write_frame(connection, br#"{"error":"rejected"}"#);
            return Ok(());
        }
    };
    let mut reply = dispatch(state, &request);
    request.zeroize();
    let result = write_frame(connection, &reply);
    reply.zeroize();
    result
}

fn dispatch(state: &AppState, bytes: &[u8]) -> Vec<u8> {
    let request: Request = match serde_json::from_slice(bytes) {
        Ok(request) => request,
        Err(_) => return error_body("rejected"),
    };
    let value = match request {
        Request::Status { token } => status(state, token.as_deref()),
        Request::Pair { code } => pair(state, &code),
        Request::FindLogins { token, url } => find_logins(state, &token, &url),
        Request::GetLogin { token, id, url } => get_login(state, &token, &id, &url),
        Request::SaveLogin {
            token,
            url,
            username,
            password,
        } => save_login(state, &token, url, username, password),
    };
    serde_json::to_vec(&value).unwrap_or_else(|_| error_body("rejected"))
}

fn status(state: &AppState, token: Option<&str>) -> serde_json::Value {
    if !state.is_unlocked() {
        return serde_json::json!({"status": "locked"});
    }
    let paired = token.is_some_and(|token| token_known(state, token));
    if paired {
        serde_json::json!({"status": "unlocked"})
    } else {
        serde_json::json!({"status": "not_paired"})
    }
}

fn pair(state: &AppState, code: &str) -> serde_json::Value {
    if !state.is_unlocked() {
        return serde_json::json!({"error": "locked"});
    }
    let mut pending = pair_guard(&state.pending_pair);
    let Some(current) = pending.as_mut() else {
        return serde_json::json!({"error": "rejected"});
    };
    if !code_matches(&current.code, code) {
        current.failures = current.failures.saturating_add(1);
        if current.failures >= MAX_PAIR_FAILURES {
            *pending = None;
        }
        return serde_json::json!({"error": "rejected"});
    }
    *pending = None;
    drop(pending);
    match issue_token(state) {
        Ok(token) => serde_json::json!({"token": token}),
        Err(_) => serde_json::json!({"error": "rejected"}),
    }
}

fn find_logins(state: &AppState, token: &str, url: &str) -> serde_json::Value {
    if let Some(error) = gate(state, token) {
        return error;
    }
    match state.host_matches(url) {
        Ok(logins) => serde_json::json!({
            "logins": logins.into_iter().map(|login| serde_json::json!({
                "id": login.id,
                "title": login.title,
                "username": login.username,
            })).collect::<Vec<_>>()
        }),
        Err(_) => serde_json::json!({"error": "rejected"}),
    }
}

fn get_login(state: &AppState, token: &str, id: &str, url: &str) -> serde_json::Value {
    if let Some(error) = gate(state, token) {
        return error;
    }
    match state.host_login(id, url) {
        Ok(login) => serde_json::json!({
            "username": login.username,
            "password": login.password.as_str(),
        }),
        Err(VaultError::Locked) => serde_json::json!({"error": "locked"}),
        Err(_) => serde_json::json!({"error": "rejected"}),
    }
}

fn save_login(
    state: &AppState,
    token: &str,
    url: String,
    username: String,
    password: Zeroizing<String>,
) -> serde_json::Value {
    if let Some(error) = gate(state, token) {
        return error;
    }
    if crate::domain::display_host(&url).is_none() || username.len() > 512 || password.len() > 4096
    {
        return serde_json::json!({"error": "rejected"});
    }
    let mut pending = save_guard(&state.pending_save);
    if pending.is_some() {
        return serde_json::json!({"error": "rejected"});
    }
    *pending = Some(PendingSave {
        url,
        username,
        password,
    });
    serde_json::json!({"status": "pending"})
}

fn gate(state: &AppState, token: &str) -> Option<serde_json::Value> {
    if !state.is_unlocked() {
        return Some(serde_json::json!({"error": "locked"}));
    }
    if !token_known(state, token) {
        return Some(serde_json::json!({"error": "not_paired"}));
    }
    None
}

fn issue_token(state: &AppState) -> Result<String> {
    let mut bytes = [0u8; 32];
    crypto::fill_random(&mut bytes)?;
    let token = B64.encode(bytes);
    let mut pairings = read_pairings(state.data_dir());
    pairings.push(StoredPairing {
        id: uuid::Uuid::new_v4().to_string(),
        label: format!("Browser {}", pairings.len() + 1),
        created_at: time::OffsetDateTime::now_utc()
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string()),
        token_sha256: hex(&Sha256::digest(bytes)),
    });
    write_pairings(state.data_dir(), &pairings)?;
    bytes.zeroize();
    Ok(token)
}

fn token_known(state: &AppState, token: &str) -> bool {
    if token.len() > 64 {
        return false;
    }
    let Ok(raw) = B64.decode(token) else {
        return false;
    };
    if raw.len() != 32 {
        return false;
    }
    let digest = hex(&Sha256::digest(&raw));
    read_pairings(state.data_dir())
        .into_iter()
        .any(|pairing| constant_eq(pairing.token_sha256.as_bytes(), digest.as_bytes()))
}

fn read_pairings(dir: &Path) -> Vec<StoredPairing> {
    let Ok(bytes) = fs::read(dir.join(PAIRINGS_FILE)) else {
        return Vec::new();
    };
    serde_json::from_slice(&bytes).unwrap_or_default()
}

fn write_pairings(dir: &Path, pairings: &[StoredPairing]) -> Result<()> {
    fs::create_dir_all(dir)?;
    let bytes = serde_json::to_vec(pairings).map_err(|_| VaultError::InvalidFormat)?;
    let tmp = dir.join("pairings.json.tmp");
    let path = dir.join(PAIRINGS_FILE);
    fs::write(&tmp, &bytes)?;
    fs::rename(&tmp, &path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

fn pairing_code() -> Result<String> {
    let limit = (u32::MAX / 1_000_000) * 1_000_000;
    loop {
        let mut bytes = [0u8; 4];
        crypto::fill_random(&mut bytes)?;
        let value = u32::from_le_bytes(bytes);
        if value < limit {
            return Ok(format!("{:06}", value % 1_000_000));
        }
    }
}

fn code_matches(expected: &str, given: &str) -> bool {
    constant_eq(expected.as_bytes(), given.as_bytes())
}

fn constant_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    let mut diff = 0u8;
    for (a, b) in left.iter().zip(right.iter()) {
        diff |= a ^ b;
    }
    diff == 0
}

fn hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

fn error_body(error: &str) -> Vec<u8> {
    format!(r#"{{"error":"{error}"}}"#).into_bytes()
}

enum FrameError {
    End,
    Rejected,
}

fn read_frame(reader: &mut impl Read) -> std::result::Result<Vec<u8>, FrameError> {
    let mut len_buf = [0u8; 4];
    if let Err(err) = reader.read_exact(&mut len_buf) {
        return Err(if err.kind() == io::ErrorKind::UnexpectedEof {
            FrameError::End
        } else {
            FrameError::Rejected
        });
    }
    let len = u32::from_le_bytes(len_buf) as usize;
    if len == 0 || len > MAX_MESSAGE {
        return Err(FrameError::Rejected);
    }
    let mut body = vec![0u8; len];
    reader
        .read_exact(&mut body)
        .map_err(|_| FrameError::Rejected)?;
    Ok(body)
}

fn write_frame(writer: &mut impl Write, body: &[u8]) -> io::Result<()> {
    let len = u32::try_from(body.len())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "large"))?;
    if len as usize > MAX_MESSAGE {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "large"));
    }
    writer.write_all(&len.to_le_bytes())?;
    writer.write_all(body)?;
    writer.flush()
}

trait ReadWrite: Read + Write {}
impl<T: Read + Write> ReadWrite for T {}

fn pair_guard(
    mutex: &Mutex<Option<PendingPair>>,
) -> std::sync::MutexGuard<'_, Option<PendingPair>> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn save_guard(
    mutex: &Mutex<Option<PendingSave>>,
) -> std::sync::MutexGuard<'_, Option<PendingSave>> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(windows)]
fn user_pipe_name() -> String {
    let user = std::env::var("USERNAME").unwrap_or_else(|_| "user".to_string());
    let digest = Sha256::digest(user.as_bytes());
    format!(
        "quietkeys-{:02x}{:02x}{:02x}{:02x}",
        digest[0], digest[1], digest[2], digest[3]
    )
}

#[cfg(not(windows))]
fn user_data_dir() -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        home().join("Library/Application Support/com.quietkeys.app")
    }
    #[cfg(not(target_os = "macos"))]
    {
        if let Some(xdg) = std::env::var_os("XDG_DATA_HOME") {
            PathBuf::from(xdg).join("com.quietkeys.app")
        } else {
            home().join(".local/share/com.quietkeys.app")
        }
    }
}

#[cfg(not(windows))]
fn home() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn socket_name(endpoint: &str) -> io::Result<interprocess::local_socket::Name<'_>> {
    #[cfg(windows)]
    {
        use interprocess::local_socket::ToNsName;
        endpoint.to_ns_name::<interprocess::local_socket::GenericNamespaced>()
    }
    #[cfg(not(windows))]
    {
        use interprocess::local_socket::ToFsName;
        Path::new(endpoint).to_fs_name::<interprocess::local_socket::GenericFilePath>()
    }
}

fn bind(endpoint: &str) -> io::Result<interprocess::local_socket::Listener> {
    #[cfg(windows)]
    {
        use interprocess::os::windows::local_socket::ListenerOptionsExt;
        use interprocess::os::windows::security_descriptor::SecurityDescriptor;
        use widestring::U16CString;
        let text = U16CString::from_str("D:P(A;;GA;;;OW)")
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "sddl"))?;
        let descriptor = SecurityDescriptor::deserialize(text.as_ucstr())?;
        interprocess::local_socket::ListenerOptions::new()
            .name(socket_name(endpoint)?)
            .security_descriptor(descriptor)
            .create_sync()
    }
    #[cfg(not(windows))]
    {
        let path = Path::new(endpoint);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = fs::set_permissions(parent, fs::Permissions::from_mode(0o700));
            }
        }
        let _ = fs::remove_file(path);
        let listener = interprocess::local_socket::ListenerOptions::new()
            .name(socket_name(endpoint)?)
            .create_sync()?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
        }
        Ok(listener)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::TestDir;
    use std::sync::Arc;

    fn endpoint(dir: &TestDir) -> String {
        #[cfg(windows)]
        {
            let _ = dir;
            format!("quietkeys-test-{}", uuid::Uuid::new_v4().simple())
        }
        #[cfg(not(windows))]
        {
            dir.0.join("host.sock").to_string_lossy().into_owned()
        }
    }

    fn request(value: serde_json::Value) -> Vec<u8> {
        serde_json::to_vec(&value).unwrap()
    }

    #[test]
    fn malformed_and_oversized_frames_are_rejected() {
        let dir = TestDir::new();
        let state = Arc::new(AppState::fast_testing_vault(&dir.0));
        let endpoint = endpoint(&dir);
        let serving = Serving::spawn(endpoint.clone(), Arc::clone(&state));
        let bad = transact(&endpoint, b"not-json-but-short").expect("server up");
        assert_eq!(bad, br#"{"error":"rejected"}"#);
        let mut huge = Vec::new();
        huge.extend_from_slice(&1_000_000u32.to_le_bytes());
        let err = transact_raw(&endpoint, &huge);
        assert!(
            err.is_err()
                || err
                    .ok()
                    .is_some_and(|body| body == br#"{"error":"rejected"}"#)
        );
        drop(serving);
    }

    fn transact_raw(endpoint: &str, bytes: &[u8]) -> io::Result<Vec<u8>> {
        let name = socket_name(endpoint)?;
        let mut stream = interprocess::local_socket::ConnectOptions::new()
            .name(name)
            .wait_mode(interprocess::ConnectWaitMode::Timeout(Duration::from_secs(
                2,
            )))
            .connect_sync()?;
        stream.write_all(bytes)?;
        read_frame(&mut stream).map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "frame"))
    }

    #[test]
    fn native_host_pairs_and_finds_logins_without_passwords() {
        let dir = TestDir::new();
        let state = Arc::new(AppState::fast_testing_vault(&dir.0));
        state
            .add_entry(crate::state::EntryInput {
                title: "Mail".into(),
                username: "ada@example.com".into(),
                password: "fixture-mail-secret".into(),
                url: "https://google.com/login".into(),
                notes: String::new(),
            })
            .unwrap();
        let endpoint = endpoint(&dir);
        let serving = Serving::spawn(endpoint.clone(), Arc::clone(&state));
        let code = begin_pairing(&state).unwrap().0;
        let paired = transact(
            &endpoint,
            &request(serde_json::json!({"type": "pair", "code": code})),
        )
        .unwrap();
        let paired: serde_json::Value = serde_json::from_slice(&paired).unwrap();
        let token = paired["token"].as_str().unwrap().to_string();
        assert!(!fs::read(dir.0.join(PAIRINGS_FILE))
            .unwrap()
            .windows(token.len())
            .any(|window| window == token.as_bytes()));

        let found = transact(
            &endpoint,
            &request(serde_json::json!({
                "type": "find_logins",
                "token": token,
                "url": "https://accounts.google.com/ServiceLogin"
            })),
        )
        .unwrap();
        let text = String::from_utf8(found.clone()).unwrap();
        assert!(text.contains("Mail"));
        assert!(text.contains("ada@example.com"));
        assert!(!text.contains("fixture-mail-secret"));

        let wrong = transact(
            &endpoint,
            &request(serde_json::json!({
                "type": "find_logins",
                "token": token,
                "url": "https://google.com.evil.io/login"
            })),
        )
        .unwrap();
        let wrong: serde_json::Value = serde_json::from_slice(&wrong).unwrap();
        assert!(wrong["logins"].as_array().unwrap().is_empty());

        state.lock();
        let locked = transact(
            &endpoint,
            &request(serde_json::json!({
                "type": "find_logins",
                "token": token,
                "url": "https://google.com/"
            })),
        )
        .unwrap();
        assert_eq!(locked, br#"{"error":"locked"}"#);
        let status = transact(
            &endpoint,
            &request(serde_json::json!({"type": "status", "token": token})),
        )
        .unwrap();
        assert_eq!(status, br#"{"status":"locked"}"#);

        drop(serving);
        let _ = found;
    }

    #[test]
    fn revoked_and_unknown_tokens_are_rejected_and_http_is_not_filled() {
        let dir = TestDir::new();
        let state = Arc::new(AppState::fast_testing_vault(&dir.0));
        let summary = state
            .add_entry(crate::state::EntryInput {
                title: "Local".into(),
                username: "root".into(),
                password: "http-only-secret".into(),
                url: "https://127.0.0.1/".into(),
                notes: String::new(),
            })
            .unwrap();
        let endpoint = endpoint(&dir);
        let serving = Serving::spawn(endpoint.clone(), Arc::clone(&state));
        let code = begin_pairing(&state).unwrap().0;
        let paired: serde_json::Value = serde_json::from_slice(
            &transact(
                &endpoint,
                &request(serde_json::json!({"type": "pair", "code": code})),
            )
            .unwrap(),
        )
        .unwrap();
        let token = paired["token"].as_str().unwrap();
        let id = list_pairings(&state).unwrap()[0].id.clone();
        revoke_pairing(&state, &id).unwrap();
        let revoked = transact(
            &endpoint,
            &request(serde_json::json!({
                "type": "get_login",
                "token": token,
                "id": summary.id,
                "url": "https://127.0.0.1/"
            })),
        )
        .unwrap();
        let revoked_text = String::from_utf8(revoked).unwrap();
        assert!(revoked_text.contains("not_paired"));
        assert!(!revoked_text.contains("http-only-secret"));

        let code = begin_pairing(&state).unwrap().0;
        let paired: serde_json::Value = serde_json::from_slice(
            &transact(
                &endpoint,
                &request(serde_json::json!({"type": "pair", "code": code})),
            )
            .unwrap(),
        )
        .unwrap();
        let token = paired["token"].as_str().unwrap();
        let http = transact(
            &endpoint,
            &request(serde_json::json!({
                "type": "get_login",
                "token": token,
                "id": summary.id,
                "url": "http://127.0.0.1/login"
            })),
        )
        .unwrap();
        let http_text = String::from_utf8(http).unwrap();
        assert!(http_text.contains("rejected"));
        assert!(!http_text.contains("http-only-secret"));

        state.set_allow_http(&summary.id, true).unwrap();
        let allowed = transact(
            &endpoint,
            &request(serde_json::json!({
                "type": "get_login",
                "token": token,
                "id": summary.id,
                "url": "http://127.0.0.1/login"
            })),
        )
        .unwrap();
        let allowed_text = String::from_utf8(allowed).unwrap();
        assert!(allowed_text.contains("http-only-secret"));
        assert!(allowed_text.contains("root"));
        drop(serving);
    }

    #[test]
    fn manifest_allows_only_this_extension() {
        let json =
            chrome_manifest(Path::new("/opt/quietkeys-native-host"), CHROME_EXTENSION_ID).unwrap();
        assert!(json.contains("chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"));
        assert!(!json.contains("chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/"));
        assert!(json.contains(r#""type": "stdio""#));
        assert_eq!(
            windows_registry_key(),
            r"Software\Google\Chrome\NativeMessagingHosts\com.quietkeys.native_host"
        );
        assert!(chrome_manifest(Path::new("x"), "not-an-id").is_err());
    }
}
