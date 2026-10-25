# TV visual refinement validation

Date: 2026-10-25. Package: 0.1.5.

Section headings, counts and source selection now share a compact top row.
Filters sit immediately below; the repeated source name, top slogan and
prototype footer/divider are removed. Details uses the same header for Back.
Continue watching combines a 2:3 cover, saved progress and the existing resume
action. Historical Stalker records recover their missing mapped poster from
saved provider fields without changing identity, commands or positions.

Favorites separates Movies, Series (including saved episodes) and TV within the
active source. Movie/series cards keep poster proportions; TV uses compact
horizontal cards. A local SVG television replaces missing or failed logos in
live lists and channel cards. Grid Left/Right prioritizes an adjacent card in
the same row, preventing nearby header controls from stealing horizontal focus.

## Local checks

Node 22.23.2 and pnpm 10.33.0; installed lockfile matches and Nx discovery passed.

- TV unit tests: 33 passed.
- Full TV browser suite: 43 passed against the actual backend and existing
  Xtream/Stalker mocks, including M3U fixtures. Five visual regression scenarios
  passed again after the final singular/plural count adjustment.
- New scenarios cover compact geometry at 1920/1280/960 widths, 2:3 posters,
  typed favorites and detail Back focus, saved data after reload, real native
  video resume/progress with artwork, missing/broken channel logos, horizontal
  remote navigation and historical Stalker artwork recovery.
- TV, TV tests and TV E2E typing passed; TV, feature, UI, data-access and E2E
  lint passed. Release notes, guidance, skills, font weights, stylesheet inputs,
  focus rings and whitespace checks passed.
- Production build, classic-script ES2018/unsupported-builtins verification and
  IPK packaging passed. Dependencies and module boundaries are unchanged.

The tested commit and IPK checksum are recorded in the local ignored
`dist/tv-verification/visual-validation.json`. Full browser results are retained
in `visual-full-e2e.json` in that directory. No push, PR, CI or release publication
was performed. Angular/Electron E2E were not rerun because this change affects
only the independent TV client. Backend and phone behavior are covered by the
full TV suite; their implementation is unchanged.

## Actual LG checks

Installed and launched on the paired OLED55BX9LB, firmware 04.64.00,
SDK 5.6.2 / Chromium 68.0.3440.106, at its actual 1920×1080 viewport.

- Movies heading begins at y=32 and posters at y=219; the poster ratio is 2:3.
  The count sits beside the heading and the source appears only in its selector.
- Home's existing saved movie now loads its cover. Its progress remains
  1978.65 seconds out of 5280.32 seconds across package installation.
- Two existing movie favorites and one channel remain present in their
  respective tabs. The channel has no logo and shows the local SVG fallback
  inside a 116-pixel-high card. Series is empty in this user's favorites;
  populated series navigation is verified by the mock/browser suite.
- Details has neither the slogan nor footer. Back restores the focused catalog
  card. Captured Home, Movies, details and favorites screenshots were inspected.
- No runtime exceptions or visible alerts were observed. Credentials and TMDB
  keys were not inspected or logged. No real playback or user-data edits were
  required for this visual validation.

Device evidence: `dist/tv-verification/lg-visual.json` and `lg-visual-*.png`.
Interaction used CDP on the real TV. Physical remote operation, real codec
coverage and cold-launch persistence remain separate hardware checks; these
results do not certify the complete MVP as hardware-ready.
