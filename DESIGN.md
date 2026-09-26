# quietkeys — UI Design Spec (v1.1)

This replaces the v1.0 spec. It describes the 1.1 refresh: floating panels, a command palette, labelled actions, and new everyday features. Reference: the "quietkeys 1.1 — full refresh" row of the design canvas (screenshots attached in chat).

Rules that still apply:

- Presentation must never weaken a security rule in PLAN.md.
- Colours only through theme tokens (section 2), never raw hex in components.
- Fonts bundled locally: Instrument Sans (UI) and JetBrains Mono (passwords). No Google Fonts.
- Icons: lucide-react, stroke width 2.
- **Stable UX:** this release moves Lock, copy controls and navigation. The CHANGELOG for 1.1 must say so clearly. After 1.1, the rule applies again as before.

---

## 1. Layout

- Window default 1280×800, minimum 1024×640.
- The unlocked app is **three floating panels** on a background, with 12px outer padding and 12px gaps:
  1. Sidebar, 216px wide
  2. Entry list, 340px wide
  3. Details (fills the rest)
- Generator, Health and Settings replace panels 2 and 3 with one wide panel.
- Panels: radius 20px, `panel` background, 1px `panel-border`, internal scrolling only.
- Cards inside panels ("insets"): radius 16px, `inset` background, 1px `panel-border`, padding 16px 18px.

## 2. Theme tokens

Dark is the reference design. Light follows the same structure.

