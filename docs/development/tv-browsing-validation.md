# TV browsing, artwork and phone settings

Date: 2026-10-25. Package: 0.1.3. See [TV development](tv-development.md) for
commands and the outstanding physical remote/media/cold-start checklist.

## Findings and changes

Actual LG debugging found no poster image elements: the provider returned
root-relative `screenshot_uri` values and the TV adapter discarded them. Existing
240×280 boxes also cropped posters to the wrong ratio. The extracted provider
artwork resolver preserves Angular compatibility and produces absolute image
URLs. Percentage-based poster boxes work in Chromium 68 at 2:3.

Catalog paging controls are replaced by append-on-scroll and a bounded DOM
window. Back restores the selected identity and scroll before pruning. A
regression caught the race between an append and ArrowDown; another caught
scroll restoration being measured too early. Both have targeted E2E coverage.

Settings QR sessions have a separate purpose. The phone never receives the
saved TMDB key; blank means keep it. TV confirmation and transaction completion
are required before the phone receives a saved receipt. Source setup retains its
existing capabilities and six-session/minute creation limit. The expanded E2E
suite waits for that production cooldown instead of disabling it.

## Verification

Validated with Node 22.23.2 and pnpm 10.33.0:

- TV unit tests: 27 passed; web backend: 234 passed; Stalker data access:
  592 passed, including the existing Angular mapper compatibility tests.
- TV browser E2E: 33 passed across all three mock providers, including append
  errors/retry, stale requests, remote focus, phone settings and relaunch.
- TV/phone/E2E/test TypeScript, Angular/Electron production TypeScript,
  web-backend TypeScript and affected spec programs pass.
- Ten affected project lint targets pass (two existing backend warnings remain). Release notes, agent guidance, skills,
  Nx dependency alignment, stylesheet inputs/font weights/focus rings, E2E task
  graphs and coverage policy checks pass. No coverage thresholds changed.
- TV, phone setup and web backend production builds pass. The TV classic bundle
  passes the ES2018/unsupported-builtins packaging check. IPK 0.1.3 was installed
  again after the final focus fix; loaded bundle is `index-BqNzPdHS.js`.

Package SHA-256:
`c118a0c685754dd4c18f61ac8376c8fb4aec6e048ad41cf9489b13d3715a92f6`.
The tested commit and local evidence are recorded in the ignored
`dist/tv-verification/browsing-validation.json` after the local commit.
No CI, push, PR or release publication was performed. Electron E2E was not run:
this change adds no Electron runtime/IPC/player behavior; the shared Stalker
mapper extraction is covered by its existing tests and production typing.

## Actual LG evidence

The existing paired OLED55BX9LB (webOS SDK 5.6.2, firmware 04.64.00,
Chrome 68.0.3440.106) installs and launches 0.1.3. On the user's existing source,
poster images load with 240×360 rendered dimensions. One sampled provider image
remained unavailable and kept its text fallback. Scrolling appended 28 to 42
items without page controls. A further seven scrolls reached 140 loaded titles
while retaining no more than 60 poster nodes. In the final installed bundle,
ArrowDown moved from index 133 to 139, opening details and Back restored the same
focused title, and no runtime exceptions were observed.

The actual TV's settings QR opened the mobile form with an empty key field.
Submitting safe unchanged defaults displayed Apply settings and moved focus to
confirmation. Declining propagated to the phone; user settings were not changed.
Interaction used the real TV debugger plus a mobile-sized browser, not physical
remote buttons or a phone camera. This is not fresh certification of codecs,
real-stream playback or cold-start user-data persistence.

Local screenshots: `dist/tv-verification/lg-artwork-before.png`,
`lg-artwork-after.png`, `phone-settings.png`. Machine-readable device evidence:
`lg-infinite-artwork.json`, `lg-final-navigation.json`, `lg-phone-settings.json` in the same directory.
No provider credentials or saved TMDB keys were copied into tests or logs.
