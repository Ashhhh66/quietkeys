//! Browser Native Messaging host. It forwards stdin frames to the desktop app and
//! writes the replies to stdout. It does not open the vault and it does not log messages.

fn main() {
    std::process::exit(quietkeys_lib::host::run_stdio());
}