| Token                                           | Dark                                                                             | Light                                                                            |
| ----------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `page` (background)                             | radial-gradient(1200px 600px at 75% -10%, #12302B 0%, #0B0F10 55%, #090B0C 100%) | radial-gradient(1200px 600px at 75% -10%, #D9F1EB 0%, #F2F5F3 55%, #F6F7F5 100%) |
| `panel`                                         | rgba(21,26,29,0.72)                                                              | rgba(255,255,255,0.82)                                                           |
| `panel-border`                                  | rgba(255,255,255,0.06)                                                           | rgba(15,23,26,0.08)                                                              |
| `inset`                                         | rgba(0,0,0,0.22)                                                                 | #F4F6F4                                                                          |
| `field` (inputs)                                | rgba(0,0,0,0.25)                                                                 | #FFFFFF                                                                          |
| `text`                                          | #E8ECEE                                                                          | #15191B                                                                          |
| `text-soft`                                     | #C9D0D4                                                                          | #323A3F                                                                          |
| `muted`                                         | #98A2A9                                                                          | #5B666C                                                                          |
| `label`                                         | #8E989E                                                                          | #5A656C                                                                          |
| `nav-text`                                      | #AEB8BE                                                                          | #3A4449                                                                          |
| `nav-active-bg` / `nav-active-fg`               | rgba(69,196,174,0.14) / #CFF3EC                                                  | #DDF1EC / #0F5E52                                                                |
| `row-selected-bg`                               | rgba(69,196,174,0.10)                                                            | #E2F3EE                                                                          |
| `row-selected-ring`                             | rgba(69,196,174,0.25)                                                            | #BCE3D8                                                                          |
| `accent`                                        | #45C4AE                                                                          | #45C4AE                                                                          |
| `accent-gradient` (primary buttons, brand tile) | linear-gradient(145deg, #5CD6C0, #2FA590)                                        | same                                                                             |
| `on-accent`                                     | #06201C                                                                          | #06201C                                                                          |
| `accent-text` (links)                           | #45C4AE                                                                          | #267064                                                                          |
| `ok-bg` / `ok-fg`                               | rgba(69,196,174,0.12) / #9FDCD0                                                  | #D6F0EA / #0F6E5F                                                                |
| `warn-bg` / `warn-fg`                           | #2A2417 / #E8C27A                                                                | #FBF1DC / #7F5400                                                                |
| `danger-bg` / `danger-border` / `danger-fg`     | rgba(240,168,160,0.06) / rgba(240,168,160,0.25) / #F0A8A0                        | #FDF0EE / #F0CFCB / #B0352A                                                      |
| `toast-bg` / `toast-border`                     | #1C2327 / rgba(255,255,255,0.1)                                                  | #FFFFFF / rgba(15,23,26,0.12)                                                    |
| `overlay` (behind dialogs)                      | rgba(4,6,7,0.62)                                                                 | rgba(15,23,26,0.35)                                                              |

All text meets 4.5:1 contrast in both themes. Theme defaults to the OS setting until the user chooses.

Avatar palettes are unchanged from v1.0 (dark and light sets of 6, chosen by hashing the domain).

## 3. Typography

| Use                                         | Size / weight                                                          |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| Screen titles (Generator, Settings, Health) | 28px / 600, letter-spacing −0.02em                                     |
| Entry title in details                      | 28px / 600                                                             |
| Section labels                              | 12px / 600, uppercase, letter-spacing 0.06em, `label`                  |
| Body                                        | 14.5–15.5px / 400–500                                                  |
| Meta text                                   | 12.5–13px, `muted`                                                     |
| Passwords                                   | JetBrains Mono 15.5px; masked as 12 bullets with letter-spacing 0.18em |

## 4. Sidebar

Top to bottom:

1. Brand: 34×34 tile (radius 11px, `accent-gradient`, soft accent shadow) with KeyRound icon, "quietkeys" 17px/600.
2. **Search button** (40px, `field` background, border): search icon, "Search", "Ctrl K" hint. Opens the command palette.
3. Nav items (38px, radius 12px): All items (count), Favourites (count), Recently used, Generator, Health (count of issues), Settings, Recently deleted. Active item uses `nav-active-*`.
4. Spacer.
5. **Lock vault** button (min 50px): lock icon, "Lock vault", and underneath in 11.5px `label` the live auto-lock countdown, "Auto-locks in 4:12". "Ctrl L" hint on the right.

Items for features not built yet stay hidden until their step in PLAN-1.1.md lands.

## 5. Entry list

- Top: search field (44px, `field`) and a 44×44 Add button (`accent-gradient`).
- "Sort" label with a dropdown: Recently used (default), Name, Recently changed.
- **Favourites** section (star icon label) above **All logins**, each only shown when non-empty.
- Rows: radius 14px, padding 10px 12px, 40×40 avatar (radius 12px), title 14.5px/600, username 13px `muted`, "last used" text on the right (12px). Selected row: `row-selected-bg`, inset ring, and a 3px accent bar on the left edge.

## 6. Details panel

1. **Header:** 68×68 avatar (radius 20px, soft shadow), title with a **favourite star** button (filled `warn-fg` when on), and the domain as an `accent-text` link with an external-link icon that opens the website in the default browser. Edit button (secondary) and Delete icon button (`danger-*`).
2. **Action row:** "Copy password" (primary, 44px, with "Ctrl C" hint) and "Copy username" (secondary, "Ctrl B" hint).
3. **Two insets side by side:** Username; Password (masked, Show/Hide text button top-right, 30-second auto-hide unchanged).
4. **Status pills:** strength or health status (`ok-*` or `warn-*`), "Changed 3 months ago", "Used today".
5. **Notes** inset.
6. **Password history** inset: a collapsible header ("Password history", "2 previous"), rows showing a masked value, "Used until 12 Jun 2026", and Copy. Values are never shown in the list.

## 7. Toasts (bottom-right, stacked, 10px apart)

- **Clipboard toast** (60px, `toast-*`): a 34px progress ring counting down from 30 with the seconds in the middle, "Password copied" / "Username copied", "Clears from clipboard in 24s · not in history", and a "Clear now" button. It disappears when the clipboard clears.
- **Undo toast** (52px): trash icon, "Deleted **GitHub**", and an "Undo" button (`ok` tint). Visible for 10 seconds.
- Toasts use `role="status"`.

## 8. Command palette

- Opens with Ctrl/Cmd+K or the sidebar Search button. Closes with Esc or a click on the overlay.
- 620px wide, top 110px from the window top, radius 18px, `toast-bg`, strong shadow, over `overlay`.
- Input row 60px, 17px text, "Esc" hint.
- **Logins** section: up to 5 matches (title and domain), the highlighted one shows "↵ Copy password".
- **Actions** section: Generate a password (Ctrl G), Add a login (Ctrl N), Lock vault (Ctrl L).
- Footer hints: "↵ Copy password", "Shift ↵ Copy username", "↑↓ Move".
- Enter copies the highlighted login's password through the existing secure copy command, closes the palette, and shows the clipboard toast.
- Fully keyboard operable, `role="dialog"`, focus trapped while open and returned afterwards.

## 9. Unlock screen

- Centred 420px panel: 60px accent tile with a lock icon, "Welcome back", subtitle.
- Master password field (48px) with a focus ring and a show/hide eye button inside it.
- **Caps Lock warning** under the field (`warn-fg`, alert icon) whenever Caps Lock is on.
- Primary "Unlock" button (48px).
- Footer row: shield icon + "Vault on this computer only" on the left, "Restore from backup" link on the right.
- Wrong password and throttle alerts as in v1.0.

## 10. Generator

- Title plus a segmented control: **Password | Passphrase**.
- Result inset: the value in JetBrains Mono 30px. In passphrase mode, separators in `accent` and the number in `warn-fg`.
- Strength bar (5 segments) with a label ("Very strong") and a plain-English line.
- Actions: Copy (primary), Regenerate, "Save as new login".
- Options as insets in a 2-column grid. Passphrase: words 3–10 (default 4), separator chips (- . _ space), "Capitalise the first word", "Add a number". Password mode keeps the v1.0 options.
- Tip banner (`ok` tint): "Passphrases make great master passwords: long, strong, and something you can actually type."

## 11. Settings

1. **"Where your data lives"** hero card (accent-tinted gradient, `ok` border): shield icon, title, "Everything stays on this computer. Nothing is ever uploaded." A 2×2 grid:
   - Vault file: full path in mono 13px, "Show in folder"
   - Last saved: relative time
   - Backup: health pill ("Healthy · saved 2 min ago"), "Export a copy"
   - Encryption: "Argon2id · XChaCha20-Poly1305", "How it works" (links to the README section on GitHub)
2. Two insets side by side:
   - **Security:** Auto-lock (segmented 1m/5m/15m/30m), Clear clipboard (30 seconds, fixed), Master password ("Last changed …", Change).
   - **Appearance:** Theme (System/Light/Dark), Density (Comfortable/Compact), Text size (A/A+/A++).
3. Footer: version and licence on the left, "Keyboard shortcuts" link on the right (opens a list).

Density "Compact" reduces row padding and control heights by about 20%. Text size scales the base font by 1, 1.1 and 1.2.

## 12. Vault health

- Title and subtitle "Checked on this computer. Nothing is sent anywhere."
- Three summary insets: Strong, Weak, Reused (46px number tiles, `ok` or `warn` tints).
- "Fix these first" list: one inset per issue with the avatar, title, a problem pill, a plain-English explanation, and action buttons ("Generate a new password" primary, "Open discord.com" secondary). Reused passwords are grouped into one issue per shared password.
- Tip banner about updating the password here after changing it on the website.

## 13. Recently deleted

- Same list style as the entry list, each row showing "Deleted 3 days ago · removed forever in 27 days", with Restore and "Delete forever".
- Banner: "Deleted logins are kept for 30 days, still encrypted, then removed."

## 14. Accessibility and motion

- Every control is a real button or link; icon-only buttons have `aria-label`.
- `:focus-visible` ring: 2px `accent`, 2px offset.
- Full keyboard navigation, including list rows (↑↓, Enter to select).
- Transitions 120–160ms on colour, background, opacity and transform only. `prefers-reduced-motion` disables the ring animation and toast slide-in.

## 15. Stable UX

Fill and copy controls, Lock, and navigation don't move without a note in the changelog.
