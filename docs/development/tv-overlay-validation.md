# TV Live overlay validation

Date: 2026-10-25. TV package: 0.1.10.

The package adds a fullscreen channel/category drawer and an expanded guide for
one channel. It retains the native video element and separates browsing from OK
playback. The guide renders dates and descriptions supplied by existing provider
adapters; no XMLTV, catch-up playback or multi-channel grid is introduced.

## Local checks

Node 22.23.2 / pnpm 10.33.0; matching installed lockfile and successful Nx discovery.
All 50 TV unit tests pass, including four guide normalization/window tests.
Affected TV, feature, UI, util, tests and E2E lint/typecheck targets pass. Release
notes (143), guidance, stylesheet inputs, font weights, focus-ring checks and
whitespace checks pass. Classic IIFE/ES2018 verification, build and IPK packaging pass.
No Electron E2E was run because Electron runtime behavior did not change.

The initial targeted Live/browser run passed 11 scenarios. On the final UI build,
the full 63-scenario suite passed 62: the long-description fixture fit entirely
inside the enlarged guide, so its overflow assertion failed. After increasing
that fixture's description length, all seven overlay scenarios pass in a separate
rerun. This is not reported as a single clean 63-test run.

Coverage includes all three providers, native video load counts during browsing,
OK-only switching, category browsing, Back/focus, reopening a distant playing row,
provider-page append and bounded DOM, guide dates/Now/description scrolling,
missing EPG, a delayed B selection superseded by currently-playing A, and retrying
the failed target while the previous channel continues playing. Existing tests
cover source/library persistence, errors, resume, catalog navigation and phone setup.
Browser live fixtures substitute a local WebM URL at the native video src setter
because Chromium cannot decode the mock provider HLS URLs; native decoding and
media events remain active. These fixtures do not certify LG streams or codecs.

## Real LG

Installed 0.1.10 on the paired OLED55BX9LB (firmware 04.64.00 / Chromium 68), using
the existing NAS connection. Three sources, two server links and five favorites
remain; source/active-selection identity checksum and NAS connection flags match
before the update. Live verification creates normal viewing-history writes, so
no claim is made that the entire history/progress snapshot remained byte-identical.
No fabricated sources/history or credentials were installed for this test.

A real Stalker channel reached readyState 4 and advanced playback time. Opening
the drawer and browsing kept the same single video and its load-event count (2).
Explicit OK switched to the next channel (count 4); opening/closing the guide
kept count 4 and continued playback. The drawer mounted 14 channel rows and
11 category rows; the expanded guide showed eight rows over two supplied dates.
The tested provider did not supply descriptions for the inspected programmes.
Both overlays fit the screen without outer overflow; screenshots were inspected.

Debugger-dispatched arrow/OK/Back events and focused button activation verified
return to Channels, Programme and Expand guide, plus navigation into the description
pane. No runtime exceptions occurred. CDP Enter needs its carriage-return text
field on this engine; a dispatch without that field does not activate the button.
Physical Magic Remote use, perceived audio/video quality and long playback sessions
remain manual checks. CDP screenshots omit the TV's native video plane.

A later reopening of the SD stream returned native error 4 / NotSupportedError;
the HD channel then played normally and the focus checks passed. The cause of
that provider/native-media failure was not established. It is recorded separately
from successful overlay playback continuity, without claiming universal codec or
provider readiness. The TV was left on Home after verification.

Ignored evidence: `dist/tv-verification/live-overlay-*.log`, `overlay-*.png`,
`lg-overlay-results.json`, `lg-overlay-focus.json` and `lg-overlay-*.png`.
IPK SHA-256: `ac316fb5a452162b568540b5056162d977dc2389ad698a0502703284f3483276`.
Installed bundle: `index-Ae0AqIXV.js`.

The release note is `.changes/tv-live-overlays.md`. No dependencies, server API,
NAS containers, persisted-data schema or Electron behavior change.
