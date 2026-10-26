# TV multi-channel guide validation

Date: 2026-10-25. TV package: 0.1.11.

This package adds a multi-channel programme grid alongside the existing channel
drawer and single-channel guide. Live preview, fullscreen controls and the drawer
open TV Guide. Arrow keys browse programmes/channels without switching playback;
OK focuses Watch live, which performs the explicit switch. Programme coverage
remains provider supplied: Xtream short EPG, Stalker bulk/short fallback, no M3U
XMLTV or archive playback.

## Local checks

Node 22.23.2 / pnpm 10.33.0; installed lockfile matches. The new pure `shared-epg`
project is discovered by Nx without weakening module boundaries. No dependencies
or lockfile changed. TV unit tests: 61 passed, including four grid geometry/
selection cases and seven Stalker bulk-cache lifecycle regressions. The extracted
shared geometry passes five tests; all 338 existing Angular `ui-epg` tests pass.

Affected TV/shared EPG lint and TV/test/E2E typing pass. Release notes (144), agent
guidance, stylesheet input closure, font weights, focus rings, Nx dependency policy
and whitespace checks pass. Production build, classic IIFE/ES2018 runtime verification
and IPK packaging pass. Electron E2E was not run: the only Electron-consumed change
is the behavior-preserving pure geometry extraction, covered by existing EPG tests.

Browser fixtures use native WebM decoding while substituting mock provider media
URLs; they cannot certify LG codecs, the remote control's physical behavior or
actual portal/network reliability. Screenshots at 1920×1080 and 1280×720 were
inspected. Both retain readable channel/programme rows and visible toolbar/actions.

The final complete browser suite passes all 71 scenarios, including eight new grid
scenarios and all existing provider, persistence, source/library, phone-setup, resume
and overlay flows. Earlier setup races were fixed by waiting for actual restored
focus; identity, focus, DOM and media assertions remain intact. An added regression
assertion failed before the fullscreen return-focus fix and passes afterwards for
all three providers. Watch live records a surviving Live control as its Back target.

## Real LG

Installed on the paired OLED55BX9LB (firmware 04.64.00 / webOS 5.x / Chromium 68)
using the existing NAS backend. The pre-update and post-install source/viewing
checksums match: three sources, two linked library sources, six favorites and
six history/position records. Later live tests can make normal history writes.
No fabricated user data or credentials were installed.

Real Stalker EPG renders 12 channel rows and 25 programme cells in the inspected
window; the later window contains 19 cells. Arrow navigation reaches the adjacent
channel's programme, category Back returns to the grid, and closing restores the
TV Guide button. The grid has no outer overflow. Native video identity and its
load-event count stay unchanged during those browsing operations. Device screenshots
were inspected; the final labels avoid a glyph rendered as a square by LG's font.
No JavaScript runtime exceptions occurred in the recorded checks.

An initial HD-channel run played with the grid open (readyState 4, currentTime
91.902). Subsequent opens, including several other channels, returned native
error 4 / NotSupportedError before grid entry. The later full navigation capture
therefore validates guide behavior with failed media, not uninterrupted playback.
The same failure class was recorded before this change in the 0.1.10 validation;
its cause is still unresolved. Successful real-LG switching between streams,
physical Magic Remote feel, audio/video quality and long playback remain open
hardware checks. Modern Chromium mock playback does not close those checks.
CDP screenshots omit the native video plane.

Remaining follow-up: diagnose provider/native stream error 4 independently, then
repeat the real-device playback/switching matrix. This package does not claim
universal stream or codec compatibility. The final installed bundle smoke test renders 12 rows and 30 cells, retains one
video, has no outer overflow, and passes programme-arrow, category-Back and origin-
focus checks without runtime exceptions. Sources, linked count, favorites and NAS
configuration remain unchanged after all device checks; the viewing checksum changes
through normal confirmed-playback history updates. The TV is left on Home.

## Evidence

Local, ignored evidence lives under `dist/tv-verification/`: `grid-*.log`,
`grid-guide-1920.png`, `grid-guide-1280.png`, and `lg-grid-*` device evidence.
The release note is `.changes/tv-multi-channel-guide.md`. This change does not
modify NAS services, backend endpoints, the persistence schema or shared sources.

Final IPK SHA-256: `c483f4b63a6a5540d05101037fa8b1a32a3c067973f4ea6c6c1ed7d25d73681a`.
Final bundle: `index-DFKCj2Qh.js`.
