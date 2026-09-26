# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Vault engine: encrypted vault file, Argon2id, atomic saves, and backups.
- App state and commands, including unlock throttling and locked-state checks.
- Core UI: create a vault, unlock, search, and add, edit, delete, and reveal logins.
- Light and dark themes.
- Rust side of Phase 4: password generator and strength score, concealed clipboard, change master password, restore from backup, and encrypted export.

### Changed

- Generator and Settings are usable, and the username and password copy buttons copy to the clipboard (cleared after 30 seconds).
