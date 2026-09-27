use std::fmt;
use std::io;

use serde::ser::{Serialize, SerializeStruct, Serializer};

/// Errors from the crypto, vault and app-state layers.
///
/// Variants never carry secret data (passwords, keys, plaintext) or messages from other
/// libraries, because those can echo back parts of their input.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VaultError {
    /// Wrong password, or the file was tampered with or corrupted.
    DecryptFailed,
    UnsupportedVersion(u32),
    InvalidFormat,
    InvalidKdfParams,
    /// A new master password is shorter than the minimum length.
    PasswordTooShort {
        min_chars: usize,
    },
    /// A new master password contains a control character (Unicode category Cc).
    PasswordHasControlCharacter,
    /// The operation needs an unlocked vault.
    Locked,
    EntryNotFound,
    /// A field on an entry is longer than allowed.
    FieldTooLong {
        field: &'static str,
        max_chars: usize,
    },
    /// Too many wrong passwords in a row; try again after this many seconds.
    Throttled {
        seconds_remaining: u64,
    },
    /// Another `create_vault`, `unlock`, `change_master_password`, or
    /// `restore_from_backup` call is already running.
    Busy,
    /// The vault is already unlocked, so a locked-only operation was refused.
    AlreadyUnlocked,
    /// Password generator options cannot produce a password.
    InvalidGeneratorOptions(&'static str),
    /// The platform cannot do this (clipboard on Linux).
    Unsupported,
    /// The stored website is not an http(s) URL we will open, or the OS could not open it.
    /// The message never includes the address, which may contain a query secret.
    WebsiteNotOpened,
    /// The OS could not reveal the vault file. The message never includes the path.
    VaultNotShown,
    /// The OS random number generator or a cipher primitive failed.
    Crypto,
    Io(io::ErrorKind),
}

impl VaultError {
    /// A stable identifier the UI can match on without parsing the message.
    pub fn kind(&self) -> &'static str {
        match self {
            VaultError::DecryptFailed => "decrypt_failed",
            VaultError::UnsupportedVersion(_) => "unsupported_version",
            VaultError::InvalidFormat => "invalid_format",
            VaultError::InvalidKdfParams => "invalid_kdf_params",
            VaultError::PasswordTooShort { .. } => "password_too_short",
            VaultError::PasswordHasControlCharacter => "password_has_control_character",
            VaultError::Locked => "locked",
            VaultError::EntryNotFound => "entry_not_found",
            VaultError::FieldTooLong { .. } => "field_too_long",
            VaultError::Throttled { .. } => "throttled",
            VaultError::Busy => "busy",
            VaultError::AlreadyUnlocked => "already_unlocked",
            VaultError::InvalidGeneratorOptions(_) => "invalid_generator_options",
            VaultError::Unsupported => "unsupported",
            VaultError::WebsiteNotOpened => "website_not_opened",
            VaultError::VaultNotShown => "vault_not_shown",
            VaultError::Crypto => "crypto",
            VaultError::Io(_) => "io",
        }
    }
}

impl fmt::Display for VaultError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            VaultError::DecryptFailed => write!(f, "Incorrect password or corrupted vault"),
            VaultError::UnsupportedVersion(version) => write!(
                f,
                "Unsupported vault version {version}. It may have been created by a newer version of quietkeys"
            ),
            VaultError::InvalidFormat => write!(f, "The vault file is not in a recognised format"),
            VaultError::InvalidKdfParams => {
                write!(f, "The vault's key derivation settings are invalid")
            }
            VaultError::PasswordTooShort { min_chars } => write!(
                f,
                "The master password must be at least {min_chars} characters long"
            ),
            VaultError::PasswordHasControlCharacter => write!(
                f,
                "The master password cannot contain control characters such as tabs or line breaks"
            ),
            VaultError::Locked => write!(f, "The vault is locked"),
            VaultError::EntryNotFound => write!(f, "That entry no longer exists"),
            VaultError::FieldTooLong { field, max_chars } => {
                write!(f, "{field} must be at most {max_chars} characters long")
            }
            VaultError::Throttled { seconds_remaining } => write!(
                f,
                "Too many incorrect attempts. Try again in {seconds_remaining} seconds"
            ),
            VaultError::Busy => {
                write!(f, "Another vault operation is already in progress")
            }
            VaultError::AlreadyUnlocked => write!(f, "The vault is already unlocked"),
            VaultError::InvalidGeneratorOptions(message) => write!(f, "{message}"),
            VaultError::Unsupported => {
                write!(f, "This operation is not supported on this system")
            }
            VaultError::WebsiteNotOpened => write!(f, "That address can't be opened."),
            VaultError::VaultNotShown => write!(f, "The vault couldn't be shown in its folder."),
            VaultError::Crypto => write!(f, "Internal cryptography error"),
            VaultError::Io(kind) => write!(f, "File error: {kind}"),
        }
    }
}

impl std::error::Error for VaultError {}

impl From<io::Error> for VaultError {
    fn from(err: io::Error) -> Self {
        VaultError::Io(err.kind())
    }
}

/// Sent to the UI as `{ "kind": "...", "message": "..." }`, plus `secondsRemaining` for
/// `Throttled` so the Unlock screen can show a live countdown instead of a static
/// message. Every key is camelCase, matching every other type sent to the frontend.
impl Serialize for VaultError {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        let field_count = if matches!(self, VaultError::Throttled { .. }) {
            3
        } else {
            2
        };
        let mut state = serializer.serialize_struct("VaultError", field_count)?;
        state.serialize_field("kind", self.kind())?;
        state.serialize_field("message", &self.to_string())?;
        if let VaultError::Throttled { seconds_remaining } = self {
            state.serialize_field("secondsRemaining", seconds_remaining)?;
        }
        state.end()
    }
}

pub type Result<T> = std::result::Result<T, VaultError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decrypt_failed_message_is_generic() {
        assert_eq!(
            VaultError::DecryptFailed.to_string(),
            "Incorrect password or corrupted vault"
        );
    }

    #[test]
    fn io_error_keeps_only_the_kind() {
        let err: VaultError = io::Error::new(io::ErrorKind::NotFound, "C:\\secret\\path").into();
        assert_eq!(err, VaultError::Io(io::ErrorKind::NotFound));
        assert!(!err.to_string().contains("secret"));
    }

    #[test]
    fn serializes_as_kind_and_message() {
        assert_eq!(
            serde_json::to_value(VaultError::DecryptFailed).unwrap(),
            serde_json::json!({
                "kind": "decrypt_failed",
                "message": "Incorrect password or corrupted vault"
            })
        );
        assert_eq!(
            serde_json::to_value(VaultError::Locked).unwrap()["kind"],
            "locked"
        );
    }

    #[test]
    fn throttled_error_includes_seconds_remaining_in_camel_case() {
        let value = serde_json::to_value(VaultError::Throttled {
            seconds_remaining: 7,
        })
        .unwrap();
        assert_eq!(value["kind"], "throttled");
        assert_eq!(value["secondsRemaining"], 7);
        assert!(value.get("seconds_remaining").is_none());
    }

    #[test]
    fn non_throttled_errors_have_no_extra_fields() {
        let value = serde_json::to_value(VaultError::Locked).unwrap();
        assert_eq!(
            value.as_object().unwrap().keys().collect::<Vec<_>>(),
            ["kind", "message"]
        );
    }
}
