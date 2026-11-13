# Security Policy

Memoria is **local-first by design**: the engine binds to `127.0.0.1` only,
validates `Host`/`Origin` headers, CORS echoes local origins only, secrets
(API keys, webhook URLs, Telegram tokens) are encrypted via the OS keychain
(Electron `safeStorage`), and sync bundles are AES-256-GCM end-to-end with
per-file HKDF keys. Nothing is sent to any server by default.

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.9.x   | ✅        |
| < 0.9   | ❌ — please upgrade |

## Reporting a vulnerability

Please use **GitHub's private vulnerability reporting**:

https://github.com/xinzzu/Memoria/security/advisories/new

Include the affected version, reproduction steps, and impact assessment. We
aim to respond within **7 days**. Please do **not** open public issues for
security reports.

## Scope notes

- The HTTP API is localhost-only by default; the optional `apiToken` setting
  adds a shared-secret layer (`x-memoria-token` header) for power users.
- Sync bundles protect content end-to-end, but a compromised device keychain
  compromises that device's key — device security is out of scope for the
  protocol.
- Never post your `apiToken`, Discord/generic webhook URLs, or Telegram bot
  token in issues, PRs, or screenshots — all three are secrets.
- The dashboard enforces `connect-src 'self'` CSP; report any bypass.
