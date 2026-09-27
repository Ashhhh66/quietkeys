//! Password and passphrase generation, and strength scoring.
//!
//! Generation uses the OS CSPRNG only. Each character or word is chosen by rejection
//! sampling so the index is not biased by modulo. A password is kept only when it already contains
//! at least one character from every selected set; otherwise the whole password is
//! generated again. Characters are never inserted and shuffled into place.

use std::sync::OnceLock;

use serde::Serialize;
use zeroize::Zeroizing;
use zxcvbn::zxcvbn;

use crate::crypto::fill_random;
use crate::error::{Result, VaultError};

pub const MIN_LENGTH: usize = 8;
pub const MAX_LENGTH: usize = 128;
pub const MIN_WORDS: usize = 3;
pub const MAX_WORDS: usize = 10;
/// EFF Large Wordlist length. Entropy is `words * log2(WORDLIST_LEN)`.
pub const WORDLIST_LEN: usize = 7776;

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

/// A generated password or passphrase, plus the entropy of the options that produced it.
///
/// `bits` comes from those options (alphabet size, or the wordlist), not from zxcvbn.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedSecret {
    pub value: String,
    pub bits: f64,
}

/// What the UI asks the passphrase generator for.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PassphraseOptions {
    pub words: usize,
    pub separator: String,
    /// Uppercase only the first letter of the first word. This does not add entropy.
    pub capitalise: bool,
    /// Append one digit, 0–9, as its own token. Adds `log2(10)` bits.
    pub add_number: bool,
}

