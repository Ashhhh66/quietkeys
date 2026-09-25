# Password Manager — Build Plan (for Cursor)

> Working name: **quietkeys** (rename freely). A local-only, encrypted desktop password manager for Windows and macOS.
> This file is the single source of truth for the project. The AI assistant must read it before every task and follow it exactly.

---

## 1. Goal

Build a desktop password manager that stores credentials in a single encrypted vault file on the user's machine, plus a companion browser extension that fills logins by talking to the desktop app. No cloud, no accounts, no network access. It is a portfolio and learning project, and the README must say it has not been independently audited.

**Build order:** the desktop app (Phases 0–5) must be finished and working before any extension work starts (Phases 6–7).

## 2. Tech stack

| Layer | Choice |
|---|---|
| App shell | Tauri 2 |
| Frontend | React + TypeScript + Vite |
| Styling | Tailwind CSS |
| Backend / crypto | Rust |
| Key derivation | `argon2` crate (Argon2id) |
| Encryption | `chacha20poly1305` crate (XChaCha20-Poly1305) |
| Secret handling | `zeroize` and `secrecy` crates |
| Randomness | `rand` with `OsRng` / `getrandom` only |
| Strength meter | `zxcvbn` crate |
| Clipboard | `tauri-plugin-clipboard-manager` |
| Serialization | `serde`, `serde_json`, `base64` |
| Entry IDs and timestamps | `uuid` (v4 feature), `time` (RFC3339 formatting) |
| Password normalisation | `unicode-normalization` (NFC) |
| Tests | `cargo test` (Rust), Vitest (frontend) |
| Browser extension | Manifest V3, TypeScript, Vite (Chrome first, Firefox later) |
| Extension ↔ app bridge | Browser Native Messaging + local IPC (`interprocess` crate: named pipe on Windows, Unix socket on macOS) |
| Domain matching | `psl` crate (Public Suffix List) |

## 3. Security design (non-negotiable)

