# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The generator can copy its password. The copy stays out of clipboard history and clears after 30 seconds.
- The command palette opens with Ctrl/Cmd+K. Enter copies a password and Shift+Enter copies a username, both through the concealed clipboard.
- A copied password or username can be cleared immediately, and only while the clipboard still holds what quietkeys copied.
- A login's website opens in the browser only when its stored address is http or https, has a host, and has no username or password. The details panel shows that host in its normalised form.
- Settings can switch density and text size, and lists the keyboard shortcuts.
- The login list can be sorted by recently changed, and opens sorted by recently used.
- Favourites, password history, and a Recently deleted list. Deleted logins stay in the encrypted vault for 30 days, then are removed. A delete can be undone for 10 seconds; deleting forever still asks first.
- Each previous password has its own id, so copying one still copies that password after a newer change.

### Changed

- The unlocked window uses floating panels. Lock, copy controls, and navigation have moved: the sidebar is brand, search, All items, Favourites, Recently used, Generator, Settings, and Recently deleted, and a copied password or username shows a 30-second toast instead of a line of text.
- Saves use vault format version 2. A vault saved by 1.1 cannot be opened by 1.0. The first time 1.1 saves over a 1.0 vault, it keeps a one-time copy at `vault.quietkeys.v1-backup` in the same folder and never overwrites that copy.

## [1.0.0] - [RELEASE DATE]

### Added

- Vault engine: encrypted vault file, Argon2id, atomic saves, and backups.
- App state and commands, including unlock throttling and locked-state checks.
- Core UI: create a vault, unlock, search, and add, edit, delete, and reveal logins.
- Light and dark themes.
- Rust side of Phase 4: password generator and strength score, concealed clipboard, change master password, restore from backup, and encrypted export.
- App icon, and Windows and macOS installers with a SHA256 checksum file.

### Changed

- Generator and Settings are usable, and the username and password copy buttons copy to the clipboard (cleared after 30 seconds).
