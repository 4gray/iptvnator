# Performance journeys and the CI ratchet

IPTVnator measures performance through a small set of everyday user journeys.
Each journey has deterministic counters that are asserted exactly, and
wall-clock timings that are recorded as evidence. Counters are ratcheted in CI:
a committed baseline may only be lowered, and only with the measured output as
evidence. This document is the contract for that loop; `tools/performance/`
holds the scripts.

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

Manifest, icons, external URLs and lazy chunks are not counted. A file that
`index.html` references but the build did not emit is an error, never zero
bytes. The value is raw (uncompressed) size, which is what the renderer parses;
it matches the "Initial total" line of the Angular build output.

```bash
pnpm nx build web                       # production configuration
pnpm run perf:initial-bytes             # human-readable breakdown
pnpm run perf:initial-bytes -- --json   # machine-readable breakdown
pnpm run perf:initial-bytes -- --summary dist/performance/journey-summary.json
```

`--summary` writes the journey summary shape (`journeys.<journey>.counters`)
that the ratchet checker consumes. `--dist <dir>` points the script at another
build output, for example the `electron-performance` configuration.

The measurement script is `tools/performance/measure-initial-bytes.mjs`; its
Node tests run with `pnpm nx test performance-tools` (Tier B in the coverage
policy) and lint with `pnpm nx lint performance-tools`.

## Adding a counter

1. Produce the value from the built output or from a deterministic probe, not
   from source heuristics. Missing inputs must fail the measurement.
2. Emit it under `journeys.<journey>.counters.<name>` in the summary JSON.
3. Cover the extraction and the failure modes with `node --test` and register
   the test file in `tools/performance/project.json`.
4. Validate the counter before it becomes a guardrail: one PR must show that
   lowering it moved wall-clock in the same journey.
