# Performance journeys and the CI ratchet

IPTVnator measures performance through a small set of everyday user journeys.
Each journey has deterministic counters that are asserted exactly, and
wall-clock timings that are recorded as evidence. Counters are meant to be
ratcheted in CI: a committed baseline that may only be lowered, and only with
the measured output as evidence. This document is the contract for that loop;
`tools/performance/` holds the scripts. The measurement script lands first;
the baseline file and the CI job follow in their own PRs (#1693, #1694), so
until they merge the reported number is informational, not enforced.

## Journeys

| Journey          | Start                                        | End                                                                           |
| ---------------- | -------------------------------------------- | ----------------------------------------------------------------------------- |
| J1 `launch`      | Electron process spawn                       | first playlist or portal card rendered on `/workspace`, inline splash removed |
| J2 `open-source` | click on a portal card                       | live category list and first channel page painted                             |
| J3 `playback`    | click on a channel                           | HTML5 `playing` event                                                         |
| J4 `search`      | six-character query typed into global search | results list settled                                                          |

Only the J1 counter `renderer.initialBytes` is instrumented today. The other
journeys and counters follow the plan in `.plans/` and are added one thread at
a time; each thread names its journey and counter in the PR description.

## `renderer.initialBytes`

The bytes a browser fetches before Angular can bootstrap, read from the built
`dist/apps/web/index.html`:

- `index.html` itself,
- every same-origin `<script src>`, including `assets/app-config.js`,
- every `<link rel="stylesheet">`,
- every `<link rel="modulepreload">` chunk.

Manifest, icons, external URLs, commented-out tags and lazy chunks are not
counted. A file that `index.html` references but the build did not emit is an
error, never zero bytes. The value is raw (uncompressed) size, which is what the
renderer parses. It is Angular's "Initial total" plus `index.html` and
`assets/app-config.js` (about 4 KB together), so it sits slightly above the
rounded figure the build prints; never copy that figure into a baseline, use
the script's output. The bundle embeds only the app version from
`package.json` (a named import, which esbuild tree-shakes), not the whole
file, so editing scripts or dependencies does not move the counter.

```bash
pnpm nx build web                                # production configuration
pnpm run perf:initial-bytes                      # human-readable breakdown
pnpm --silent run perf:initial-bytes -- --json   # machine-readable; --silent keeps pnpm's headers out of stdout
node tools/performance/measure-initial-bytes.mjs --summary dist/performance/journey-summary.json
```

`--summary` writes the journey summary shape (`journeys.<journey>.counters`)
that the ratchet checker consumes. `--dist <dir>` points the script at another
build output, for example the `electron-performance` configuration.

The measurement script is `tools/performance/measure-initial-bytes.mjs`; its
Node tests run with `pnpm nx test performance-tools` (Tier B in the coverage
policy) and lint with `pnpm nx lint performance-tools`.

## Ratchet

`tools/performance/journey-baselines.json` holds one entry per journey and
counter:

```json
{
    "journeys": {
        "launch": {
            "renderer.initialBytes": {
                "value": 2750491,
                "unit": "bytes",
                "updatedAt": "2026-09-26",
                "evidencePr": 1693,
                "measuredWith": "pnpm nx build web && pnpm run perf:initial-bytes"
            }
        }
    }
}
```

`tools/performance/check-journey-ratchet.mjs` compares a journey summary with
that file:

- a counter above its `value` fails; counters are exact, there is no slack;
- a wall-clock entry carries `toleranceRatio` and fails above
  `value × toleranceRatio`;
- a baseline with no measurement in the summary fails, so dropping a
  measurement cannot disable the ratchet;
- a measurement below its baseline passes and prints a "tighten" hint;
- a measured counter without a baseline is noted, not failed.

```bash
pnpm run perf:initial-bytes:check   # measure dist/apps/web, then check
pnpm run perf:ratchet:check         # check an existing dist/performance/journey-summary.json
```

Baselines only move down. Lower `value` in the same PR as the change that
earned it, set `updatedAt` and `evidencePr`, and paste the measurement output
into the PR. Never raise a value to make a PR pass: if growth is a deliberate
trade-off, say so in the PR and let the maintainer decide.

## Adding a counter

1. Produce the value from the built output or from a deterministic probe, not
   from source heuristics. Missing inputs must fail the measurement.
2. Emit it under `journeys.<journey>.counters.<name>` in the summary JSON.
3. Cover the extraction and the failure modes with `node --test` and register
   the test file in `tools/performance/project.json`.
4. Validate the counter before it becomes a guardrail: one PR must show that
   lowering it moved wall-clock in the same journey.
