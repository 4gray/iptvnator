# Dependency Security Overrides

How transitive CVEs are patched in this repo, and the constraint that makes
"just bump to latest" the wrong move.

## Why overrides exist

Dependabot can only bump packages we declare ourselves. When the vulnerable
package is transitive — pulled in by `video.js`, `electron-updater`,
`electron-conf`, `axios` — the bot has no lever: it would have to wait for the
parent to publish a release that widens its own pin. Until then the alert stays
open regardless of how many bot PRs land.

`pnpm.overrides` in the root `package.json` is that lever. Every entry uses the
pinned-source form so an override only rewrites the exact resolution it was
written for, and goes stale visibly instead of silently re-targeting a future
version:

```json
"@xmldom/xmldom@0.8.11": "0.8.13"
```

## The semver ceiling

**An override must stay inside the range its parent declares.** pnpm applies
overrides without re-checking the parent's range, so an out-of-range target
installs cleanly and then fails at runtime or under load, not at install time.

For three of the five current security overrides, the newest published version
is _outside_ the parent's range. Taking "latest" would break them:

| Override         | Pinned to | Parent range                            | Latest on npm |
| ---------------- | --------- | --------------------------------------- | ------------- |
| `@xmldom/xmldom` | 0.8.13    | `mpd-parser` `^0.8.3`, `plist` `^0.8.8` | 0.9.x ❌      |
| `fast-uri`       | 3.1.4     | `ajv` `^3.0.1`                          | 4.x ❌        |
| `js-yaml`        | 4.3.0     | `electron-updater` `^4.1.0`             | 5.x ❌        |
| `form-data`      | 4.0.6     | `axios` `^4.0.5`                        | 4.0.6 ✅      |
| `ajv`            | 8.18.0    | `electron-conf` `^8.13.0`               | 8.20.0 ✅     |

Before changing any of these, check the parent's declared range first:

```bash
npm view <parent>@<version> dependencies --json
```

## Verifying an override actually applied

Grepping `pnpm-lock.yaml` for the old version still finds it, but that hit is
not a leftover package block — pnpm removes those once nothing resolves to them.
It is the override's own selector key, echoed in the `overrides:` block at the
top of the lockfile:

```yaml
overrides:
    '@xmldom/xmldom@0.8.11': 0.8.13
```

So a bare grep proves only that the override is declared, never that it took
effect. Resolve the real path on disk instead:

```bash
node -e "console.log(require('./node_modules/.pnpm/mpd-parser@1.3.1/node_modules/@xmldom/xmldom/package.json').version)"
```

## What is deliberately not overridden

`undici` carries open alerts flagged `runtime` scope, but every path to it is
build tooling — `electron` → `@electron/get`, `@angular/build`, and
`@module-federation/dts-plugin`. It is not in the packaged app. The `runtime`
label is a Dependabot classification artifact, not a shipped-code claim. Bumping
it inside the Angular/Nx toolchain risks the build for no runtime benefit.

When triaging, confirm scope from the dependency graph rather than trusting the
alert's `scope` field.
