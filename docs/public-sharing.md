# Public Sharing Checklist

This repository should be safe to publish without local IPTV accounts, VPN state, logs, or machine-specific paths.

Before pushing changes, run:

```sh
pnpm run check:push-safe
git diff --check
```

Keep private source accounts outside the repository. Diagnostic tools that need a real IPTV account read from `.secrets/iptv.local.json`, which is intentionally ignored by git.

Example local-only file:

```json
{
  "xtream": {
    "serverUrl": "https://example.invalid",
    "username": "your-local-username",
    "password": "your-local-password"
  }
}
```

Never commit `.secrets/`, `.local/`, `.tmp/`, `.env*`, local database files, logs, VPN backups, or provider-specific credentials.
