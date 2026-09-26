//! Password generation and strength scoring.
//!
//! Generation uses the OS CSPRNG only. Each character is chosen by rejection sampling so
//! the index is not biased by modulo. A password is kept only when it already contains
//! at least one character from every selected set; otherwise the whole password is
//! generated again. Characters are never inserted and shuffled into place.

use serde::Serialize;
use zeroize::Zeroizing;
use zxcvbn::zxcvbn;

use crate::crypto::fill_random;
use crate::error::{Result, VaultError};

pub const MIN_LENGTH: usize = 8;
pub const MAX_LENGTH: usize = 128;

const LOWER: &str = "abcdefghijklmnopqrstuvwxyz";
const UPPER: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS: &str = "0123456789";
const SYMBOLS: &str = "!@#$%^&*-_=+?";
/// Characters that are easy to misread. Dropped from every set when requested.
const AMBIGUOUS: &[char] = &['0', 'O', 'o', '1', 'l', 'I'];

const MAX_ATTEMPTS: usize = 10_000;

/// What the UI asks the generator for. Field names are camelCase on the wire.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PasswordOptions {
    pub length: usize,
    pub lowercase: bool,
    pub uppercase: bool,
    pub digits: bool,
    pub symbols: bool,
    pub exclude_ambiguous: bool,
}

/// zxcvbn score plus the feedback strings, when it has any.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasswordScore {
    /// 0 (weakest) through 4 (strongest).
    pub score: u8,
    pub warning: Option<String>,
    pub suggestions: Vec<String>,
}

pub fn generate_password(options: &PasswordOptions) -> Result<Zeroizing<String>> {
    if !(MIN_LENGTH..=MAX_LENGTH).contains(&options.length) {
        return Err(VaultError::InvalidGeneratorOptions(
            "Password length must be between 8 and 128 characters",
        ));
    }
    let sets = selected_sets(options);
    if sets.is_empty() {
        return Err(VaultError::InvalidGeneratorOptions(
            "Choose at least one character set",
        ));
    }
    if options.length < sets.len() {
        return Err(VaultError::InvalidGeneratorOptions(
            "Password length must be at least the number of selected character sets",
        ));
    }
    let alphabet: Vec<char> = sets.iter().flat_map(|set| set.iter().copied()).collect();

    for _ in 0..MAX_ATTEMPTS {
        let mut password = Zeroizing::new(String::with_capacity(options.length));
        for _ in 0..options.length {
            let index = unbiased_index(alphabet.len())?;
            password.push(alphabet[index]);
        }
        if sets
            .iter()
            .all(|set| password.chars().any(|c| set.contains(&c)))
        {
            return Ok(password);
        }
    }
    Err(VaultError::Crypto)
}

/// Scores `password` with zxcvbn. The password is not logged.
pub fn score_password(password: &str) -> PasswordScore {
    let entropy = zxcvbn(password, &[]);
    let feedback = entropy.feedback();
    PasswordScore {
        score: u8::from(entropy.score()),
        warning: feedback.and_then(|item| item.warning().map(|warning| warning.to_string())),
        suggestions: feedback
            .map(|item| {
                item.suggestions()
                    .iter()
                    .map(|suggestion| suggestion.to_string())
                    .collect()
            })
            .unwrap_or_default(),
    }
}

fn selected_sets(options: &PasswordOptions) -> Vec<Vec<char>> {
    let mut sets = Vec::new();
    for (enabled, alphabet) in [
        (options.lowercase, LOWER),
        (options.uppercase, UPPER),
        (options.digits, DIGITS),
        (options.symbols, SYMBOLS),
    ] {
        if !enabled {
            continue;
        }
        let set: Vec<char> = alphabet
            .chars()
            .filter(|c| !options.exclude_ambiguous || !AMBIGUOUS.contains(c))
            .collect();
        if !set.is_empty() {
            sets.push(set);
        }
    }
    sets
}

