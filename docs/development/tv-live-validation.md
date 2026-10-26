# TV Live browsing validation

Date: 2026-10-25. Package: 0.1.8.

Live opens category rows instead of a native select. Choosing a category shows
channels in the same pane, with a large category header button and Back support.
The chosen category and channel focus/scroll survive the local round trip;
source changes reset the browser. Category focus and selection do not start a
stream. The existing preview continues while browsing. Its fullscreen action
now restores focus to its own button when returning.

The page uses the remaining viewport height. Category/channel and EPG lists
scroll independently; reserved scrollbar space keeps the columns and preview
fixed when the guide becomes empty or long. The EPG region accepts remote
Up/Down scrolling. Categories reuse the bounded channel window, capped at
20 rendered rows. No provider API, media identity or persistence schema changed.

## Local checks

Node 22.23.2, pnpm 10.33.0; matching installed lockfile and Nx discovery.
The 39 TV unit tests pass. Targeted browser scenarios cover category/channel
Back, preview continuity, fullscreen focus, distant categories, empty groups,
bounded lists and EPG geometry at 1920×1080, 1280×720 and 960×720.
The 960-wide screenshot was visually inspected.

The last full browser run passes 51 of 52 scenarios. The remaining new test
assumed that row 60 would always be in the rendered window after an append;
the window can legitimately contain rows 40–59. The test now captures a visible
card's stable identity before focusing it, then verifies the same identity and
scroll position after category Back/re-entry. That corrected scenario passes
in a separate targeted run. No application checks or thresholds were relaxed.
The Home test also waits for the scheduled navigation frame before starting
another keyboard gesture; it passes in the last full run.

TV/feature/UI/E2E lint, TV/test/E2E typing, release notes, guidance, skills,
font-weight, stylesheet-input, focus-ring, formatting and whitespace checks pass.
Production build, classic-script ES2018/unsupported-builtin verification and
IPK packaging pass. Angular/Electron checks are not repeated because their
runtime and UI are unchanged. No dependencies or Nx boundaries changed.

## Real LG

Installed and launched on the paired OLED55BX9LB, firmware 04.64.00, SDK 5.6.2 /
Chromium 68. Screenshots of categories, channels, preview and a populated guide
were visually inspected. CDP arrow/Enter/Back events verify category selection,
return to the selected category, channel focus restoration and fullscreen Back
to its opening button. The sampled native stream reports currentTime 0.2,
readyState 2, paused false and no native error; that is not an audio/picture
quality assessment.

The real source supplies 11 category rows (including the app's All channels).
The left scroller ends at y=1056 in the 1920×1080 viewport, leaving only the
24-pixel bottom inset. Both empty and 12-programme guides share the same preview
rectangle: x=927.625, y=113, width=936.375, bottom=641.703125. The guide ends at
y=1056; a remote Down scrolls it by 100 pixels without moving that rectangle.
The outer page has no vertical overflow. No app alerts or runtime exceptions
occurred in these completed checks.

Device evidence is under ignored `dist/tv-verification/lg-live*.json` and
`lg-live-*.png`. Local checks use `live-*.log`; `live-validation.json` records
the tested revision and IPK checksum. Navigation was through the actual TV
debugger, not a physical remote; native video pixels/audio and cold OS launch
remain separate checks. No artificial EPG/history was injected into the TV.
The existing detached Mac backend remains running on port 3335.

No push, PR, paid CI or publication was performed. A user-facing release note
is included under `.changes/tv-live-category-browser.md`.
