//! Key derivation and authenticated encryption. Pure functions with no file or app state.

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use secrecy::{ExposeSecret, SecretString};
use unicode_normalization::UnicodeNormalization;
use zeroize::Zeroizing;

use crate::error::{Result, VaultError};

pub const SALT_LEN: usize = 16;
pub const NONCE_LEN: usize = 24;
pub const KEY_LEN: usize = 32;

// Upper bounds for params read from a vault header. The header is only authenticated after
// the key is derived, so without these a tampered file could demand huge memory or time.
const MAX_M_KIB: u32 = 1024 * 1024;
const MAX_T: u32 = 64;
const MAX_P: u32 = 16;

/// The weakest Argon2id params accepted in real builds.
pub const MIN_PARAMS: KdfParams = KdfParams {
    m_kib: 19 * 1024,
    t: 2,
    p: 1,
};

#[cfg(not(test))]
const ENFORCED_MIN: KdfParams = MIN_PARAMS;

// Lets tests use `KdfParams::fast()`. Real builds always enforce `MIN_PARAMS`.
#[cfg(test)]
const ENFORCED_MIN: KdfParams = KdfParams {
    m_kib: 8,
    t: 1,
    p: 1,
};

/// A 256-bit encryption key that is wiped from memory when dropped.
pub type Key = Zeroizing<[u8; KEY_LEN]>;

/// Argon2id cost parameters.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KdfParams {
    /// Memory in KiB.
    pub m_kib: u32,
    /// Iterations.
    pub t: u32,
    /// Parallelism (lanes).
    pub p: u32,
}

impl Default for KdfParams {
    fn default() -> Self {
        Self {
            m_kib: 64 * 1024,
            t: 3,
            p: 1,
        }
    }
}

#[cfg(test)]
impl KdfParams {
    /// Deliberately weak params so tests run quickly. Never used outside tests.
    pub fn fast() -> Self {
        Self {
            m_kib: 64,
            t: 1,
            p: 1,
        }
    }
}

impl KdfParams {
    /// Each cost raised to at least `floor`'s value. Costs already above it are kept.
    pub fn raised_to(self, floor: &KdfParams) -> KdfParams {
        KdfParams {
            m_kib: self.m_kib.max(floor.m_kib),
            t: self.t.max(floor.t),
            p: self.p.max(floor.p),
        }
    }

    fn check_bounds(self, min: &KdfParams) -> Result<()> {
        let in_range = (min.m_kib..=MAX_M_KIB).contains(&self.m_kib)
            && (min.t..=MAX_T).contains(&self.t)
            && (min.p..=MAX_P).contains(&self.p);
        if in_range {
            Ok(())
        } else {
            Err(VaultError::InvalidKdfParams)
        }
    }

    fn to_argon2_params(self) -> Result<Params> {
        self.check_bounds(&ENFORCED_MIN)?;
        Params::new(self.m_kib, self.t, self.p, Some(KEY_LEN))
            .map_err(|_| VaultError::InvalidKdfParams)
    }
}

/// Fills `buf` from the operating system's CSPRNG.
pub fn fill_random(buf: &mut [u8]) -> Result<()> {
    getrandom::fill(buf).map_err(|_| VaultError::Crypto)
}

pub fn random_salt() -> Result<[u8; SALT_LEN]> {
    let mut salt = [0u8; SALT_LEN];
    fill_random(&mut salt)?;
    Ok(salt)
}

/// Unicode general category Zs (space separators), unchanged since Unicode 6.3.
const SPACE_SEPARATORS: [char; 17] = [
    '\u{0020}', '\u{00A0}', '\u{1680}', '\u{2000}', '\u{2001}', '\u{2002}', '\u{2003}', '\u{2004}',
    '\u{2005}', '\u{2006}', '\u{2007}', '\u{2008}', '\u{2009}', '\u{200A}', '\u{202F}', '\u{205F}',
    '\u{3000}',
];

