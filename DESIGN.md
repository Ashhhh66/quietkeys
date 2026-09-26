# quietkeys — UI Design Spec

This file describes the exact look of the app. Match it closely. It changes **only presentation**: no behaviour, command, or security rule from PLAN.md may change, and every existing test must still pass.

Reference screenshots (attached in chat): Vault (dark + light), Unlock (normal, wrong password, throttled), Create vault.

---

## 1. Fonts and icons

- **UI text:** Instrument Sans (weights 400, 500, 600, 700).
- **Passwords:** JetBrains Mono (400, 500). Use it for every revealed or masked password.
- Bundle both **locally** with `@fontsource/instrument-sans` and `@fontsource/jetbrains-mono` (ask before adding). Never load Google Fonts: the CSP and the no-network rule forbid it.
- Fallback stacks: `'Instrument Sans', system-ui, sans-serif` and `'JetBrains Mono', ui-monospace, monospace`.
- **Icons:** `lucide-react` (approved), stroke width 2, size 16–18px unless stated.

## 2. Theme tokens

Define both themes in one place (CSS custom properties on `:root[data-theme="dark"]` and `:root[data-theme="light"]`, exposed to Tailwind). Components use tokens only, never raw hex values.

| Token                                    | Dark                        | Light                       |
| ---------------------------------------- | --------------------------- | --------------------------- |
| `page`                                   | #0F1214                     | #F6F7F5                     |
| `sidebar`                                | #0B0D0F                     | #EEF0ED                     |
| `sidebar-border`                         | #1E2428                     | #DDE2DE                     |
| `card`                                   | #151A1D                     | #FFFFFF                     |
| `card-border`                            | #232A2F                     | #E1E5E2                     |
| `text`                                   | #E6EAEC                     | #15191B                     |
| `text-soft` (notes, form labels)         | #C9D0D4                     | #323A3F                     |
| `muted`                                  | #98A2A9                     | #5B666C                     |
| `label` (uppercase labels, meta)         | #8A959C                     | #5F6B72                     |
| `nav-text`                               | #B3BCC2                     | #3A4449                     |
| `nav-active-bg`                          | #172024                     | #E0E6E2                     |
| `input-bg` (search)                      | #151A1D                     | #FFFFFF                     |
| `input-bg` (Unlock/Setup fields)         | #0F1214                     | #F6F7F5                     |
| `input-border`                           | #2A3237                     | #D5DBD7                     |
| `kbd-border`                             | #2A3237                     | #CDD4D0                     |
| `lock-bg` / `lock-border`                | #12171A / #262D32           | #FFFFFF / #D5DBD7           |
| `row-selected-bg` / `-border`            | #172A2A / #24433F           | #E2F3EE / #BCE3D8           |
| `icon-button`                            | #B3BCC2                     | #4A555B                     |
| `danger-bg` / `-border` / `-fg`          | #1A1415 / #3A2A2C / #F0A8A0 | #FDF0EE / #F0CFCB / #B0352A |
| `error-bg` / `-border` / `-fg`           | #221617 / #45292B / #F4B5AD | #FDEEEC / #F2C9C4 / #9E2F24 |
| `warn-bg` / `-border` / `-fg`            | #241F14 / #463B22 / #EBCB8B | #FBF3E1 / #EED9A8 / #744F00 |
| `badge-bg` / `badge-fg` ("Hides in 30s") | #2A2417 / #E8C27A           | #FBF1DC / #7F5400           |
| `ok-bg` / `ok-fg` (checklist ticks)      | #1B3A35 / #45C4AE           | #D6F0EA / #0F6E5F           |
| `disabled-bg` / `disabled-fg`            | #232A2F / #8A959C           | #E4E8E5 / #5A656C           |
| `accent` (buttons, brand tile)           | #45C4AE                     | #45C4AE                     |
| `on-accent` (text on accent)             | #06201C                     | #06201C                     |
| `accent-text` (links, URL)               | #45C4AE                     | #267064                     |

All text must meet 4.5:1 contrast in both themes.

### Theme switching

