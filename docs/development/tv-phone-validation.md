# TV phone setup and discovery validation

Date: 2026-10-25. Package: 0.1.2. This report separates browser/mock checks from
physical LG results. See [TV development](tv-development.md) for commands and
the outstanding physical remote, real-provider playback and cold-relaunch checks.

## Local checks

- 27 TV browser E2E scenarios pass, including all three phone provider forms,
  TV confirmation, storage failure/retry, reload persistence, cancellation,
  expiry, automatic discovery, multiple matches and stale-request cancellation.
  A navigation-during-write regression failed before its fix (phone received
  Cancelled despite a committed TV write) and passes with the final implementation.
- 233 web backend tests pass, including bounded pairing sessions, expiry,
  capability separation, authentication, input validation and asset packaging.
- Targeted lint passes for all nine affected projects.

- 24 TV unit tests pass. TV/phone/test/E2E and backend TypeScript checks pass;
  the repository Angular/Electron `typecheck:ci` also passes.
- TV and backend production builds pass. The built backend serves its bundled
  phone form, JS and CSS on a 390-pixel viewport without horizontal overflow or
  page errors. The form and the actual-TV QR screenshot were visually inspected.
- Classic deferred bundle, ES2018 syntax and unsupported-builtin checks pass.
  The final TV JavaScript is 157,821 bytes; IPK packaging succeeds.
- Dependency synchronization, installed lockfile comparison, release notes,
  agent guidance, repository skills, E2E task graphs, coverage classification,
  font weights, stylesheet inputs and focus checks pass. No coverage thresholds
  or existing module-boundary constraints were weakened.
- A user-facing release note is added at `.changes/tv-phone-setup.md`; canonical
  TV, Nx, self-hosted and development guidance plus the context map are updated.

## Actual LG verification

The user's paired OLED55BX9LB at 192.168.178.44 runs firmware 04.64.00,
webOS SDK 5.6.2 / Chrome 68.0.3440.106. Version 0.1.2 installs and launches.
The final IPK SHA-256 is
`bd38c611788895280d0da2464248fbd94c29b65fb6c65b97cbdba72eba34cfeb`.

With no saved backend, the real TV reads its local network, discovers the
Mac backend at `http://192.168.178.65:3335`, verifies it and displays Connected.
After the final package reinstall/launch, the saved backend reconnects. Eight
SVG navigation icons render. The QR renders at 300 pixels from a 360-pixel image
and focus moves to Close setup. A mobile-sized Playwright browser opens the
actual session form, submits a synthetic M3U draft, and the real TV displays
it with focus on Add source. Declining on the TV reaches the phone as a declined
receipt. This transfer was repeated on the final bundle `index-BpznLspP.js`.
No runtime exceptions were observed during either transfer. No test source was
persisted on the user's TV, and no real provider credentials were inspected.

Device interaction used the actual webOS debugger, not a physical remote or
phone camera. Actual-camera scanning, real subscription/media playback and
physical remote operation remain manual checks. Browser tests cover successful
source writes/reloads and storage failure; this hardware pass does not certify
those flows after cold launcher startup or loss of power. Modern Playwright
Chromium is not evidence of webOS codec support.

The backend runs temporarily from this worktree's built `main.cjs`, with storage
mode none, on the Mac. It requires the Mac and process to remain running; no
system service or autostart was configured. The unrelated port-3333 backend was
left untouched. No push, PR, merge or CI run was performed.

Local evidence: `dist/tv-verification/lg-phone-validation.json`,
`lg-phone-final.json`, `lg-phone-qr.png`, `phone-form.png` and
`phone-validation.json` (exact tested Git revision).
The earlier Angular Stalker Escape failure remains outside this package; see
[tv-validation.md](tv-validation.md).