/// Maps every space separator to U+0020, then applies NFC, following the order of
/// RFC 8265's OpaqueString profile (only these two rules, not the full profile).
/// The same password typed with a composed or decomposed accent, or with a
/// non-breaking space, gives the same result.
pub fn normalize_password(password: &SecretString) -> Zeroizing<String> {
    let raw = password.expose_secret();
    // NFC output is at most 3x the input's UTF-8 length, so this buffer never
    // reallocates and leaves an unwiped copy behind.
    let mut normalized = Zeroizing::new(String::with_capacity(raw.len() * 3));
    normalized.extend(
        raw.chars()
            .map(|c| {
                if SPACE_SEPARATORS.contains(&c) {
                    ' '
                } else {
                    c
                }
            })
            .nfc(),
    );
    normalized
}

/// Stretches the master password into a 256-bit key with Argon2id. The password is
/// normalized first (see `normalize_password`).
pub fn derive_key(
    password: &SecretString,
    salt: &[u8; SALT_LEN],
    params: &KdfParams,
) -> Result<Key> {
    let argon2 = Argon2::new(
        Algorithm::Argon2id,
        Version::V0x13,
        params.to_argon2_params()?,
    );
    let normalized = normalize_password(password);
    let mut key = Zeroizing::new([0u8; KEY_LEN]);
    argon2
        .hash_password_into(normalized.as_bytes(), salt, &mut key[..])
        .map_err(|_| VaultError::Crypto)?;
    Ok(key)
}

/// Encrypts `plaintext` with XChaCha20-Poly1305 under a freshly generated random nonce.
/// `aad` is authenticated but not encrypted. Returns the nonce and the ciphertext (with tag).
pub fn encrypt(key: &Key, aad: &[u8], plaintext: &[u8]) -> Result<([u8; NONCE_LEN], Vec<u8>)> {
    let mut nonce = [0u8; NONCE_LEN];
    fill_random(&mut nonce)?;
    let cipher = XChaCha20Poly1305::new_from_slice(&key[..]).map_err(|_| VaultError::Crypto)?;
    let ciphertext = cipher
        .encrypt(
            &XNonce::from(nonce),
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| VaultError::Crypto)?;
    Ok((nonce, ciphertext))
}

