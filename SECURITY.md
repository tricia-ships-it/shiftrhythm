# Security

ShiftRhythm is designed so there is nothing to attack remotely: no server, no accounts, no network requests.

## Design

| Area | Measure |
|---|---|
| Network | CSP allows connections only to `api.github.com` (sync); scripts, styles and workers from the app's own origin only; no third-party code, fonts or CDNs. With sync off, no requests are made |
| Sync | Encrypted on device: AES-GCM-256 with additional authenticated data, key from PBKDF2-SHA-256 (310,000 iterations, random salt). Key kept as a non-extractable `CryptoKey` in IndexedDB; passphrase never stored. Fine-grained token limited to one private repository, Contents read/write only; stored in localStorage on that device and never included in backups or synced data |
| Code injection | All user text rendered via `textContent`; no `innerHTML`, `eval` or inline scripts |
| Imported files | Backups are parsed as JSON and every field is type-checked, length-limited and whitelisted before use; 5 MB size limit |
| Data at rest | Stored in the browser's `localStorage` on your device. Protect it with your device lock |
| Backups | Optional AES-GCM-256 encryption, key derived with PBKDF2-SHA-256 (310,000 iterations, random salt and IV) |
| Local server | `start.sh` / `start.bat` bind to `127.0.0.1` only |

## Reporting a vulnerability

Please open a private security advisory on the GitHub repository (Security → Report a vulnerability) rather than a public issue. Include the steps to reproduce and the browser you used.
