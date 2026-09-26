# quietkeys 1.1 — Build Plan

Read together with PLAN.md (security rules) and DESIGN.md (the 1.1 spec). Work one step at a time. Each step: summarise the plan, wait for approval, implement with tests, run every check (cargo test, clippy -D warnings, fmt --check, npm run lint, npm run format:check, npm test), commit and push. Never create tags.

**Prerequisite:** v1.0.0 is published before any 1.1 work starts.

---

## Step 1 — Visual refresh (UI only)

Restyle every existing screen to DESIGN.md sections 1–7, 9 and 14 using only features that already exist.

- New tokens for both themes, floating panels, the new sidebar, list and details layout, labelled action buttons, status pills and the clipboard toast (driven by the existing copy commands and the 30-second clear).
- Hide sidebar items whose features don't exist yet (Favourites, Recently used, Health, Recently deleted).
- Unlock: show/hide eye button and Caps Lock warning (`getModifierState("CapsLock")` on key and focus events).
- Lock button shows the live auto-lock countdown from `useIdleLock`.
- Behaviour tests must keep testing the same behaviour; update only copy and structure assertions, and list every changed test.

## Step 2 — Speed features (UI only, one small Rust addition)

- Command palette per DESIGN.md section 8, keyboard shortcuts (Ctrl/Cmd+K, C, B, G, N, L, F, Esc) and a "Keyboard shortcuts" list in Settings.
- Density and text size settings (localStorage).
- **Clear clipboard:** add `clear_clipboard`, which clears the clipboard only when its change counter still matches the value quietkeys copied (the same check as the 30-second clear). The clipboard toast gets a "Clear now" button that calls it.
- **Open website:** add `tauri-plugin-opener` (ask first) with only the permission to open URLs. Rust validates the URL before opening: `https://` or `http://` only, with a host. Anything else (`file:`, `javascript:`, custom schemes) is refused with an error. Test the validation.
- Tests: palette filtering, Enter and Shift+Enter copy, focus trap and return, shortcut handling, URL validation.

## Step 3 — Vault format v2 and entry features (Rust + UI)

These add fields to entries, so the vault format changes.

- Bump the vault format to **version 2**. New optional entry fields: `favourite` (bool), `last_used_at`, `password_history` (list of `{ password, replaced_at }`), `deleted_at`.
- Loading a version 1 vault migrates it in memory; the next save writes version 2. Keep `deny_unknown_fields`. Tests: v1 fixture loads and saves as v2 with nothing lost; unknown versions still fail.
- **Favourites:** `set_favourite(id, bool)`.
- **Recently used:** set `last_used_at` when a password or username is copied. Batch these into the next save (or save at most once a minute and on lock) so copying doesn't write the file every time.
- **Password history:** when `update_entry` changes a password, push the old one with `replaced_at`, keep the newest 10. Passwords are wiped from memory like the others, never included in `list_entries` or `get_entry`, and copied only via a new `copy_history_password(id, index)` that uses the secure clipboard. Counts toward field limits.
- **Recently deleted:** `delete_entry` sets `deleted_at` instead of removing. `restore_entry(id)` and `delete_forever(id)`. Entries deleted more than 30 days ago are purged (and wiped) on unlock. Deleted entries are excluded from list, search, palette and health.
- UI: favourite star, Favourites and Recently used sections, sort menu, password history inset, undo toast (calls `restore_entry`), and the Recently deleted screen (DESIGN.md section 13).
- Update the threat model: deleted logins stay in the encrypted vault for up to 30 days, and old passwords are kept in history.

## Step 4 — Passphrase generator (Rust + UI)

- Bundle the EFF Large Wordlist (7,776 words) in the Rust binary, with its licence attribution (CC BY 3.0) in the README and an ATTRIBUTIONS file.
- `generate_passphrase(words 3–10, separator, capitalise, add_number)` using the OS CSPRNG with rejection sampling (no modulo bias). Tests for every option and the range limits.
- Generator UI per DESIGN.md section 10, including Copy (secure clipboard) and "Save as new login" (opens the editor pre-filled).

## Step 5 — "Where your data lives" (Rust + UI)

- `vault_info()` returning: vault path, last saved time, whether a backup exists and when it was saved, and the KDF and cipher names. Allowed only while unlocked. No secrets in the result.
- "Show in folder" via the opener plugin's reveal-in-folder permission, limited to the vault folder.
- Settings screen per DESIGN.md section 11.

## Step 6 — Vault health (Rust + UI)

- `vault_health()` computed entirely in Rust while unlocked: weak (zxcvbn score 0–2) and reused (identical passwords, compared in memory) entries, returned as entry ids, titles and issue types only. Passwords never leave Rust. Excludes deleted entries.
- Health screen per DESIGN.md section 12, the Health count in the sidebar, and status pills in the details panel.
- Tests: weak detection, reused grouping, deleted entries excluded, no password values in the result.

---

## After all steps

- Update README (features, screenshots, threat model), ROADMAP (vault health moves from Phase 6 into 1.1), CHANGELOG (1.1.0 with a clear Stable UX note that Lock, copy controls and navigation moved), and docs/RELEASE_CHECKLIST.md (palette, favourites, undo, history, passphrase, health).
- Version 1.1.0, then the usual release process.
