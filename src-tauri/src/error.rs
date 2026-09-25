use std::fmt;
use std::io;

/// Errors from the crypto and vault layers.
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
    /// The OS random number generator or a cipher primitive failed.
    Crypto,
    Io(io::ErrorKind),
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
}
