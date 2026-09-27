//! Whether a stored website may be opened, and the host to show for it.
//!
//! The check uses the `url` crate (WHATWG). A backslash or any whitespace is refused
//! before parsing, because the parser would otherwise skip tabs and newlines or turn
//! `\` into `/` and hide a different host. The scheme comparison happens after parsing,
//! so `HTTPS` is accepted once it has been lowercased.

use url::Url;

use crate::error::{Result, VaultError};

/// Parses `raw` into an http(s) URL with a host and no username or password.
pub fn openable_website(raw: &str) -> Result<Url> {
    if raw.chars().any(|c| c == '\\' || c.is_whitespace()) {
        return Err(VaultError::WebsiteNotOpened);
    }
    let url = Url::parse(raw).map_err(|_| VaultError::WebsiteNotOpened)?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err(VaultError::WebsiteNotOpened);
    }
    if url.host_str().is_none() {
        return Err(VaultError::WebsiteNotOpened);
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(VaultError::WebsiteNotOpened);
    }
    Ok(url)
}

/// The host as the `url` crate normalises it (punycode `xn--` for non-Latin names).
/// `None` when the address would not be opened.
pub fn normalized_host(raw: &str) -> Option<String> {
    openable_website(raw)
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn refused(raw: &str) {
        let err = openable_website(raw).unwrap_err();
        assert_eq!(err, VaultError::WebsiteNotOpened, "{raw}");
        let message = err.to_string();
        assert!(!message.contains(raw), "{message}");
        assert!(!message.contains("http"), "{message}");
    }

    #[test]
    fn accepts_http_and_https_with_a_host() {
        let https = openable_website("https://github.com/quietkeys").unwrap();
        assert_eq!(https.scheme(), "https");
        assert_eq!(https.host_str(), Some("github.com"));

        let http = openable_website("http://127.0.0.1:8080/login").unwrap();
        assert_eq!(http.scheme(), "http");
        assert_eq!(http.host_str(), Some("127.0.0.1"));
    }

    #[test]
    fn uppercase_https_is_allowed_after_parsing() {
        let url = openable_website("HTTPS://GitHub.com/Login").unwrap();
        assert_eq!(url.scheme(), "https");
        assert_eq!(url.host_str(), Some("github.com"));
    }

    #[test]
    fn refuses_non_http_schemes() {
        refused("file:///C:/Windows/system32");
        refused("javascript:alert(1)");
        refused("data:text/html,<script>alert(1)</script>");
        refused("quietkeys://open");
        refused("ftp://files.example.com/secret");
    }

    #[test]
    fn refuses_backslash_and_whitespace_tricks() {
        refused("https://example.com\\@evil.example");
        refused("https://example.com\\evil.example");
        refused("https://evil.example\\@github.com");
        refused("https://example.com ");
        refused(" https://example.com");
        refused("https://exa mple.com");
        refused("https://git\thub.com");
        refused("https://git\nhub.com");
        refused("https://git\r\nhub.com");
        refused("https://example.com\u{00a0}.evil.example");
    }

    #[test]
    fn refuses_userinfo_that_hides_the_real_host() {
        refused("https://github.com@evil.example");
        refused("https://github.com:secret@evil.example");
        refused("https://:secret@evil.example");
    }

    #[test]
    fn refuses_a_missing_host() {
        refused("https://");
        refused("http://");
        refused("not a url");
    }

    #[test]
    fn host_is_shown_in_punycode() {
        assert_eq!(
            normalized_host("https://münchen.de/login"),
            Some("xn--mnchen-3ya.de".to_string())
        );
        assert_eq!(
            normalized_host("https://GitHub.com"),
            Some("github.com".to_string())
        );
        assert_eq!(normalized_host("javascript:alert(1)"), None);
        assert_eq!(normalized_host("https://github.com@evil.example"), None);
    }

    #[test]
    fn refused_message_does_not_echo_the_address() {
        let raw = "https://github.com@evil.example/path?token=secret";
        let message = openable_website(raw).unwrap_err().to_string();
        assert_eq!(message, "That address can't be opened.");
        assert!(!message.contains("evil"));
        assert!(!message.contains("secret"));
        assert!(!message.contains("github"));
    }
}