1. **Never invent cryptography.** Only use the crates listed above with their standard APIs.
2. **The master password is never stored**, logged, or written to disk in any form.
3. **Key derivation:** Argon2id with a random 16-byte salt. Default params: memory 64 MiB, iterations 3, parallelism 1. Params are stored in the vault header so they can be raised later. **Minimum params** (enforced in Rust; lower values are rejected outside tests): memory 19 MiB (`m_kib >= 19456`), iterations 2, parallelism 1. A vault unlocked with params weaker than the defaults is re-encrypted with a new salt and the default params on its next save. The master password is normalised to NFC and non-ASCII spaces are mapped to U+0020, based on RFC 8265's OpaqueString profile (not a full implementation). New master passwords may not contain control characters.
4. **Encryption:** XChaCha20-Poly1305 with a fresh random 24-byte nonce on **every** save. The serialized header is passed as associated data (AAD), so any tampering with the header or ciphertext makes decryption fail.
5. **Wrong password = decryption failure.** No separate password hash or "verifier" is stored.
6. **All crypto lives in Rust.** The encryption key never crosses to the frontend.
7. **Secrets in memory** are wrapped in `secrecy`/`zeroize` types and wiped when the vault locks or the app closes.
8. **Passwords are fetched on demand.** The entry list sent to the frontend contains titles, usernames and URLs only. A password is sent only when the user reveals or copies it.
9. **Atomic saves:** write to a temp file in the same directory, flush, then rename over the old vault, so a crash never corrupts it.
10. **Randomness** comes only from the OS CSPRNG. The password generator must avoid modulo bias.
11. **No network.** The app and extension make zero network requests. The extension talks to the desktop app only through browser Native Messaging and local IPC, never via a localhost HTTP server or open port. Tauri capabilities/permissions are locked down to only what is needed.
12. **No secrets in logs, errors, or panics.** Error messages to the UI are generic ("Incorrect password or corrupted vault").
13. **Vault location and permissions:** store the vault in the OS app data directory (via Tauri's path API), never next to the executable. On macOS/Linux set file permissions to owner-only (`0600`).
14. **Keep a backup:** before every save, copy the current vault to `vault.quietkeys.bak`, but only if it decrypts with the current key, so a corrupted file never replaces a good backup. Losing the vault means losing every password, so this is as important as the encryption.
15. **Frontend hygiene:** the frontend holds revealed passwords only as long as they are on screen, and clears all state on lock. Right-click menus and text selection are disabled on hidden password fields.
16. **Locked-down webview:** a strict Content Security Policy, devtools disabled in release builds, and Tauri capabilities granting only the plugins actually used.
17. **Unlock throttling:** after 3 failed unlock attempts, add an increasing delay in the UI. (Argon2id already makes offline guessing slow; this just discourages casual guessing.)
18. **Master password length:** a new master password must be at least 12 characters (Unicode characters, not bytes, counted after normalisation). This is enforced in Rust when creating a vault or changing the master password, not only in the UI.

## 4. Vault file format

A single JSON file, e.g. `vault.quietkeys`:

```json
{
  "version": 1,
  "kdf": { "alg": "argon2id", "m_kib": 65536, "t": 3, "p": 1, "salt": "<base64>" },
  "cipher": { "alg": "xchacha20poly1305", "nonce": "<base64>" },
  "ciphertext": "<base64>"
}
```

- Everything except `ciphertext` and `cipher.nonce` is the **header**. Define it as a Rust struct with fixed field order, serialize it with `serde_json`, and use those exact bytes as AAD. On load, rebuild the struct from the parsed file and re-serialize it the same way before decrypting. Add a test proving the bytes are identical after a round trip.
- `version` exists so the format can change later. Loading an unknown version must fail with a clear error, and any future format change must include a migration function plus tests.
- The decrypted plaintext is JSON:

```json
{
  "entries": [
    {
      "id": "uuid",
      "title": "string",
      "username": "string",
      "password": "string",
      "url": "string",
      "notes": "string",
      "created_at": "RFC3339",
      "updated_at": "RFC3339"
    }
  ]
}
```

## 5. Architecture

```
src-tauri/src/
  main.rs            // Tauri setup, command registration
  crypto.rs          // derive_key, encrypt, decrypt (pure functions, fully tested)
  vault.rs           // Vault struct, file format, load/save, atomic write
  state.rs           // AppState: Mutex<Option<UnlockedVault>>, lock/unlock
  commands.rs        // #[tauri::command] functions, the only bridge to the UI
  generator.rs       // password generator + strength scoring
  error.rs           // error types that never leak secrets
src/
  App.tsx
  api.ts             // typed wrappers around invoke()
  screens/           // Setup, Unlock, VaultList, EntryEditor, Generator, Settings
  hooks/useIdleLock.ts
```

### Tauri commands (the full API surface)

| Command | Purpose |
|---|---|
| `vault_exists()` | Is there a vault file yet? |
| `create_vault(master_password)` | First-time setup |
| `unlock(master_password)` | Derive key, decrypt, hold in state |
| `lock()` | Zeroize and drop unlocked state |
| `list_entries()` | Titles/usernames/URLs only, no passwords |
| `get_password(id)` | Return one password on demand |
| `add_entry(entry)` / `update_entry(id, entry)` / `delete_entry(id)` | CRUD, saves immediately |
| `generate_password(options)` | Returns a generated password |
| `score_password(password)` | Returns zxcvbn score 0–4 + feedback |
| `change_master_password(old, new)` | Re-derive key with new salt and re-encrypt |

Every command except the first three and the generator/scorer must return an error if the vault is locked.

## 5b. Browser extension architecture

```
Browser extension  ──(Native Messaging, stdio)──►  native-host binary  ──(local IPC)──►  Desktop app
 (popup + content script)                          (tiny Rust program)                  (holds unlocked vault)
```

- **The desktop app is the only thing that ever decrypts the vault.** The extension never sees the vault file, the key, or the master password, and never stores passwords.
- **native-host** is a small separate Rust binary. The browser launches it and talks to it over stdin/stdout. It forwards validated messages to the running desktop app over a local socket and relays replies. It holds no secrets.
- The native messaging host manifest lists **only this extension's ID** in `allowed_origins`.
- The IPC socket/pipe is created in a user-only location, restricted to the current OS user.
- If the desktop app is not running or the vault is locked, the extension shows "Unlock quietkeys on your computer" and does nothing else.

### Pairing
- The first time an extension connects, the desktop app shows an approval prompt with a 6-digit code. The user types the code into the extension to confirm.
- On approval the app issues a random pairing token (32 bytes) that the extension stores and sends with every request. The app stores only a hash of it.
- The desktop Settings screen lists paired browsers and can revoke any of them.

### Extension messages (the full API)
| Message | Returns |
|---|---|
| `status` | `locked` / `unlocked` / `not_paired` |
| `find_logins(url)` | titles + usernames of entries whose domain matches, no passwords |
| `get_login(id, url)` | username + password, **only if** the domain still matches and the user triggered it |
| `save_login(url, username, password)` | asks the user to confirm in the desktop app before saving |

All messages have a strict schema, a size limit, and are rejected if malformed.

### Autofill rules (anti-phishing)
- Match on the **registrable domain** (eTLD+1 via the Public Suffix List), so `accounts.google.com` matches `google.com` but `google.com.evil.io` does not.
- Never fill on `http://` pages unless the user explicitly allows it for that entry.
- **No automatic filling on page load.** Filling only happens after a user action (clicking the extension popup or the field icon). This blocks hidden-form attacks that steal autofilled passwords.
- Never fill into cross-origin iframes.
- The content script only reads/writes login fields; it never sends page contents anywhere.
- Request the minimum extension permissions. Use `activeTab` where possible instead of broad host permissions.

## 6. Build phases

Work through one phase at a time. Do not start the next phase until every acceptance check in the current one passes.

### Phase 0 — Project setup
- Scaffold Tauri 2 + React + TypeScript + Vite, add Tailwind.
- Add Rust dependencies from section 2.
- Set up `cargo fmt`, `clippy`, ESLint, Prettier.
- **Done when:** the app launches an empty window and `cargo test` runs.

### Phase 1 — Crypto and vault engine (Rust only, no UI)
- `crypto.rs`: `derive_key`, `encrypt`, `decrypt` with AAD.
- `vault.rs`: create, serialize, load, save with atomic write.
- **Tests required:**
  - round trip: create → save → load → decrypt returns identical data
  - wrong password fails
  - modifying any byte of ciphertext fails
  - modifying the header (e.g. salt or params) fails
  - two saves of identical data produce different nonces and ciphertext
  - a failed save never leaves a corrupted vault
  - a `.bak` copy of the previous vault exists after a save
  - an unknown `version` is rejected
- Tests may use low Argon2 params (via `#[cfg(test)]`) so they run fast. Real builds always use the defaults from section 3.
- **Done when:** all tests pass and `clippy` has no warnings.

### Phase 2 — App state and commands
- `state.rs` and `commands.rs` implementing the command table.
- Locked-state checks on every protected command.
- Entry IDs use the `uuid` crate (v4 feature) and timestamps use the `time` crate formatted as RFC3339. Do not hand-roll either.
- **Tests required:** commands fail while locked; `lock()` clears state.

### Phase 3 — Core UI
- Setup screen (create master password with confirmation and strength meter).
- Unlock screen.
- Vault list with search.
- Add / edit / delete entry.
- Reveal password (hidden by default).
- **Done when:** a user can create a vault, add entries, close the app, reopen, unlock and see them.

### Phase 4 — Security features
- Password generator: length 8–128, toggles for upper/lower/digits/symbols, option to exclude ambiguous characters, no modulo bias.
- Copy to clipboard, auto-clear after 30 seconds **only if** the clipboard still contains that password.
- Stop copied passwords landing in clipboard history: on Windows, mark the clipboard data with the `ExcludeClipboardContentFromMonitorProcessing` format so Win+V history and cloud clipboard skip it; on macOS, add the `org.nspasteboard.ConcealedType` marker. This may need small platform-specific Rust code instead of the clipboard plugin.
- "Restore from backup" option on the unlock screen that loads `vault.quietkeys.bak`.
- Encrypted export: save a copy of the vault to a location the user chooses (for their own backups). No plaintext export in the first version.
- Auto-lock after 5 minutes idle (configurable) and on system sleep if feasible.
- Change master password (new password must meet the 12-character minimum). This must immediately re-save `vault.quietkeys.bak` under the new key (with a new salt), so the old password can no longer unlock any file.
- Strength meter on entry passwords.

### Phase 5 — Polish and publish
- Consistent design, keyboard shortcuts (Ctrl/Cmd+F search, Ctrl/Cmd+L lock).
- Empty states and friendly error messages.
- Tauri bundling for Windows (.msi) and macOS (.dmg).
- GitHub Actions: lint, test, and build on every push, plus `cargo audit` and `npm audit` to catch vulnerable dependencies. Enable Dependabot.
- Code signing: unsigned apps trigger macOS Gatekeeper and Windows SmartScreen warnings. Signing and notarizing on macOS needs a paid Apple Developer account. Until then, explain the warning and how to open the app in the README.
- README with screenshots, features, security design, **threat model**, limitations, and an "not independently audited" disclaimer.

### Phase 6 — Native host and pairing (no browser UI yet)
- Build the `native-host` binary and the IPC listener inside the desktop app.
- Implement pairing, token hashing, revocation, and the message schema from section 5b.
- Write installer steps that register the native messaging host manifest for Chrome on Windows (registry key) and macOS (manifest file).
- **Tests required:** malformed/oversized messages rejected; unpaired or revoked tokens rejected; every request fails while the vault is locked; domain matching tests covering subdomains, lookalike domains, IP addresses, `http://` and public suffixes like `co.uk`.
- **Done when:** a test script can pair, call `find_logins`, and get correct results through the native host.

### Phase 7 — Browser extension
- Manifest V3 extension in TypeScript: popup showing status and matching logins, a small icon in login fields, fill on click, pairing screen.
- "Save this login?" prompt after a form submit, confirmed in the desktop app.
- Chrome first; Firefox once stable (manifest differences only).
- **Done when:** on a real site, the user can pair, click to fill a matching login, and save a new login, with no filling on non-matching or lookalike domains.
- Publish to the Chrome Web Store (one-off developer fee) with a privacy policy stating the extension collects no data.

## 7. Threat model (for the README)

**Protects against:** someone who steals the vault file; casual access to an unlocked-then-idle machine (auto-lock); tampering with the vault file; phishing sites on lookalike domains (no autofill); malicious pages trying to trigger silent autofill; other programs or extensions talking to the desktop app without pairing.

**Does not protect against:** malware or keyloggers on the user's machine; a weak master password; someone with access while the vault is unlocked; memory forensics on a compromised machine.

**Known limitation:** the master password and revealed passwords pass through JavaScript strings in the webview, which cannot be reliably wiped from memory. Rust-side secrets are zeroized, but the frontend copies are only released to the garbage collector. Similarly, once a password is filled into a web page, that page's own scripts can read it; this is true of every password manager. A compromised browser or malicious extension with broad permissions is out of scope.

**Known limitation:** serializing the vault before encryption can leave small fragments of plaintext in freed memory. The final buffer is wiped, and it is pre-allocated to an estimated size so it rarely has to grow and leave old copies behind.

**Dependencies:** no pre-release crates are used. Checked on 2026-09-25: `argon2` 0.6.0, `chacha20poly1305` 0.11.0, `rand` 0.10.3 and `getrandom` 0.4.3 are all the latest stable releases, and `Cargo.lock` contains no `-rc`, `-pre`, `-alpha` or `-beta` versions.

## 7b. Git hygiene

- `.gitignore` must exclude `*.quietkeys`, `*.bak`, `target/`, `node_modules/` and any test vault output.
- Never commit a vault containing real passwords, even an encrypted one.
- Commit after every completed phase with a clear message, so any phase can be rolled back.

## 8. Rules for the AI assistant

- Read this file before every task. If a request conflicts with section 3, stop and say so.
- Work only on the current phase. Keep changes small and focused.
- Explain any crypto-related code in plain English after writing it.
- Write tests alongside code, not afterwards.
- Never add network requests, telemetry, analytics or new dependencies without asking.
- Never log, print or include secrets in errors.
- Prefer clear, boring code over clever code.
- After each task, list what changed and how to test it manually.