- Default to the OS setting (`prefers-color-scheme`) until the user chooses.
- The sidebar has a **"Light theme"** row with a sun icon and a small switch (34×20px pill, 16px white knob; track `accent` when on, #3A4449 when off). Use a real `<button>` with `aria-pressed`.
- Save the choice in `localStorage` (the theme is not secret). Apply it before first paint to avoid a flash.

## 3. Window

- Default size 1280×800, minimum 1024×640, in `tauri.conf.json`.

## 4. Vault screen (three panels)

### Sidebar (224px wide, `sidebar` bg, right border `sidebar-border`, padding 22px 12px, vertical gap 4px)

- **Brand row** (padding-bottom 22px): 32×32 tile, radius 9px, `accent` bg with a `KeyRound` icon in `on-accent`; "quietkeys" at 17px/600, letter-spacing −0.01em.
- **Nav items** (40px tall, radius 9px, padding 0 12px, 14px/500, 10px gap between icon and label):
  - "All items" (`List` icon), active: `nav-active-bg`, `text` colour, count on the right at 12px `muted`.
  - "Logins" (`KeyRound`), with count.
  - "Generator" (`Sparkles`) and "Settings" (`Settings`): open the generator and settings screens.
  - Inactive items: transparent bg, `nav-text`.
- Spacer, then the **Light theme** row, then the **Lock vault** button: 44px tall, radius 10px, `lock-bg`, 1px `lock-border`, `Lock` icon, label left-aligned, and a keyboard hint pill "Ctrl L" (⌘L on macOS) at 11px `muted`, 1px `kbd-border`, radius 5px, padding 2px 6px.

### Entry list (356px wide, right border `sidebar-border`)

- **Top bar** (padding 20px 16px 12px, gap 10px):
  - Search field: 44px tall, radius 10px, `input-bg`, 1px `input-border`, `Search` icon, placeholder "Search logins", "Ctrl F" hint pill on the right. Visually hidden label "Search".
  - Add button: 44×44, radius 10px, `accent` bg, `Plus` icon in `on-accent`, `aria-label="Add login"`.
- **Heading** (padding 4px 20px 8px): 12px/600, uppercase, letter-spacing 0.06em, `label` colour. Shows "All logins", or "N results" while searching.
- **Rows** (padding 0 10px 16px, gap 2px, scrolls): each row is a `<button>`, radius 10px, padding 10px, 1px border (transparent, or `row-selected-border` when selected; bg `row-selected-bg` when selected).
  - Avatar 38×38, radius 10px, letter 16px/700 (see section 7).
  - Title 14.5px/600, username 13px `muted`, both single-line with ellipsis.
- **No search results:** centred "No logins match that search." at 14px `muted`.
- **Empty vault:** centred message "No passwords yet" plus an accent "Add your first login" button.

### Details panel (fills remaining width, padding 32px 40px, vertical gap 24px, scrolls)

- **Header row** (gap 16px): 60×60 avatar (radius 16px, letter 26px/700); title 26px/600 letter-spacing −0.015em with the domain underneath at 14px `muted`; on the right an **Edit** button (40px tall, padding 0 16px, radius 10px, `card` bg, 1px `input-border`, `Pencil` icon) and a **Delete** icon button (40×40, radius 10px, `danger-*` tokens, `Trash2` icon, `aria-label="Delete login"`).
- **Fields card** (`card` bg, 1px `card-border`, radius 14px). Rows padding 16px 20px, divided by 1px `card-border`:
  - Label: 12px/600 uppercase, letter-spacing 0.06em, `label` colour. Value: 15px.
  - **Username** row, with a copy icon button on the right.
  - **Password** row: masked as 12 bullets (`••••••••••••`, letter-spacing 0.18em) in JetBrains Mono 15px; revealed text uses letter-spacing 0.02em. Eye / EyeOff toggle (40×40 icon button, `aria-label` "Show password"/"Hide password") and a copy button. While revealed, a pill next to the label: `Clock` icon + "Hides in 30s", 12px, `badge-*` tokens, radius 999px, padding 2px 8px.
  - **Website** row, value in `accent-text`.
  - Copy buttons copy the username or password and show “Copied, clears in 30s”. If copying is unsupported, both buttons are removed.
- **Notes card** (same card style, padding 16px 20px, gap 8px): "Notes" label, text 14.5px, line-height 1.55, `text-soft`, `white-space: pre-wrap`. Empty notes show "No notes." in `muted`.
- **Meta line:** "Created 12 Sep 2026 · Edited 25 Sep 2026" at 12.5px `label`. Format dates as day, short month, year in the user's locale.
- **Add/Edit** opens in this same right panel, using the same card style for its form fields.

## 5. Unlock screen

- Full window `page` bg, content centred.
- Card: 400px wide, padding 40px 36px, `card` bg, 1px `card-border`, radius 18px, vertical gap 22px.
- Top (centred): 56×56 tile, radius 16px, `accent` bg with a `Lock` icon (26px) in `on-accent`; "quietkeys" 24px/600; subtitle "Enter your master password to unlock your vault." 14.5px `muted`.
- Field: label "Master password" 13px/500 `text-soft`; input 46px tall, padding 0 14px, radius 10px, Unlock/Setup `input-bg`, 1px `input-border` (border turns `error` colour after a wrong password).
- **Wrong password alert** (`role="alert"`): `error-*` tokens, radius 10px, padding 12px 14px, 13.5px, `AlertCircle` icon, text "Incorrect password or corrupted vault."
- **Throttled alert** (`role="status"`): `warn-*` tokens, `Clock` icon, "Too many attempts. You can try again in N seconds." (singular "second" when N is 1).
- Primary button: full width, 46px, radius 10px, 15px/600, `accent` bg with `on-accent` text. While throttled or submitting it becomes `disabled-*` with the label "Try again in Ns" (throttled) or a spinner (submitting).
- Footer: `ShieldCheck` icon (13px) + "Your vault never leaves this computer." 12.5px `label`, centred.

## 6. Create vault (Setup) screen

- Same centred card style, 440px wide.
- Top (left-aligned): 44×44 tile radius 12px with `KeyRound`; heading "Create your vault" 24px/600; subtitle "Choose a master password. It unlocks everything, so make it long and memorable." 14.5px `muted`, line-height 1.5.
- Two fields: "Master password" and "Confirm master password", same field style as Unlock.
- **Live checklist** (13.5px, gap 8px), driven by the existing TypeScript rules:
  - "At least 12 characters"
  - "No hidden control characters"
  - "Passwords match"
  - Met: 20px circle in `ok-bg` with a `Check` icon in `ok-fg`, text `text-soft`. Not met: circle in `disabled-bg` with an `X` icon in `muted`, text `muted`.
- **Warning box** (`warn-*` tokens, `TriangleAlert` icon, 13px): "There is no password reset. If you forget your master password, your vault can't be recovered."
- "Create vault" button, full width, disabled style until every rule passes.
- Show the length counter / character counter exactly as already implemented, styled with `muted` text.

## 7. Letter avatars

- Letter: first character of the entry title, uppercased.
- Colour: hash the domain (from the URL, or the title if there's no URL) with `h = (h * 31 + charCode) >>> 0` over each character, then pick `palette[h % 6]`.
- **Dark palette** (bg / letter): #24406A / #DCE8FA, #6E4318 / #FBE6CF, #1D564E / #D2F2EC, #553670 / #EEDDFB, #662C37 / #FADDE2, #4A5320 / #EEF3D2.
- **Light palette** (bg / letter): #DCE7F8 / #1E3A66, #F8E4CD / #6B3F10, #D3EFE9 / #15524A, #EADDF7 / #4A2C66, #F7DCE1 / #6A2433, #E8EDCF / #434A16.
- Never fetch favicons or anything from the network.

## 8. Interaction and accessibility

- Every clickable thing is a real `<button>` (or link); icon-only buttons have an `aria-label`.
- Visible focus ring on keyboard focus: 2px `accent` outline with 2px offset (`:focus-visible` only).
- Hover: nav items and list rows get a subtle background (`nav-active-bg` at reduced opacity); buttons darken slightly.
- Shortcuts: Ctrl/⌘+F focuses search, Ctrl/⌘+L locks, Esc closes the editor.
- Transitions: 120–150ms on background and colour only. Respect `prefers-reduced-motion`.
- Minimum hit area 40×40px.

## 9. Stable UX

Fill and copy controls, Lock, and navigation never move without a note in the [changelog](CHANGELOG.md).