pub fn generate_password(options: &PasswordOptions) -> Result<Zeroizing<String>> {
    let alphabet = alphabet(options)?;
    let sets = selected_sets(options);

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

/// `length * log2(alphabet size)` for a password these options can generate.
pub fn password_entropy_bits(options: &PasswordOptions) -> Result<f64> {
    let alphabet = alphabet(options)?;
    Ok((options.length as f64) * (alphabet.len() as f64).log2())
}

/// `words * log2(7776)`, plus `log2(10)` when a digit is appended.
/// Capitalising and the separator are fixed choices, so they add no bits.
pub fn passphrase_entropy_bits(words: usize, add_number: bool) -> f64 {
    let mut bits = (words as f64) * (WORDLIST_LEN as f64).log2();
    if add_number {
        bits += 10_f64.log2();
    }
    bits
}

pub fn generate_passphrase(options: &PassphraseOptions) -> Result<GeneratedSecret> {
    if !(MIN_WORDS..=MAX_WORDS).contains(&options.words) {
        return Err(VaultError::InvalidGeneratorOptions(
            "Passphrase length must be between 3 and 10 words",
        ));
    }
    if !matches!(options.separator.as_str(), "-" | "." | "_" | " ") {
        return Err(VaultError::InvalidGeneratorOptions(
            "Separator must be a hyphen, a dot, an underscore, or a space",
        ));
    }
    let list = wordlist();
    let mut value = Zeroizing::new(String::new());
    for index in 0..options.words {
        if index > 0 {
            value.push_str(&options.separator);
        }
        let word = list[unbiased_index(list.len())?];
        if index == 0 && options.capitalise {
            value.push_str(&capitalise_first(word));
        } else {
            value.push_str(word);
        }
    }
    if options.add_number {
        let digit = unbiased_index(10)?;
        value.push_str(&options.separator);
        value.push(char::from(b'0' + digit as u8));
    }
    let bits = passphrase_entropy_bits(options.words, options.add_number);
    Ok(GeneratedSecret {
        value: value.to_string(),
        bits,
    })
}

fn alphabet(options: &PasswordOptions) -> Result<Vec<char>> {
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
    Ok(sets.into_iter().flatten().collect())
}

fn capitalise_first(word: &str) -> String {
    let mut chars = word.chars();
    match chars.next() {
        Some(first) => {
            let mut out = first.to_uppercase().collect::<String>();
            out.push_str(chars.as_str());
            out
        }
        None => String::new(),
    }
}

/// The EFF Large Wordlist, bundled as published (dice roll, tab, word).
/// https://www.eff.org/deeplinks/2016/07/new-wordlists-random-passphrases
fn wordlist() -> &'static [&'static str] {
    static WORDS: OnceLock<Vec<&'static str>> = OnceLock::new();
    WORDS.get_or_init(|| {
        include_str!("../assets/eff_large_wordlist.txt")
            .lines()
            .filter(|line| !line.is_empty())
            .map(|line| {
                line.split_once('\t')
                    .map(|(_, word)| word)
                    .expect("EFF wordlist row has a tab")
            })
            .collect()
    })
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

    fn close(actual: f64, expected: f64) {
        assert!(
            (actual - expected).abs() < 1e-9,
            "{actual} is not {expected}"
        );
    }

    #[test]
    fn password_bits_are_length_times_log2_of_the_alphabet() {
        let digits = options(10, false, false, true, false, false);
        close(
            password_entropy_bits(&digits).unwrap(),
            10.0 * 10_f64.log2(),
        );
        let full = options(20, true, true, true, true, false);
        let smaller = options(20, true, true, true, true, true);
        let full_bits = password_entropy_bits(&full).unwrap();
        let smaller_bits = password_entropy_bits(&smaller).unwrap();
        assert!(smaller_bits < full_bits);
        let size = alphabet(&full).unwrap().len() as f64;
        close(full_bits, 20.0 * size.log2());
    }

    #[test]
    fn bundled_eff_wordlist_matches_the_recorded_sha256() {
        use sha2::{Digest, Sha256};
        let digest = Sha256::digest(include_bytes!("../assets/eff_large_wordlist.txt"));
        let recorded = include_str!("../assets/eff_large_wordlist.sha256").trim();
        let hex: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
        assert_eq!(hex, recorded);
    }

    #[test]
    fn wordlist_is_the_eff_large_list() {
        let words = wordlist();
        assert_eq!(words.len(), WORDLIST_LEN);
        assert_eq!(
            words.len(),
            words
                .iter()
                .copied()
                .collect::<std::collections::HashSet<_>>()
                .len()
        );
        // Four official words contain a hyphen: drop-down, felt-tip, t-shirt, yo-yo.
        assert!(words.iter().all(|word| {
            !word.is_empty()
                && word.chars().all(|c| c.is_ascii_lowercase() || c == '-')
                && !word.contains(['.', '_', ' '])
        }));
    }

    fn passphrase(
        words: usize,
        separator: &str,
        capitalise: bool,
        add_number: bool,
    ) -> PassphraseOptions {
        PassphraseOptions {
            words,
            separator: separator.to_string(),
            capitalise,
            add_number,
        }
    }

    #[test]
    fn passphrase_rejects_word_counts_and_separators_outside_the_range() {
        for words in [0, 2, 11, 20] {
            assert!(matches!(
                generate_passphrase(&passphrase(words, "-", false, false)),
                Err(VaultError::InvalidGeneratorOptions(_))
            ));
        }
        for separator in ["", "--", ":", "/", " -"] {
            assert!(matches!(
                generate_passphrase(&passphrase(4, separator, false, false)),
                Err(VaultError::InvalidGeneratorOptions(_))
            ));
        }
    }

    /// True when `rest` is exactly `count` wordlist words joined by `separator`.
    /// A word may itself contain `-`, so this tries every matching word instead of splitting.
    fn is_words(rest: &str, words: &[&str], separator: &str, count: usize) -> bool {
        if count == 0 {
            return rest.is_empty();
        }
        words
            .iter()
            .copied()
            .filter(|word| rest.starts_with(word))
            .any(|word| {
                let after = &rest[word.len()..];
                if count == 1 {
                    return after.is_empty();
                }
                after
                    .strip_prefix(separator)
                    .is_some_and(|next| is_words(next, words, separator, count - 1))
            })
    }

    #[test]
    fn passphrase_uses_each_separator_and_only_wordlist_words() {
        let words = wordlist();
        for separator in ["-", ".", "_", " "] {
            let generated = generate_passphrase(&passphrase(4, separator, false, false)).unwrap();
            assert!(
                is_words(&generated.value, words, separator, 4),
                "passphrase was not four wordlist words"
            );
            close(generated.bits, 4.0 * (WORDLIST_LEN as f64).log2());
        }
    }

    #[test]
    fn capitalise_changes_only_the_first_letter_and_a_number_is_its_own_token() {
        let words = wordlist();
        let generated = generate_passphrase(&passphrase(5, "-", true, true)).unwrap();
        let (body, digit) = generated.value.rsplit_once('-').unwrap();
        assert_eq!(digit.len(), 1);
        assert!(digit.chars().next().unwrap().is_ascii_digit());
        assert!(body.chars().next().unwrap().is_ascii_uppercase());
        let mut lower = body.to_string();
        lower.replace_range(..1, &body[..1].to_ascii_lowercase());
        assert!(is_words(&lower, words, "-", 5));
        assert_ne!(body, lower);
        close(
            generated.bits,
            5.0 * (WORDLIST_LEN as f64).log2() + 10_f64.log2(),
        );
    }
}
