# Native host installer steps

The desktop app listens on a user-only local socket. `quietkeys-native-host` is the program Chrome starts. It only forwards messages.

The manifest allows one extension id. Replace `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` when the extension is published.

## Windows

1. Install `quietkeys-native-host.exe` next to the app.
2. Write `com.quietkeys.native_host.json` somewhere permanent. `path` is the full path of the exe. `allowed_origins` is `chrome-extension://<id>/` and nothing else. `type` is `stdio`.
3. Set the default value of `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.quietkeys.native_host` to the full path of that json file.

## macOS

Copy the same json file to:

`~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.quietkeys.native_host.json`

`path` must be the absolute path of the host binary.

## Linux

Copy it to:

`~/.config/google-chrome/NativeMessagingHosts/com.quietkeys.native_host.json`
