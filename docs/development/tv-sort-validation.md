# TV catalog sorting validation

Date: 2026-10-25. Package: 0.1.4.

Movies/series default to recently added. Sorting precedes pagination, with
separate persisted movie/series choices. Switching order cancels old requests;
Back restores the selection in that order. Write failure retains the committed
preference and exposes an error. Missing dates, stable ties, epoch seconds,
milliseconds and ISO dates have regression coverage; release year is excluded.
M3U explains its original-order fallback and Xtream series explain the update-date
fallback. The Stalker mock sorts its whole catalog before paging, with independent
handler tests. Its new handler tests exposed missing aliases in its spec program;
the spec config now inherits the workspace paths and includes fixture sources.

## Local validation

All checks used Node 22.23.2 and pnpm 10.33.0, with a matching installed lockfile
and successful Nx discovery.

- TV unit tests: 32 passed; Stalker mock handler/auth tests: 32 passed.
- `portal-xtream-data-access`, `portal-stalker-data-access` and
  `shared-interfaces` unit targets passed.
- Complete TV browser suite: 38 passed, including five sorting scenarios for
  all providers, stale append cancellation, per-section persistence, focus,
  detail return and storage failure.
- TV, phone setup, TV tests and E2E typing passed, as did Angular/Electron
  production typing, web-backend typing and affected Xtream/mock spec programs.
- Eight affected lint targets passed. Release notes, guidance, skills, E2E
  task graphs, coverage policy and whitespace checks passed.
- Production build, classic-script ES2018/unsupported-builtins verification and
  IPK packaging passed. Dependencies and coverage thresholds are unchanged.

Installed IPK SHA-256:
`024a75c42e0662790ff409c9480c2d15ee3b9ed490f075e13e9b1fe7ae805ea0`.
Bundle: `index-pAt5piaw.js` (168,519 bytes). Tested commit is recorded in the
ignored `dist/tv-verification/sort-validation.json` after the local commit.
No push, PR, CI or release publication was performed. Electron and Angular
feature E2E were not rerun: their runtime behavior is unchanged; the new
framework-free helper and TV adapters have unit and TV browser coverage.

## Real LG

Installed and launched 0.1.4 on the paired LG OLED55BX9LB, firmware 04.64.00,
webOS SDK 5.6.2 / Chromium 68. On the existing user source:

- Movies defaults to recently added and requests `sortby=added`. Each of the
  first three 14-row responses contains dates in descending order. Scrolling
  appends from 28 to 42 loaded titles.
- Title A–Z sends `sortby=name` and changes the first visible titles. It survives
  a debugger page reload and is then restored to Recently added on the TV.
- Series retains its independent Recently added default and sends the correct
  server sort; this source returns no rows in its separate series endpoint.
  Populated series sorting is therefore mock/browser evidence, not a device claim.
- The screenshot was inspected for the added selector and poster layout. No
  runtime exceptions were observed. Existing source/credential data was preserved.

Local device artifacts: `dist/tv-verification/lg-sort.json` and
`lg-sort-recent.png`. Only selected request metadata and date-order counts were
recorded; credentials and TMDB keys were not read or logged. Interaction used CDP
on the actual TV. Physical remote operation, real media codecs and cold starts
are outside this sorting check.
