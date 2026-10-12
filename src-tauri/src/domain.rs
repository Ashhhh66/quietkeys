//! Registrable-domain matching for the browser host.
//!
//! `accounts.google.com` matches an entry for `google.com`. `google.com.evil.io` does not.
//! An IP address matches only that exact address. A public suffix on its own, such as `co.uk`,
//! is not a site.

use psl::{List, Psl};
use url::Host;

use crate::website::openable_website;

/// True when both addresses are http(s) and name the same site.
pub fn same_site(page: &str, stored: &str) -> bool {
    let Ok(page) = openable_website(page) else {
        return false;
    };
    let Ok(stored) = openable_website(stored) else {
        return false;
    };
    match (page.host(), stored.host()) {
        (Some(Host::Ipv4(left)), Some(Host::Ipv4(right))) => left == right,
        (Some(Host::Ipv6(left)), Some(Host::Ipv6(right))) => left == right,
        (Some(Host::Domain(left)), Some(Host::Domain(right))) => {
            match (registrable(left), registrable(right)) {
                (Some(left), Some(right)) => left == right,
                _ => false,
            }
        }
        _ => false,
    }
}

pub fn is_https(page: &str) -> bool {
    openable_website(page)
        .ok()
        .is_some_and(|url| url.scheme() == "https")
}

/// The host to show for a page. Empty when the address is not one we would open.
pub fn display_host(page: &str) -> Option<String> {
    openable_website(page)
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned))
}

fn registrable(host: &str) -> Option<String> {
    let domain = List.domain(host.as_bytes())?;
    let bytes = domain.as_bytes();
    if bytes.len() <= host.len() && host.as_bytes().ends_with(bytes) {
        std::str::from_utf8(bytes).ok().map(str::to_owned)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subdomains_match_and_lookalikes_do_not() {
        assert!(same_site(
            "https://accounts.google.com/login",
            "https://google.com/"
        ));
        assert!(same_site(
            "https://google.com/a",
            "https://mail.google.com/mail"
        ));
        assert!(!same_site(
            "https://google.com.evil.io/login",
            "https://google.com/"
        ));
        assert!(!same_site("https://notgoogle.com/", "https://google.com/"));
        assert!(!same_site("https://google.com/", "https://example.com/"));
    }

    #[test]
    fn public_suffixes_need_one_more_label() {
        assert!(same_site(
            "https://accounts.bbc.co.uk/login",
            "https://bbc.co.uk/"
        ));
        assert!(!same_site("https://evil.co.uk/", "https://bbc.co.uk/"));
        assert!(!same_site("https://co.uk/", "https://bbc.co.uk/"));
        assert!(!same_site("https://bbc.co.uk/", "https://co.uk/"));
    }

    #[test]
    fn ip_addresses_match_only_themselves() {
        assert!(same_site(
            "http://127.0.0.1:8080/login",
            "https://127.0.0.1/admin"
        ));
        assert!(!same_site("https://127.0.0.1/", "https://127.0.0.2/"));
        assert!(!same_site("https://127.0.0.1/", "https://example.com/"));
        assert!(!same_site("https://[::1]/", "https://127.0.0.1/"));
        assert!(same_site("https://[::1]/a", "https://[::1]/b"));
    }

    #[test]
    fn http_is_not_https() {
        assert!(!is_https("http://example.com/"));
        assert!(is_https("https://example.com/"));
        assert!(!is_https("https://example.com\\@evil.test"));
    }
}
