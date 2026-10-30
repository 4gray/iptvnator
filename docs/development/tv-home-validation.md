# TV Home feature validation

Date: 2026-10-25. Package: 0.1.7.

Home now features up to three recently watched unfinished titles from the
active source. Previous/Next controls switch manually; Continue watching and
Details have separate actions. The selected title survives Back from details
and playback. The lower resume row remains, with covers and saved progress.
The latest episode represents each series; completed latest episodes do not
revive older ones. Empty history keeps the catalog feature. No data migration
or provider playback-command rewrite is involved.

The TV sidebar, errors and playing-channel state no longer use decorative
vertical border strips. Playing channels retain their background highlight.

## Local checks

Node 22.23.2 and pnpm 10.33.0; installed lockfile matches and Nx discovery passes.

- 39 TV unit tests pass, including source scoping, ordering, limits, immutable
  history selection, unknown-duration progress and episode grouping/completion.
- All 48 TV browser E2E scenarios pass across the existing provider mocks.
  New scenarios create four real mock-media progress entries and verify a
  three-title wrap, retained four-card rail, focus, detail/player Back, movie
  and episode resume, reload and source isolation. Geometry checks cover
  1920, 1280 and 960 widths. Existing TMDB cancellation/error scenarios pass.
- TV/UI/feature/util/E2E lint and TV/test/E2E type checks pass. Release notes,
  guidance, skills, font weights, stylesheet inputs and focus-ring checks pass.
- Production build, classic-script ES2018/unsupported-builtin verification
  and IPK packaging pass. Dependencies and Nx boundaries are unchanged.
  Angular/Electron checks are not repeated: their runtime and UI are unchanged.

Screenshots were visually inspected in the mock browser and on the real LG.
Ignored evidence lives in `dist/tv-verification/hero-*.log`, `lg-hero*.json`,
`lg-hero-*.png` and `hero-validation.json` (tested revision and IPK checksum).
No push, PR, paid CI or publication was performed.

## Real LG

Package 0.1.7 installs and launches on the paired OLED55BX9LB, firmware 04.64.00,
webOS SDK 5.6.2 / Chromium 68. The previous temporary Mac backend was no longer
running; it was restarted on the same port 3335 before playback verification.
The unrelated port 3333 service was untouched.

The existing two unfinished titles survive the package update and debugger
reload. Their artwork loads, switching changes title/backdrop/progress, and the
resume rail remains visible. CDP arrow/Enter events exercise the actual TV
browser; Details/Back returns to the selected title and Details control.
Hero episode resume reaches its saved 1200.22-second position; movie resume
reaches 1983.946 seconds against a saved 1983.95 seconds. Both have seeking
complete; leaving playback restores the Continue watching button and selection.
No application alert or runtime exception occurs in the completed check.

The three-title cap is covered by browser fixtures; no artificial third title
was inserted into the TV's history. CDP input is not a physical remote test.
Native video picture/audio, cold OS launch and all provider/codec combinations
remain separate hardware checks. Screenshots do not capture the native video
plane and are used here to assess the Home UI only.
