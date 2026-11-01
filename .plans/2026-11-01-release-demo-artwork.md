# Release 0.25 cinematic demo

## Intended result

Capture the real Electron dashboard, a movie opened from that dashboard, and a
series with its episodes using only fictional metadata and committed local
artwork. Keep the normal application UI, TMDB opt-in and personal profiles intact.

## Work

1. Reuse the existing `marketing:marketing` Xtream catalog and original movie
   posters. Add cinematic landscape images for Black Harbor, The Paper
   Astronaut, Summer Static and House of Tides. Replace the SVG-only artwork
   for Skyline Sentinels and The Aegis Club with matched posters/backdrops.
2. Save every generation prompt and asset provenance alongside the fixture.
   Use built-in image generation, original fictional faces and compositions;
   use no real film, actor, studio, logo or TMDB artwork references.
3. Expand the selected movie/series synopsis and author named episode plots.
   Reuse local artwork for season covers and provide original episode stills.
4. Seed enough favorites and watch activity for populated rails. Pin the hero
   through the carousel's real controls, preload provider details, and capture
   the movie by following its dashboard favorites card.
5. Expose a local demo launcher that opens an isolated, disposable profile
   with the same seeded state and keeps it available for manual exploration.
6. Run focused fixture/tool checks and the Electron build and capture workflow.
   Review dark/light dashboard and detail screenshots, verify all artwork
   decodes, document launch/capture commands and commit the result locally.

## Review criteria

- A readable complete synopsis and cinematic landscape on the dashboard hero.
- At least one populated rail, with a second visible at a suitable desktop size.
- Matching identity between movie poster, backdrop and detail metadata.
- Series seasons have plausible individual episode names and descriptions.
- Captures pass isolation and local-network guards. Regular captures keep TMDB
  disabled; the explicit cinematic preset accepts only its invalid fixture key
  and locally seeded synthetic metadata, with external requests still rejected.
- No real media names or personal content in files or captured frames.
- Artwork is committed in the mock server; normal runs require no image API.

## Scope

This prepares release assets; it does not publish or tag a release, push a branch,
change normal UI behavior, or migrate personal data. Mock/tool-only work is
release-note exempt. Update the canonical mock and screenshot documentation.

## Completed validation

- Ten generated images are committed in the mock asset tree, with final prompts,
  reference continuity, dimensions and byte sizes in `cinematic-artwork.json`.
- Six 1600×1100 Electron captures were reviewed in dark and light themes. All
  178 distinct observed requests were local; personal database guards passed.
- A standard settings capture also passed (136 distinct local requests), proving
  that the default metadata-disabled capture mode still works.
- The interactive launcher was exercised through startup and Enter-to-close.
- `release-tools`: 230 existing tests plus four cinematic tests and typecheck.
- `xtream-mock-server`: 100 tests; `shared-marketing-fixtures`: seven tests.
- Focused lint and mock spec typecheck passed. The mock retains two pre-existing
  non-null-assertion warnings. Release-note and agent-guidance validation passed.
- The Electron E2E build passed. Embedded MPV was unavailable in this checkout;
  the screenshot scenario does not start playback. No CI was dispatched.

## Additional live dashboard variant

The follow-up adds `dashboard-live-channels-{dark,light}.png` alongside the
original images. Continue Watching remains first; eight synthetic live favorites
provide original local logos, current programme titles, time ranges and progress
in the second rail. The first cards span news, sports, family, documentary and
music. `pnpm demo:cinematic:live` opens this variant interactively.

The frame guard checks loaded EPG/icons, distinct channels and visibility below
the movie rail. Full sequential capture of all eight frames passes with 182
distinct local requests and the existing isolation guards. Release tooling has
230 existing tests plus seven cinematic tests, with typecheck and lint passing.
All six original committed screenshots remain byte-for-byte unchanged. This is
mock/capture tooling only and needs no user-facing release note.

## Additional theme preview

The follow-up adds an original-pixel composite of the two live dashboard
captures: light on the left, dark on the right, equal-area diagonal split.
The PNG and lossless WebP live in the release's separate `previews/` folder,
with source/output hashes and geometry in a JSON manifest. Original captures
and README are preserved.

`pnpm release:preview:themes` regenerates the default preview without starting
an app or calling an image API; `--split vertical` supports a straight 50/50
variant. Six composition/CLI tests cover source fidelity, equal area, dimensions
and invalid arguments. The result was inspected at its original 1600×1100 size.

## Pull request integration refresh

Rebased onto `origin/master` at `90c4938a1` and reinstalled with its required
Node 24.22.1. The capture driver now explicitly selects a category after import;
the offline fixture follows search-cache v5 and marks classification capability
as cached, so the new metadata reader never upgrades it over the network.
The complete eight-frame Electron capture passes on the new base with 209
distinct local requests and unchanged personal-data guards. Eight cinematic
fixture tests, the other 236 release-tool tests, 100 mock tests and seven shared
fixture tests pass. Existing committed screenshots and previews are preserved.

Local review found that closing the preview's last window on macOS did not
terminate Electron, leaving its wait promise and temporary resources alive.
The preview now observes both the main page and application close events.
Regression coverage reproduces the previous helper's failure and verifies
Enter cleanup as well; a real isolated macOS Electron window-close check passes.
The cinematic test target now has ten passing checks, with typecheck and lint.
