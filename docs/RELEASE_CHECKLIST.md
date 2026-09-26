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
