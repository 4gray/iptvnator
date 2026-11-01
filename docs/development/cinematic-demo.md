# Cinematic release demo

The release 0.25 preset shows the real Electron UI with original fictional
films, series, cast names and artwork. It captures the dashboard, a movie
opened from its favorites rail, and a series with its first season expanded,
in dark and light themes. The application UI and normal account data are not
modified by the preset.

## Run and explore

Use the repository Node and pnpm versions, then build the capture runtime:

```bash
pnpm install --frozen-lockfile
pnpm nx run electron-backend:build-e2e
pnpm demo:cinematic
```

The launcher starts or verifies the local Xtream mock on port 3211, creates
a disposable Electron profile, imports the `marketing:marketing` catalog,
seeds eight continue-watching items and twelve favorites, and opens the
dashboard with Black Harbor selected. Explore the other carousel slides,
favorites and series normally. Press Enter in the terminal, Ctrl+C, or close
the demo window to finish; the temporary profile is removed. Changes made
inside this preview do not persist between runs.

To use the catalog in an existing development app instead, run
`pnpm nx run xtream-mock-server:serve` and add an Xtream source with host
`http://localhost:3211` and username/password `marketing`. This supplies the
artwork, plots and episodes; the launcher additionally prepares dashboard
activity and its offline enrichment cache. No image-generation key or TMDB
account is needed to run either scenario.

## Capture

```bash
pnpm release:screenshots --cinematic --release v0-25
pnpm release:screenshots --cinematic --release v0-25 --only dashboard --theme dark
```

The preset reads `tools/release/screenshots.cinematic.manifest.json`, uses a
1600×1100 viewport, pauses the real hero carousel and selects its slide by
accessible name. It expands detail synopses through their normal More button
and waits for fonts, image decoding and transitions before saving PNGs.
Outputs are in `apps/website/public/blog/v0-25/screenshots/`:

- `dashboard-{dark,light}.png`
- `xtream-vod-details-{dark,light}.png`
- `xtream-series-season-open-{dark,light}.png`

Cinematic captures overlay those three pairs, preserving other release
screenshots. If producing the full release set, run the standard capture
first, then the cinematic preset. The standard manifest remains unchanged.

## Offline metadata and isolation

The hero displays synopsis, rating, genre and year through the application's
normal metadata-enrichment path. This preset fills the isolated SQLite cache
with synthetic movie, series, title-match and season records derived solely
from the verified local mock. Its image paths are null, so the provider's
committed local artwork supplies every image. Named episodes and plots for
all eighteen Skyline Sentinels episodes live in
`apps/xtream-mock-server/src/app/generators/marketing-stories.ts`.

Regular captures require enrichment disabled and an empty key. Only the
explicit `--cinematic` preset accepts the fixed invalid
`iptvnator-synthetic-offline-fixture` key. It disables recommendation/trending
rails, checks that exact setting before every frame, and keeps the existing
process and renderer network gates. An attempted external request still fails
the entire capture, even if it was blocked. There is no licensed-artwork
allowlist. Frames are published only after all isolation checks pass.
The interactive preview retains the network gates but publishes no frames;
closing its process can end its recorder before the final request audit.

## Artwork and prompts

`apps/xtream-mock-server/public/marketing/cinematic-artwork.json` records the
ten final prompts, reference paths, generation mode, dimensions and byte
sizes. This manifest is authoritative for the cinematic assets; the older
`manifest.json` and Image API generator describe the legacy artwork pack.
Avoid using that generator's `--force` to replace these manually curated
images with legacy prompts.

The new pack contains six landscape backdrops, two series posters and two
episode stills. Original movie posters are reused as continuity references.
All new images were generated with the built-in `image_gen` tool, reviewed
visually and stored as optimized palette PNGs (quality 95). No TMDB artwork,
real film titles, recognizable actors or studio marks were used as references.
Backdrops keep their visual subjects on the right so the actual UI scrim can
support readable copy on the left.

Validate the committed assets and capture fixtures without any image API:

```bash
pnpm nx run release-tools:test-cinematic
pnpm nx test xtream-mock-server
pnpm nx test shared-marketing-fixtures
```

Recreate an image by passing its saved prompt and optional committed reference
to the built-in image tool, reviewing the result, copying it into the manifest
path and refreshing dimensions/byte sizes. Generation is separate from normal
demo startup and screenshot capture.
