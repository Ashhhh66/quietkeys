//! The native-host process must not echo a request when the desktop app is not running.

use std::io::Write;
use std::process::{Command, Stdio};

#[test]
fn native_host_does_not_echo_a_secret_when_the_app_is_closed() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_quietkeys-native-host"))
        .env("QUIETKEYS_IPC", "quietkeys-missing-host-for-test")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("native host binary");
    let secret = "super-secret-password-value";
    let body = format!(
        r#"{{"type":"save_login","token":"aaaa","url":"https://example.com","username":"ada","password":"{secret}"}}"#
    );
    let mut stdin = child.stdin.take().expect("stdin");
    let len = u32::try_from(body.len()).expect("len").to_le_bytes();
    stdin.write_all(&len).expect("length");
    stdin.write_all(body.as_bytes()).expect("body");
    drop(stdin);
    let output = child.wait_with_output().expect("wait");
    let text = String::from_utf8_lossy(&output.stdout);
    assert!(text.contains("unavailable"), "{text}");
    assert!(!text.contains(secret), "{text}");
    assert!(!text.contains("example.com"), "{text}");
}
