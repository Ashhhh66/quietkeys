# Native host installer steps

The desktop app listens on a user-only local socket. `quietkeys-native-host` is the program Chrome starts. It only forwards messages.

The manifest allows one extension id: `mmgnphcfacceojicelmchbgpmgclieda`.

That id is derived from the public key in `extension/manifest.json`, so an unpacked build of this extension keeps the same id. `allowed_origins` is `chrome-extension://mmgnphcfacceojicelmchbgpmgclieda/` and nothing else.

The Chrome Web Store assigns a different id the first time the extension is published. Update this id and `CHROME_EXTENSION_ID` in `src-tauri/src/host.rs` to the store id before a published build can connect. Firefox is not part of this version.

## Build the extension

From the repository root, run `npm run build:extension`. In Chrome, open `chrome://extensions`, turn on Developer mode, and load `extension/dist`. Reload any page where you want the field icon.

## Pair

1. Unlock quietkeys and choose Pair a browser in Settings.
2. Type the 6-digit code into the extension.
3. Click the icon in a password field, then click the login to fill it. Nothing is filled on its own.
4. After you submit a login form, confirm the save in Settings. The extension does not write the vault itself.

## Windows

1. Install `quietkeys-native-host.exe` next to the app.
2. Write `com.quietkeys.native_host.json` somewhere permanent. `path` is the full path of the exe. `allowed_origins` is `chrome-extension://mmgnphcfacceojicelmchbgpmgclieda/` and nothing else. `type` is `stdio`.
3. Set the default value of `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.quietkeys.native_host` to the full path of that json file.

## macOS

Copy the same json file to:

`~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.quietkeys.native_host.json`

`path` must be the absolute path of the host binary.

## Linux

Copy it to:

`~/.config/google-chrome/NativeMessagingHosts/com.quietkeys.native_host.json`
