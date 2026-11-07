# Security

ShiftRhythm has no server, no accounts and no analytics. Everything is planned on your own device. The only network traffic is optional, end-to-end encrypted sync with a private GitHub repository you own.

## Threat model

| Who or what | What they could try | Protection |
|---|---|---|
| GitHub, or someone who gets into the `shiftrhythm-data` repository | Read your plan; change it; put an older copy back | Data is encrypted on the device (AES-GCM-256 with additional authenticated data). Any change breaks the authentication tag and is rejected. Each device remembers the newest copy it has seen and ignores older ones (rollback protection). |
| Someone with a stolen sync token | Read or overwrite the synced file | Only fine-grained tokens are accepted; they reach one repository with *Contents* permission only. The file is still encrypted, so they can't read it or forge changes, only delete it, and each device keeps its own copy. Revoke the token on GitHub. |
| A malicious backup file or synced file | Inject code, crash the app, or pollute JavaScript objects (`__proto__`) | Every field is type-checked, length-limited and whitelisted; reserved keys are dropped; 5 MB size limit; all text is rendered with `textContent`. |
| A malicious website | Load ShiftRhythm in a frame and trick you into clicking (clickjacking); read its storage | The app refuses to run framed; `frame-ancestors 'none'` and `X-Frame-Options: DENY` when served locally. Browser storage is isolated per site. |
| Injected scripts (XSS) | Run code inside the app | Strict Content Security Policy: scripts only from the app's own origin, no inline scripts, no `eval`, network only to `api.github.com`. No third-party code, fonts or CDNs. |
| Calendar file (.ics) | Inject extra calendar fields through a task title | Line breaks and control characters are escaped or removed. |
| Other devices on your Wi-Fi | Reach the local server | `serve.py` binds to `127.0.0.1` only and serves only the app's files (not `.git`, tests or scripts), with security headers. |
| Someone guessing your passphrase offline | Brute-force the encrypted file | PBKDF2-SHA-256 with 600,000 iterations and a random salt (the OWASP 2023 recommendation). Weak passphrases are refused: at least 12 characters, not just digits, not a common pattern. |
| Someone with your unlocked device | Read your plan | Out of scope for a web app: use your device's screen lock. The sync token is stored encrypted under the device's non-extractable key, not in plain text. |

## Security review, November 2026

| # | Finding | Severity | Fix |
|---|---|---|---|
| 1 | Prototype pollution: ids and log keys such as `__proto__` from an imported or synced file could alter JavaScript objects | High | Reserved names rejected; ids and keys restricted to a safe character set; merge skips reserved keys |
| 2 | GitHub token stored in plain text in browser storage | Medium | Token encrypted with AES-GCM under the device's non-extractable key; old plain-text tokens migrated automatically |
| 3 | An older synced copy could be put back on GitHub and accepted (rollback) | Medium | Each device records the newest timestamp it has seen and refuses older copies, then re-uploads its own |
| 4 | Synced data was merged before being validated | Medium | Remote data passes the same validator as imported backups before merging |
| 5 | Key derivation used 310,000 PBKDF2 rounds | Low | 600,000 for new sync spaces and backups; older files still open |
| 6 | Clickjacking: the app could be framed by another site | Low | Refuses to run framed; anti-framing headers on the local server |
| 7 | Line-break injection in `.ics` export | Low | All line breaks, Unicode separators and control characters escaped or removed |
| 8 | Local start scripts served every file in the folder (including `.git`) without security headers | Low | New `serve.py`: localhost only, whitelist of app files, CSP and other headers |
| 9 | Weak sync passphrases accepted | Low | Passphrase policy for new sync spaces; classic all-repository tokens refused |

All fixes have automated tests (`npm test`), and sync was tested end to end, including a rollback attack.

## Remaining risks

- **Your GitHub account hosts the app.** Whoever controls it could change the code your devices download. Turn on two-factor authentication. For the strongest setup, run the app locally from a copy you've checked (`start.sh` / `start.bat`).
- **Unlocked devices.** Anyone using your unlocked phone or laptop can open the app. Use a screen lock.
- **Voice typing** in Chrome and Edge sends audio to Google or Microsoft. It's off unless you turn it on.
- **Forgotten passphrase.** Nobody can recover it. Each device keeps its own copy, and encrypted backups protect against loss.

## Reporting a vulnerability

Please open a private security advisory on the GitHub repository (Security → Report a vulnerability) rather than a public issue. Include the steps to reproduce and the browser you used.