/// Decrypts and authenticates. Any mismatch in key, nonce, AAD or ciphertext gives
/// `DecryptFailed`, with no hint about which one was wrong.
pub fn decrypt(
    key: &Key,
    nonce: &[u8; NONCE_LEN],
    aad: &[u8],
    ciphertext: &[u8],
) -> Result<Zeroizing<Vec<u8>>> {
    let cipher = XChaCha20Poly1305::new_from_slice(&key[..]).map_err(|_| VaultError::Crypto)?;
    let plaintext = cipher
        .decrypt(
            &XNonce::from(*nonce),
            Payload {
                msg: ciphertext,
                aad,
            },
        )
        .map_err(|_| VaultError::DecryptFailed)?;
    Ok(Zeroizing::new(plaintext))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn password(s: &str) -> SecretString {
        SecretString::from(s)
    }

    fn test_key() -> Key {
        derive_key(
            &password("correct horse"),
            &[7u8; SALT_LEN],
            &KdfParams::fast(),
        )
        .unwrap()
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    #[test]
    fn ascii_password_key_is_unchanged_by_normalization() {
        // Recorded from derive_key before normalization was added.
        let key = derive_key(
            &password("correct horse battery staple"),
            &[7u8; SALT_LEN],
            &KdfParams::fast(),
        )
        .unwrap();
        assert_eq!(
            hex(&key[..]),
            "96a88be15c9689b19b1453a1b6a93f5c630c5adf3fde1bd9ad08ceb8e81ada54"
        );
    }

    #[test]
    fn ascii_password_matches_raw_argon2id() {
        let pw = "Plain ASCII password 123!";
        let salt = [3u8; SALT_LEN];
        let params = KdfParams::fast();
        let mut raw = [0u8; KEY_LEN];
        Argon2::new(
            Algorithm::Argon2id,
            Version::V0x13,
            params.to_argon2_params().unwrap(),
        )
        .hash_password_into(pw.as_bytes(), &salt, &mut raw)
        .unwrap();
        assert_eq!(*derive_key(&password(pw), &salt, &params).unwrap(), raw);
    }

    #[test]
    fn composed_and_decomposed_accents_derive_the_same_key() {
        let salt = [1u8; SALT_LEN];
        let composed = derive_key(&password("caf\u{e9}"), &salt, &KdfParams::fast()).unwrap();
        let decomposed = derive_key(&password("cafe\u{301}"), &salt, &KdfParams::fast()).unwrap();
        assert_eq!(*composed, *decomposed);
        assert_eq!(
            &normalize_password(&password("cafe\u{301}"))[..],
            "caf\u{e9}"
        );
    }

    #[test]
    fn every_space_separator_maps_to_ascii_space() {
        let salt = [2u8; SALT_LEN];
        let plain = derive_key(&password("a b"), &salt, &KdfParams::fast()).unwrap();
        for space in SPACE_SEPARATORS {
            let pw = password(&format!("a{space}b"));
            assert_eq!(
                &normalize_password(&pw)[..],
                "a b",
                "U+{:04X}",
                space as u32
            );
            assert_eq!(*derive_key(&pw, &salt, &KdfParams::fast()).unwrap(), *plain);
        }
    }

    #[test]
    fn other_whitespace_is_not_mapped() {
        for c in ['\t', '\n', '\u{2028}', '\u{200B}'] {
            let pw = password(&format!("a{c}b"));
            assert_eq!(&normalize_password(&pw)[..], format!("a{c}b"));
        }
    }

    #[test]
    fn default_params_match_the_security_design() {
        assert_eq!(
            KdfParams::default(),
            KdfParams {
                m_kib: 65536,
                t: 3,
                p: 1
            }
        );
    }

    #[test]
    fn derive_key_is_deterministic() {
        assert_eq!(*test_key(), *test_key());
    }

    #[test]
    fn derive_key_depends_on_password_salt_and_params() {
        let base = test_key();
        let salt = [7u8; SALT_LEN];
        let other_password =
            derive_key(&password("wrong horse"), &salt, &KdfParams::fast()).unwrap();
        let other_salt = derive_key(
            &password("correct horse"),
            &[8u8; SALT_LEN],
            &KdfParams::fast(),
        )
        .unwrap();
        let other_params = derive_key(
            &password("correct horse"),
            &salt,
            &KdfParams {
                t: 2,
                ..KdfParams::fast()
            },
        )
        .unwrap();
        assert_ne!(*base, *other_password);
        assert_ne!(*base, *other_salt);
        assert_ne!(*base, *other_params);
    }

    #[test]
    fn out_of_bounds_params_are_rejected() {
        let salt = [0u8; SALT_LEN];
        let bad = [
            KdfParams {
                m_kib: MAX_M_KIB + 1,
                ..KdfParams::fast()
            },
            KdfParams {
                t: MAX_T + 1,
                ..KdfParams::fast()
            },
            KdfParams {
                p: MAX_P + 1,
                ..KdfParams::fast()
            },
            KdfParams {
                t: 0,
                ..KdfParams::fast()
            },
            KdfParams {
                p: 0,
                ..KdfParams::fast()
            },
            KdfParams {
                m_kib: 0,
                ..KdfParams::fast()
            },
        ];
        for params in bad {
            assert_eq!(
                derive_key(&password("pw"), &salt, &params).unwrap_err(),
                VaultError::InvalidKdfParams,
                "{params:?}"
            );
        }
    }

    #[test]
    fn production_minimums_match_the_security_design() {
        assert_eq!(
            MIN_PARAMS,
            KdfParams {
                m_kib: 19456,
                t: 2,
                p: 1
            }
        );
        assert!(KdfParams::default().check_bounds(&MIN_PARAMS).is_ok());
        assert!(MIN_PARAMS.check_bounds(&MIN_PARAMS).is_ok());
    }

    #[test]
    fn params_below_production_minimum_are_rejected() {
        let below = [
            KdfParams {
                m_kib: MIN_PARAMS.m_kib - 1,
                ..MIN_PARAMS
            },
            KdfParams { t: 1, ..MIN_PARAMS },
            KdfParams { p: 0, ..MIN_PARAMS },
            KdfParams::fast(),
        ];
        for params in below {
            assert_eq!(
                params.check_bounds(&MIN_PARAMS),
                Err(VaultError::InvalidKdfParams),
                "{params:?}"
            );
        }
    }

    #[test]
    fn raised_to_only_increases_costs() {
        let default = KdfParams::default();
        assert_eq!(MIN_PARAMS.raised_to(&default), default);
        assert_eq!(default.raised_to(&default), default);
        let stronger_memory = KdfParams {
            m_kib: 128 * 1024,
            t: 2,
            p: 1,
        };
        assert_eq!(
            stronger_memory.raised_to(&default),
            KdfParams {
                m_kib: 128 * 1024,
                t: 3,
                p: 1
            }
        );
    }

    #[test]
    fn random_salts_differ() {
        assert_ne!(random_salt().unwrap(), random_salt().unwrap());
    }

    #[test]
    fn encrypt_decrypt_round_trip() {
        let key = test_key();
        let (nonce, ciphertext) = encrypt(&key, b"header", b"secret data").unwrap();
        assert_ne!(&ciphertext[..], b"secret data");
        let plaintext = decrypt(&key, &nonce, b"header", &ciphertext).unwrap();
        assert_eq!(&plaintext[..], b"secret data");
    }

    #[test]
    fn each_encryption_uses_a_fresh_nonce() {
        let key = test_key();
        let (nonce_a, ct_a) = encrypt(&key, b"aad", b"same").unwrap();
        let (nonce_b, ct_b) = encrypt(&key, b"aad", b"same").unwrap();
        assert_ne!(nonce_a, nonce_b);
        assert_ne!(ct_a, ct_b);
    }

    #[test]
    fn decrypt_fails_with_wrong_key() {
        let (nonce, ciphertext) = encrypt(&test_key(), b"aad", b"data").unwrap();
        let wrong = derive_key(&password("nope"), &[7u8; SALT_LEN], &KdfParams::fast()).unwrap();
        assert_eq!(
            decrypt(&wrong, &nonce, b"aad", &ciphertext).unwrap_err(),
            VaultError::DecryptFailed
        );
    }

    #[test]
    fn decrypt_fails_with_wrong_aad() {
        let key = test_key();
        let (nonce, ciphertext) = encrypt(&key, b"aad", b"data").unwrap();
        assert_eq!(
            decrypt(&key, &nonce, b"aaD", &ciphertext).unwrap_err(),
            VaultError::DecryptFailed
        );
    }

    #[test]
    fn decrypt_fails_with_wrong_nonce() {
        let key = test_key();
        let (mut nonce, ciphertext) = encrypt(&key, b"aad", b"data").unwrap();
        nonce[0] ^= 1;
        assert_eq!(
            decrypt(&key, &nonce, b"aad", &ciphertext).unwrap_err(),
            VaultError::DecryptFailed
        );
    }

    #[test]
    fn decrypt_fails_if_any_ciphertext_byte_changes() {
        let key = test_key();
        let (nonce, ciphertext) = encrypt(&key, b"aad", b"some secret data").unwrap();
        for i in 0..ciphertext.len() {
            let mut tampered = ciphertext.clone();
            tampered[i] ^= 0x01;
            assert_eq!(
                decrypt(&key, &nonce, b"aad", &tampered).unwrap_err(),
                VaultError::DecryptFailed,
                "byte {i}"
            );
        }
    }

    #[test]
    fn decrypt_fails_if_ciphertext_is_truncated() {
        let key = test_key();
        let (nonce, ciphertext) = encrypt(&key, b"aad", b"data").unwrap();
        assert_eq!(
            decrypt(&key, &nonce, b"aad", &ciphertext[..ciphertext.len() - 1]).unwrap_err(),
            VaultError::DecryptFailed
        );
        assert_eq!(
            decrypt(&key, &nonce, b"aad", &[]).unwrap_err(),
            VaultError::DecryptFailed
        );
    }
}
