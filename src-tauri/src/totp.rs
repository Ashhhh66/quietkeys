//! RFC 6238 TOTP with HMAC-SHA1, a 30-second step, and 6 digits.
//! The secret stays in the vault. Only the current code leaves this module.

use hmac::{Hmac, Mac};
use serde::Serialize;
use sha1::Sha1;

use crate::error::{Result, VaultError};

const STEP_SECONDS: u64 = 30;
const DIGITS: u32 = 6;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TotpCode {
    pub code: String,
    pub seconds_remaining: u64,
}

pub fn current_code(secret_base32: &str, unix_seconds: u64) -> Result<TotpCode> {
    let secret = decode_base32(secret_base32).ok_or(VaultError::InvalidFormat)?;
    if secret.is_empty() || secret.len() > 64 {
        return Err(VaultError::InvalidFormat);
    }
    let counter = unix_seconds / STEP_SECONDS;
    let code = hotp(&secret, counter);
    let width = 10u32.pow(DIGITS);
    Ok(TotpCode {
        code: format!("{:0width$}", code % width, width = DIGITS as usize),
        seconds_remaining: STEP_SECONDS - (unix_seconds % STEP_SECONDS),
    })
}

fn hotp(secret: &[u8], counter: u64) -> u32 {
    let mut mac = Hmac::<Sha1>::new_from_slice(secret).expect("HMAC-SHA1 accepts any key length");
    mac.update(&counter.to_be_bytes());
    let result = mac.finalize().into_bytes();
    let offset = (result[19] & 0x0f) as usize;
    u32::from_be_bytes([
        result[offset],
        result[offset + 1],
        result[offset + 2],
        result[offset + 3],
    ]) & 0x7fff_ffff
}

fn decode_base32(input: &str) -> Option<Vec<u8>> {
    let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let mut buffer = 0u32;
    let mut bits = 0;
    let mut out = Vec::new();
    for ch in input.chars() {
        if ch.is_whitespace() || ch == '-' {
            continue;
        }
        let value = alphabet
            .iter()
            .position(|c| *c == ch.to_ascii_uppercase() as u8)? as u32;
        buffer = (buffer << 5) | value;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            out.push((buffer >> bits) as u8);
            buffer &= (1 << bits) - 1;
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rfc6238_sha1_vector_at_59_seconds() {
        let code = current_code("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59).unwrap();
        assert_eq!(code.code, "287082");
        assert_eq!(code.seconds_remaining, 1);
    }
}
