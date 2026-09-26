# Attributions

quietkeys bundles these fonts. Both are licensed under the SIL Open Font License, Version 1.1. The licence text ships next to the font files.

| Font            | Files                                   | Licence                            |
| --------------- | --------------------------------------- | ---------------------------------- |
| Instrument Sans | `src/fonts/InstrumentSans-Variable.ttf` | `src/fonts/InstrumentSans-OFL.txt` |
| JetBrains Mono  | `src/fonts/JetBrainsMono-Variable.ttf`  | `src/fonts/JetBrainsMono-OFL.txt`  |

Instrument Sans is used for the interface. JetBrains Mono is used for passwords. Neither font is loaded from the network.

The passphrase generator bundles the [EFF Large Wordlist](https://www.eff.org/deeplinks/2016/07/new-wordlists-random-passphrases) (7,776 words) in the Rust binary, as `src-tauri/assets/eff_large_wordlist.txt`. It is licensed under [CC BY 3.0 US](https://creativecommons.org/licenses/by/3.0/us/). The file's SHA-256 is recorded in `src-tauri/assets/eff_large_wordlist.sha256`.
