# Dependency Security Overrides

Transitive security fixes belong in `pnpm.overrides` when a parent still resolves
an affected version. Prefer upgrading a direct parent when it already ships the
fix. An override uses a pinned-source selector so it stops applying visibly when
the parent moves to a different resolution:

```json
"fast-uri@3.1.0": "3.1.9"
```

## Compatibility contract

**New overrides must stay inside the range their parent declares.** pnpm does
not enforce that range after applying an override. Inspect the published parent
manifest before changing a target:

```bash
npm view <parent>@<version> dependencies optionalDependencies --json
```

Keep the existing major-version exceptions visible: `serialize-javascript`
6.0.2 is already overridden to 7.x, and `uuid` 8.3.2 to 11.1.1. Security
maintenance raises the former from the previously installed 7.1.0 to 7.1.3;
it does not introduce another major transition. Preserve webpack/package
validation when changing these exceptions.

Do not move `@xmldom/xmldom` to 0.9.x, `fast-uri` to 4.x, or `js-yaml` to
5.x while their parents require 0.8.x, 3.x and 4.x respectively.
The previous `smol-toml` exception for Nx's exact 1.6.1 pin is retired: Nx
23.3.1 itself pins 1.9.0, and the remaining Astro helpers accept `^1.6.0`.

## November 2026 maintenance

- Angular CLI/devkit/schematics 22.2.5 supply fixed Zod 4.6.6 without overriding
  the CLI's exact pin. `@angular/build` 22.2.5 supplies Piscina 5.3.2 and Vite
  8.3.5. The root Vite uses the same version. The bounded asset/worker URL prefilter patch is
  rebased onto 8.3.5; its regression checks remain required. See
  [the Vite contract](nx-workspace-boundaries.md#vite-dev-server-patch).
- Astro 7.3.3 fixes its JSX/MDX and View Transition advisories. Its compatible
  devalue and smol-toml resolutions are raised to 5.9.3 and 1.9.0.
- `express-rate-limit` 8.7.3 accepts `ip-address ^10.2.0`, allowing 10.7.6
  without the old override of the parent's exact 10.1.0 pin. The backend's
  pairing/setup limiter tests exercise the actual API.
- Other compatible fixes cover fast-uri 3.1.9, follow-redirects 1.16.2,
  qs 6.17.1, brace-expansion 1.1.21, source-map-js 1.2.2,
  postcss-selector-parser 6.1.5, diff 4.0.4 and Zod 4.6.6.
- Node-gyp's undici 6.x moves to 6.29.1. A parent-scoped override updates
  `@electron/get` to undici 7.30.1 inside its `^7.24.4` range.
- Nx and every official plugin move together to 24.0.4. Nx itself supplies
  undici 7.30.1, retiring the vulnerable exact 7.29.0 pin without a global
  override. The migration converts removed Jest/ESLint executors to inferred
  tasks, preserves Angular ESM test commands and revalidates the existing
  nx-electron compatibility patch and scoped peer allowances.

## Remaining upstream constraints

Do not suppress these alerts or force a new major merely to clear the count:

| Package | Remaining resolution | Constraint |
| --- | --- | --- |
| minimatch | 9.x and 10.x | The advisory's fixed floor is 11.0.1, outside the affected parents' ranges (Nx also has an exact pin). |
| postcss-selector-parser | 6.0.10 through `@tailwindcss/typography` 0.5.20 | Typography pins it exactly; the other 6.x paths use fixed 6.1.5. |
| deepmerge | 4.3.1 through Jest and the webpack checker | No fixed release is published. |
| glob | 10.5.0 and 13.0.6 | The cancellation advisory's fixed floor is 14.0.2, outside the affected parent ranges. |

Undici's npm package here is build tooling, not the implementation of the
application's native `fetch`. The apparent runtime path comes from
`electron-conf`'s Electron peer, then `electron → @electron/get`; that package
installs the Electron binary. Other paths are Nx and Node-gyp. Updating the
npm package does not update Node/Electron's built-in HTTP client. Verify the
actual runtime versions separately with the packaging security suite.

## Verification

An old version in the lockfile's `overrides:` section is only a selector, not
proof that the package remains installed. Inspect `packages:` and `snapshots:`,
then resolve the package from its actual consumer. Multiple copies matter: a
fixed root Vite does not fix a different version used by Angular's builder.

```bash
pnpm install --frozen-lockfile
pnpm run deps:vite:test
pnpm run deps:nx:validate
pnpm nx test packaging
pnpm audit --json
```

The packaging security tests reproduce inherited Piscina worker options,
malformed URI hosts through electron-conf/Ajv, and cross-family subnet checks
through the rate limiter. Keep the compressed-request and actual Node/Electron
runtime checks too. Compare audits against the same advisory snapshot: npm and
GitHub may report different counts, and an upstream-pinned vulnerable copy
keeps an alert open even after another path is fixed.
