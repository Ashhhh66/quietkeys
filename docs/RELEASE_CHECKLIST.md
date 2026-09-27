# Release checklist

Run these by hand on a built app before tagging a release.

## Unlock and throttle

- A wrong master password shows "Incorrect password or corrupted vault." and clears the field.
- After repeated wrong passwords, the screen counts down and the button stays disabled until the wait ends.
- The right password unlocks the vault.

## Copy and clipboard history

- Copy username and copy password each show "Copied, clears in 30s".
- The copied value does not appear in Windows clipboard history (Win+V) or in macOS clipboard history.
- About 30 seconds later the clipboard no longer holds that value, if nothing else replaced it.

## Auto-lock, including after sleep

- With the default of 5 minutes, an idle unlocked vault locks itself.
- Sleep the computer for longer than the timeout, then wake it. The vault locks within about 5 seconds.

## Export

- Export opens a save dialog whose suggested name is `quietkeys-backup-YYYY-MM-DD.quietkeys`.
- Cancelling the dialog writes nothing.
- Choosing a file that already exists shows "A file with that name already exists. Choose a different name."

## Change master password

- The button stays disabled until the new password passes the checklist and the confirmation matches.
- On success the three fields are empty, and the screen says that backups exported earlier still open with the old password.
- The new password unlocks the vault. The old password does not.

## Restore

- Unlock offers "Restore from backup", and the confirmation says the current vault will be moved to `vault.quietkeys.pre-restore`.
- The backup password opens that vault. A wrong password uses the same alert as Unlock.
- When the vault file is missing and only the backup exists, Setup offers the same restore.

## Generator over the editor

- Edit a login and change the title without saving.
- Open the generator and choose "Use this password".
- The unsaved title is still there, and the password field shows the generated password.

## Both themes

- Switch between light and dark. Text, buttons, empty states, and the keyboard focus ring stay readable in both.

## Command palette

- Ctrl/Cmd+K opens the palette. Esc closes it.
- Enter copies the highlighted login's password and Shift+Enter copies the username. Both use the concealed clipboard toast.

## Favourites and recently used

- Starring a login lists it under Favourites. The star in the details panel matches.
- Copying a password or username makes the login appear under Recently used.

## Password history

- Changing a login's password adds a masked row under Password history, with Copy.
- Copy uses the concealed clipboard. The previous password is not shown in the list.

## Delete, undo, and recently deleted

- Delete shows an undo toast for about 10 seconds. Undo puts the login back.
- After the toast, the login is under Recently deleted and is absent from All items, search, and the palette.
- Delete forever asks first and removes it.

## Passphrase generator

- Passphrase mode uses the word list. Changing the word count, separator, capitalise, or number regenerates the phrase.
- The strength label follows those options.

## Where your data lives

- Settings shows the vault path with the home folder shortened (`%LOCALAPPDATA%\...` on Windows, `~/...` on macOS).
- Show in folder reveals the real vault file.
- A backup that still opens shows Healthy with a relative time. A missing backup says there is no backup yet.
- How it works opens the security section of the README.

## Vault health

- Health shows Strong, Weak, and Reused counts, and one card per issue.
- A reused password is one card. A login that is also weak has a Weak pill on that card and no separate weak card.
- Generate a new password opens the editor with the generator. Open uses that login's stored website.
- The details pills for that login match the Health screen.

## Upgrade from 1.0

- Open a vault last saved by 1.0, then save any change.
- The vault file is format version 2, and `vault.quietkeys.v1-backup` sits beside it. A later save does not overwrite that copy.
- quietkeys 1.0 cannot open the new vault file. It can still open the v1 backup with the password from before the upgrade.
