# Theme design tokens: `--app-*` is canonical, `--mat-sys-*` is a no-op

## TL;DR

- The only CSS design tokens that exist at runtime are the `--app-*` custom
  properties defined (for light and dark) in `apps/web/src/m3-theme.scss`.
- `var(--mat-sys-*)` references **do not work anywhere in this app**. The
  theme uses Angular Material's older M3 API (`mat.define-theme` +
  `mat.all-component-themes` / `mat.all-component-colors`), which emits
  _component_ tokens with literal values but never emits the `--mat-sys-*`
  _system_ tokens. Verified empirically via CDP on 2026-07-12: no stylesheet
  rule defines any `--mat-sys-*` variable.
- CI fails when new `var(--mat-sys-*)` references are added
  (`tools/styles/check-mat-sys-usage.mjs`); legacy usages are grandfathered
  in `tools/styles/mat-sys-baseline.mjs`, which must only shrink.

## What a `--mat-sys-*` reference actually does today

Because the token is never defined, any declaration containing
`var(--mat-sys-x)` without a fallback becomes _invalid at computed-value
time_, which behaves like `unset`:

| Declaration shape                                                  | Actual rendering                                               |
| ------------------------------------------------------------------ | -------------------------------------------------------------- |
| `color: var(--mat-sys-on-surface-variant)`                         | inherited text color                                           |
| `background: var(--mat-sys-surface-container)`                     | transparent                                                    |
| `background: color-mix(..., var(--mat-sys-x) 12%, ...)`            | transparent                                                    |
| `border: 1px solid var(--mat-sys-outline-variant)`                 | **no border at all**                                           |
| `border-color: var(--mat-sys-primary)` (width/style set elsewhere) | `currentColor` border                                          |
| `--local-var: ... var(--mat-sys-x) ...`                            | `--local-var` becomes invalid too, cascading to every consumer |
| `var(--app-x, var(--mat-sys-y))`                                   | `--app-x` (fallback is dead but harmless)                      |

This means the app's accepted visual design was produced _with_ these
no-ops. Making the tokens suddenly resolve (e.g. by migrating the theme to
`mat.theme()`, available since Material v19) would flip hundreds of sites at
once: surfaces, borders, and dividers that are currently invisible would
appear app-wide with M3 azure-palette values that were never part of the
hand-tuned design. That is why the fix strategy is **(b) replace usages
incrementally with `--app-*` tokens**, not (a) emit the system tokens.

Every migration step must be screenshot-verified in both themes (see
"Migration protocol" below) because replacing a no-op is a deliberate visual
change: the borders/backgrounds the original author intended will start
rendering.

## Token mapping for migration

When migrating a file, map by _role in context_, not mechanically:

| `--mat-sys-*` token                        | Replacement                                                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `on-surface` (text)                        | `--app-heading-color` (emphasis/hover text), `--app-body-color` (regular copy)                                            |
| `on-surface` (inside `color-mix` overlays) | `--app-on-surface`                                                                                                        |
| `on-surface-variant`                       | `--app-muted-color` (icons, captions, placeholders, meta), `--app-body-color` (secondary copy)                            |
| `outline-variant`, `outline`               | `--app-separator` (hairlines/dividers), `--app-widget-header-border` (faintest)                                           |
| `surface`                                  | `--app-content-bg` (page-level), `--app-widget-bg` (component surface)                                                    |
| `surface-container`, `-low`                | `--app-widget-bg`; for chips/pills on a widget surface prefer `color-mix(in srgb, var(--app-on-surface) 6%, transparent)` |
| `surface-container-high`, `-highest`       | `--app-widget-header-bg` (raised surface), `--app-card-hover-bg` (hover state)                                            |
| `primary`                                  | `--app-selection-color`                                                                                                   |
| `on-primary`                               | `--app-selection-on-color`                                                                                                |
| `primary-container`                        | `--app-selection-surface` (`-strong` for emphasis)                                                                        |
| `error`, `error-container`                 | `--app-error-color`; surfaces via `color-mix(in srgb, var(--app-error-color) N%, transparent)`                            |
| `tertiary`, `tertiary-container`           | `--app-accent-color` (cyan accent: radio badge, external-playback and success states); surfaces via `color-mix`           |

Dead-fallback usages `var(--app-x, var(--mat-sys-y))` are always safe to
simplify to `var(--app-x)` — the fallback can never be taken (and if
`--app-x` were undefined, the fallback would be invalid anyway, so behavior
is identical in every case).

## Migration protocol

1. Replace the file's `var(--mat-sys-*)` references using the table above.
2. Run the app (`pnpm nx serve electron-backend`, CDP on 9222) and
   screenshot the affected views in **both** light and dark themes; compare
   against pre-change screenshots. Newly appearing borders/backgrounds must
   look intentional and consistent with the `--app-*` design language.
3. Regenerate the baseline: `node tools/styles/generate-mat-sys-baseline.mjs`
   and commit the shrunken `tools/styles/mat-sys-baseline.mjs`.
4. `pnpm run lint:styles` must pass.

## Guard

- `pnpm run lint:styles` → `tools/styles/check-mat-sys-usage.mjs` scans
  `apps/` and `libs/` (`.scss`, `.css`, `.ts`, `.html`, `.js`) and fails if
  any file has more `var(--mat-sys-` references than its baseline entry.
- CI runs it in the Lint job (`.github/workflows/ci.yml`).
- Never add new entries or raise counts in the baseline.
