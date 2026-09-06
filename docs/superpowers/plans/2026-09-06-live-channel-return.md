# Live channel return implementation plan

> **For agentic workers:** Use subagent-driven-development for the independently owned Xtream integration, with spec and code review. Execute the shared queue, Stalker integration and validation in this task. Do not merge the resulting PR.

**Goal:** Keep live remote navigation stable during category/search browsing and provide one conditional action to reveal the playing channel, without duplicating its title or restarting playback (#1520).

**Architecture:** Each live host owns a playback queue scoped by source and content type. Explicit channel activation captures the displayed ordered list; remote commands preserve it. Stalker extends the captured queue only when more rows arrive for the same browsing scope, never by falling back to a global ITV cache. Revealing restores the channel's available category and clears search without invoking playback. Provider-neutral queue state belongs in portal/shared/data-access; portal routing, visibility and scrolling remain in their feature libraries.

**Tech Stack:** Angular signals, Nx/Jest, Playwright, Electron IPC, existing Material icon buttons and translations.

## Contract

- Capture the list before asynchronous playback resolution; commit the queue only for the winning successful request. Same active-channel replays/catch-up return keep the queue.
- Source/type changes invalidate old queue ownership. Numeric, adjacent and status all read the same queue; remote commands never recapture the browsed category.
- A captured paged Stalker queue contains loaded rows. Newly loaded rows extend it only while source/type/category/search scope still matches. No background all-portal crawling; unavailable pages are not advertised as loaded channels.
- Xtream uses the actual sidebar sort/search order and filters hidden/removed categories and channels from navigation eligibility. Revealing never unhides categories.
- An out-of-filter channel gets a localized `CHANNELS.SHOW_PLAYING_CHANNEL` action in the existing list header. No now-playing title block or EPG changes. Reuse the existing sidebar restore action while collapsed.
- Reveal clears interfering query state, selects the active channel's accessible category, waits for rows/rendering and scrolls/focuses the scroll owner. Stale navigation/loading must not reselect a previous channel or restart the player. For paged Stalker search, reuse the already-resolved channel as a scoped normal row until provider results include it, rather than crawling the catalog.
- Fullscreen selection captures its own displayed filtered list; existing fullscreen controls and playback/session ownership remain intact. No redesign of the fullscreen panel.
- Stalker #1543 remains independent: queue capture consumes the actual list and makes no new global-search policy.

## Tasks

- [x] Add `LiveChannelPlaybackQueue<T>` and focused tests under `libs/portal/shared/data-access/src/lib/`; export via the public barrel. Test capture/fallback, source/type ownership, preserved order, same-scope extension, stale-scope rejection, unchanged-snapshot identity and reset. Run the focused Jest target red, then green.
- [x] Extend Xtream live layout and channel-list integration with regression coverage: category/search/sort drift, numeric/status/adjacent parity, hidden category exclusion, reveal without playback calls, route category/query handling, fullscreen list capture. Keep new logic in focused feature files where needed for max-lines. Run `pnpm nx test portal-xtream-feature --runInBand` and lint.
- [x] Extend Stalker live layout with the same queue policy and reveal action. Cover ITV/radio ID collisions, asynchronous successful/failed/stale resolution, paged queue extension, cache render windows, category/search drift, and reveal without session reset. Run `pnpm nx test portal-stalker-feature --runInBand` and lint.
- [x] Add `CHANNELS.SHOW_PLAYING_CHANNEL` to all shipped locale dictionaries. Keep icon button tooltip and accessible name identical.
- [x] Extend closest web and Electron E2E flows. Verify real remote HTTP commands preserve the original queue after browsing changes, and reveal retains the same video/session. Check both portal UIs in light/dark with synthetic sources only.
- [x] Update `docs/architecture/remote-control.md`, `stalker-portal.md`, `workspace-shell.md`, and mirrored AGENTS.md/CLAUDE.md guidance. Add one `.changes/portals-live-channel-return.md` note and validate it.
- [x] Run affected unit targets, E2E, lint, Electron E2E build, release-note validator and `git diff --check`. Complete independent spec review, then code-quality review and resolve findings.
- [ ] Commit, create a PR and complete CI/review checks to ready-to-merge without merging, as authorized in this task's original scope.

## Validation commands

```sh
pnpm nx test portal-shared-data-access --runInBand
pnpm nx test portal-xtream-feature --runInBand
pnpm nx test portal-stalker-feature --runInBand
pnpm nx run-many -t lint -p portal-shared-data-access,portal-xtream-feature,portal-stalker-feature
pnpm nx run electron-backend:build-e2e --parallel=1
pnpm run release:notes:validate
git diff --check
```

Choose atomized existing web/Electron E2E targets after inspecting project discovery and their runner configuration. Record any environment limitations rather than treating a build or unit pass as full runtime validation.

## Validation record

- Shared data-access: 169 unit tests; Xtream: 442; Stalker: 349 — passed.
- Electron build and all three affected library lint targets — passed (existing warnings only).
- Electron remote-control suite: 5/5, including both portals and Stalker radio;
  Chromium category-switch/reveal regression: 1/1 — passed.
- New regressions exposed the original queue drift, same-URL reveal cancellation,
  and virtual viewport attachment race before their fixes.
- Independent spec and quality reviews passed after resolving provider-search
  ownership, beyond-page reveal and delayed-playback page reconciliation.
- Release notes and diff whitespace validated. Tested UI in light/dark using
  synthetic mock portals. Platform-specific Windows/Linux packaged runs and
  Firefox/WebKit were not needed for the shared renderer/IPC-navigation change.
