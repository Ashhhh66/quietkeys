# quietkeys browser extension

Chrome extension that fills a login when you click it. It talks to the quietkeys app on this computer through native messaging. It makes no network requests.

The pairing token is stored in the browser's local storage. Passwords, the vault file, and the master password are not.

## Build

From the repository root:

```bash
npm run build:extension
```

In Chrome, open `chrome://extensions`, turn on Developer mode, and load `extension/dist`. Reload a login page so the field icon appears.

Pairing and the native host install are in [docs/NATIVE_HOST.md](../docs/NATIVE_HOST.md).

## Privacy

The extension collects nothing. The notice is in [docs/PRIVACY.md](../docs/PRIVACY.md).

Publishing to the Chrome Web Store is a separate step. The store assigns its own extension id, and the native host's allowed origin has to be updated to that id. Firefox is not built in this version.