/// Uniform index in `0..len`. Bytes at or above the largest multiple of `len` that fits
/// in a `u32` are discarded, so the `% len` remainder is not biased.
fn unbiased_index(len: usize) -> Result<usize> {
    let len = u32::try_from(len).map_err(|_| VaultError::Crypto)?;
    let limit = u32::MAX - (u32::MAX % len);
    loop {
        let mut buf = [0u8; 4];
        fill_random(&mut buf)?;
        let value = u32::from_le_bytes(buf);
        if value < limit {
            return Ok((value % len) as usize);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn options(
        length: usize,
        lowercase: bool,
        uppercase: bool,
        digits: bool,
        symbols: bool,
        exclude_ambiguous: bool,
    ) -> PasswordOptions {
        PasswordOptions {
            length,
            lowercase,
            uppercase,
            digits,
            symbols,
            exclude_ambiguous,
        }
    }

    #[test]
    fn rejects_length_and_set_combinations_that_cannot_work() {
        assert!(matches!(
            generate_password(&options(7, true, false, false, false, false)),
            Err(VaultError::InvalidGeneratorOptions(_))
        ));
        assert!(matches!(
            generate_password(&options(129, true, false, false, false, false)),
            Err(VaultError::InvalidGeneratorOptions(_))
        ));
        assert!(matches!(
            generate_password(&options(12, false, false, false, false, false)),
            Err(VaultError::InvalidGeneratorOptions(_))
        ));
        assert!(matches!(
            generate_password(&options(3, true, true, true, true, false)),
            Err(VaultError::InvalidGeneratorOptions(_))
        ));
    }

    #[test]
    fn every_selected_set_appears_and_unselected_sets_do_not() {
        let password = generate_password(&options(16, true, true, true, false, false)).unwrap();
        assert_eq!(password.chars().count(), 16);
        assert!(password.chars().any(|c| c.is_ascii_lowercase()));
        assert!(password.chars().any(|c| c.is_ascii_uppercase()));
        assert!(password.chars().any(|c| c.is_ascii_digit()));
        assert!(password.chars().all(|c| c.is_ascii_alphanumeric()));
    }

    #[test]
    fn exclude_ambiguous_removes_those_characters_from_every_set() {
        for _ in 0..30 {
            let password = generate_password(&options(32, true, true, true, true, true)).unwrap();
            assert!(
                password.chars().all(|c| !AMBIGUOUS.contains(&c)),
                "ambiguous character in generated password"
            );
        }
    }

    #[test]
    fn digits_only_passwords_stay_inside_that_set() {
        let password = generate_password(&options(24, false, false, true, false, false)).unwrap();
        assert!(password.chars().all(|c| c.is_ascii_digit()));
    }

    /// Each digit should show up, but the bounds are wide on purpose: a tight check of
    /// a random sample fails sometimes even when the sampler is uniform.
    #[test]
    fn digit_counts_stay_within_generous_bounds() {
        let samples = 200;
        let length = 20;
        let mut counts = [0u32; 10];
        for _ in 0..samples {
            let password =
                generate_password(&options(length, false, false, true, false, false)).unwrap();
            for ch in password.chars() {
                counts[(ch as u8 - b'0') as usize] += 1;
            }
        }
        let expected = (samples * length / 10) as u32;
        for count in counts {
            assert!(
                (expected / 4..=expected * 4).contains(&count),
                "digit count {count} is outside {expected}/4..={expected}*4"
            );
        }
    }

    #[test]
    fn score_is_in_range_and_a_common_password_scores_low() {
        let weak = score_password("password");
        assert!(weak.score <= 1);
        assert!(weak.warning.is_some() || !weak.suggestions.is_empty());

        let empty = score_password("");
        assert_eq!(empty.score, 0);

        let strong = score_password("r8#Qm4-vL2!pX7$eN3&k");
        assert!(strong.score <= 4);
    }
}
