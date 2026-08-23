---
type: internal
area: deps
---

Coordinated security dependency sweep closing all open Dependabot alerts: the
two runtime-scope advisories (js-yaml YAML-parsing DoS reached through
electron-updater, fast-uri host confusion reached through electron-conf) plus
the dev-only clusters — Astro 5→7 for the website, hono, undici, postcss and
a dozen other transitive bumps via pnpm overrides.
