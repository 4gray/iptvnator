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
                "value": 2739510,
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
  measurement cannot disable the ratchet; a counter is read only from
  `journeys.<journey>.counters` and a wall-clock entry (one with
  `toleranceRatio`) only from `journeys.<journey>.wallClock`, so a value in
  the wrong section also counts as missing;
- a measurement below its baseline passes and prints a "tighten" hint;
- a measured counter without a baseline is noted, not failed;
- checking nothing fails: an empty baselines file, or `--only` naming an
  entry that does not exist, cannot exit 0.

`--only <journey>/<counter>` (repeatable) restricts the check to the named
baselines. A script that measures one counter writes its own summary file
and checks only its counter, so it neither overwrites another measurement's
summary nor fails the other baselines as unmeasured.

```bash
pnpm run perf:initial-bytes:check   # measure dist/apps/web into dist/performance/initial-bytes.summary.json, check only that counter
pnpm run perf:ratchet:check         # check every baseline against dist/performance/journey-summary.json
```

CI runs `perf:initial-bytes:check` in the `Initial bytes ratchet` job of
`.github/workflows/ci.yml` after a production build of `apps/web`, and uploads
`dist/performance/` as the `performance-journey-summary` artifact. Like the
rest of that workflow it runs for pull requests that target `master` and for
pushes to `master`; a stacked PR that targets another branch gets no run until
it is retargeted, so dispatch one with `gh workflow run ci.yml --ref <branch>`
when you need the number. A PR that grows the counter fails that job.

That runner is the canonical measurer: take baseline values from its output,
not from a local build, even though local macOS builds have so far matched it
byte for byte. (An apparent 556-byte platform difference during the first
measurements was `package.json` text embedded in `main.js`, which moved with
every script edit; #1692 fixed that by importing only the version.)

The job also refuses a weakened baselines file: on a pull request,
`tools/performance/check-baseline-direction.mjs` compares
`journey-baselines.json` with the target branch's copy and fails when any
entry's enforced limit (`value × toleranceRatio`) went up, a tolerance widened
or an entry disappeared, so a PR cannot grow the payload and raise the
baseline to match. Lowered limits and new entries pass.

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
