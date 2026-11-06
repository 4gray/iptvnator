# TV resume validation

Date: 2026-10-25. Package: 0.1.6.

The previous native adapter assigned the saved time once at `loadedmetadata`
and discarded the request immediately. A late duration or ignored native seek
left playback at zero; the subsequent `playing`/pause saves could overwrite the
previous position. A separate caller condition also discarded positions whose
saved duration was zero, and Retry playback always restarted at zero.

Resume now waits for playback/readiness, retries ignored or rejected seeks and
confirms them through subsequent media events with seeking complete. A bounded
30-second failure pauses playback, reports recovery instructions and preserves
the old position. Stop/source replacement cancels retries. Positive user timeline
seeks share the same protection. Retry playback uses saved progress; unknown
saved duration no longer prevents resume. Playback controls show restoration
status. Source identity, episode commands and storage schema are unchanged.

## Local validation

Node 22.23.2, pnpm 10.33.0, matching installed lockfile and successful Nx discovery.

- 37 TV unit tests pass. New regression tests failed against the previous
  implementation, then passed for movies/episodes, late duration, ignored seek,
  progress protection, timeout, cancellation, manual seek and live exclusion.
- The full 46-scenario TV browser suite passes, covering all provider flows.
  Five resume/position scenarios pass again after extending the same protection
  to timeline seeking. New scenarios use native mock media decoding with only
  duration timing and the first seek assignment intercepted; they cover movie,
  episode and unknown-duration records across reload.
- TV, TV tests and E2E typing and TV/data-access/feature/E2E lint pass.
  Release notes, guidance, skills, formatting and whitespace checks pass.
- Production classic-script build, ES2018/unsupported-builtins verification and
  IPK packaging pass. Dependencies, coverage policy and module boundaries are
  unchanged. Angular/Electron E2E are not rerun because their players and
  runtime are unchanged; the independent TV player has unit, browser and LG checks.

Local ignored evidence: `dist/tv-verification/resume-before.log`,
`resume-after.log`, `resume-e2e.log` and `resume-validation.json` (tested commit,
IPK checksum and hardware results). No push, PR, CI or publication was performed.

## Real LG

Installed on the paired OLED55BX9LB, firmware 04.64.00, webOS SDK 5.6.2 /
Chromium 68. The device reports readiness and `playing` before accepting its
first seek: a trace records two assignments to the same saved movie position,
with the second producing `seeking`/`seeked`. This corroborates the timing race
rather than relying on modern Chromium emulation.

After saving a test position, leaving playback and reloading the application:

| Content | Saved target | Confirmed seek | Subsequent clock sample |
| --- | --- | --- | --- |
| Movie | 1979 s (32:59) | 1979 s | 1977.776 s |
| Episode | 1200 s (20:00) | 1200 s | 1198.8 s |

Both native engines accepted the second assignment; neither restarted at zero.
The small clock difference after seek reflects the observed native timeline;
this check is not a frame-accurate seeking guarantee. Both had readyState 4,
seeking false, paused false and no application alerts at the later sample.
CDP screenshots show player controls but do not capture the native video plane;
physical picture/audio quality is not claimed from these screenshots.

Device evidence and final movie/episode results are retained in
`dist/tv-verification/lg-resume.json` and `lg-resume-*.png`. Only playback times,
readiness, events and sanitized error text are captured; no source credentials,
stream addresses or TMDB keys are logged. User-confirmed experimental positions
are used for testing. Navigation uses CDP on the actual TV; debugger reload is
not a cold OS launch, and this does not certify every provider/codec combination.

The Home hero remains the first movie supplied by the source catalog. A separate
proposal is up to three recent unfinished titles, one active episode per series,
manual remote selection, Resume and Details actions, while keeping the existing
Continue watching rail. That product change is not part of this playback fix.
