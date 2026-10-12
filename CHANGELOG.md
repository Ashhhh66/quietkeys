# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- After a new vault is created, quietkeys explains that the master password cannot be recovered and can print an Emergency Kit. The kit leaves the password blank.
- Logins can be imported from a CSV. The file is chosen in the app, and the screen shows only how many were added.
- A recovery code can open a vault when the master password is forgotten. It is shown once and is not stored. Existing vaults stay on format version 2 until a code is created.
- The vault file can be moved to another folder. A folder that already has a vault is refused.
- A login can store a one-time code. The secret stays in the vault; the screen shows the current code.

### Fixed

- On Linux, Settings shortens the home folder to `~/`, the same way macOS does, so the username stays off screen.

## [1.1.0] - 2026-09-27

### Added

- The generator can copy its password.
- The command palette opens with Ctrl/Cmd+K. Enter copies a password and Shift+Enter copies a username.
- A copied password or username can be cleared immediately.
- A login's website opens in the browser. The details panel shows that host in its normalised form.
- Settings can switch density and text size, and lists the keyboard shortcuts.
- The login list can be sorted by recently changed, and opens sorted by recently used.
- Favourites and a Recently deleted list. A delete can be undone for 10 seconds; deleting forever still asks first.
- Each previous password has its own id, so copying one still copies that password after a newer change.
- The generator can build a passphrase from the EFF Large Wordlist. It regenerates when an option changes. Generated passwords and passphrases show strength from those options; passwords you type still use zxcvbn.
- Settings shows where the vault file lives, with the home folder shortened so the username is not on screen.
- Vault health lists weak and reused logins.

### Changed

- Lock, copy controls, and navigation have moved. The unlocked window uses floating panels. The sidebar is brand, search, All items, Favourites, Recently used, Generator, Health, Settings, and Recently deleted. A copied password or username shows a 30-second toast instead of a line of text.

### Security

- Copies stay out of clipboard history and clear after 30 seconds. Clear now works only while the clipboard still holds what quietkeys copied.
- A website opens only when its stored address is http or https, has a host, and has no username or password.
- Deleted logins stay encrypted in the vault for 30 days, then are removed. Previous passwords stay encrypted in that login's history until you delete the login forever or the 30 days pass.
- A backup is called healthy only when it still opens with the current key.
- Vault health runs on this computer. The screen receives ids, titles, domains, and issue kinds. Passwords and scores stay in Rust.
- Saves use vault format version 2. A vault saved by 1.1 cannot be opened by 1.0. The first time 1.1 saves over a 1.0 vault, it keeps a one-time copy at `vault.quietkeys.v1-backup` in the same folder and never overwrites that copy.

## [1.0.0] - 2026-09-26

### Added

- Vault engine: encrypted vault file, Argon2id, atomic saves, and backups.
- App state and commands, including unlock throttling and locked-state checks.
- Core UI: create a vault, unlock, search, and add, edit, delete, and reveal logins.
- Light and dark themes.
- Rust side of Phase 4: password generator and strength score, concealed clipboard, change master password, restore from backup, and encrypted export.
- App icon, and Windows and macOS installers with a SHA256 checksum file.

### Changed

- Generator and Settings are usable, and the username and password copy buttons copy to the clipboard (cleared after 30 seconds).
