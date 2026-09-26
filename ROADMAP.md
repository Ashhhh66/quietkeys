# Roadmap

Phases 0–4 are done. Phase 5 ends with the v1 release. Later phases are after that.

- [x] Phase 0: project setup
- [x] Phase 1: crypto and vault engine
- [x] Phase 2: app state and commands
- [x] Phase 3: core interface
- [x] Phase 4: generator, clipboard, auto-lock, change master password, backups
- [ ] Phase 5: polish, installers and CI, ending with the v1 release
- [ ] Phase 6: onboarding and Emergency Kit, vault health, import
- [ ] Phase 7: recovery code with vault format v2, choosing the vault location with conflict detection, TOTP
- [ ] Phase 8: native host and pairing
- [ ] Phase 9: browser extension

## Optional (P3)

Not scheduled. These are not part of the phases above.

- Biometric unlock
- Travel Mode
- SSH key storage

## Out of scope

- **Cloud sync and accounts.** The vault never leaves the machine.
- **Family sharing.** That needs accounts and a way to share secrets.
- **Mobile apps.** v1 is the Windows and macOS desktop app.
- **Passkey provider.** That is a different product.
- **Share links.** A link is either a server or a secret in a URL.
- **Email aliases.** That needs an email service.
- **Bundled VPN.** Unrelated, and it phones home.
- **Dark-web monitoring.** That needs a breach-data service.
- **AI features.** That would send vault contents off the machine.
- **Auto-submit.** Filling stays a deliberate user action.
