# Download Manager MVP Redesign

**Status:** Approved
**Date:** 2026-07-30

## Context

The current desktop download manager renders every download as the same
management card. The approved handoff in `IPTVnator Download Manager.html`
instead separates work that needs attention from content that is ready to
watch:

1. a dense queue for active and interrupted transfers;
2. a poster library for completed movies and series.

This MVP adopts that composition while retaining the existing SQLite schema,
Electron IPC surface, queue semantics, portal routes, and local-file actions.
It deliberately does not present mock data for capabilities the application
cannot currently measure.

Because `DownloadsService` is a root singleton consumed by the workspace shell
and content detail views, its `downloads` signal always contains the global
download list. Playlist scope is a view concern and never replaces that shared
signal with a partial list.

## Goals

- Give active transfers a compact, scannable `Downloading now` queue.
- Present completed downloads as a familiar VOD-style `Ready to watch`
  library.
- Make the global `/workspace/downloads` page useful across all sources while
  preserving existing playlist-scoped portal routes.
- Add functional All, Movies, Series, and In progress filters.
- Group completed episodes from the same source series into one library card.
- Keep every existing pause, resume, cancel, retry, play, reveal, copy, and
  remove operation reachable.
- Make file-retention behavior explicit instead of implying that a completed
  media file is deleted when only its manager entry is removed.
- Reuse IPTVnator's existing light/dark theme tokens, typography, icons,
  layout mixins, and empty-state components.
- Split the oversized page into focused standalone Angular components with a
  pure, unit-tested view-model layer.

## Non-goals

This MVP does not add:

- recordings to the download library;
- offline connectivity detection, startup redirects, or cached offline detail
  pages;
- disk-capacity or free-space statistics;
- transfer speed or ETA calculation;
- pause-all, resume-all, queue priority, or queue reordering;
- missing-file scans, folder relocation, or repair flows;
- a new download-history or delete-file-but-keep-history model;
- preflight disk-space checks or partial-season selection;
- new download database columns or Electron download IPC commands.

## Ownership and routing

`WorkspaceShellComponent` continues to own the application header, global
search, primary navigation rail, drag regions, and the global Downloads
shortcut. The download feature renders only the center content area.

- `/workspace/downloads` loads all download rows.
- `/workspace/xtreams/:id/downloads` and
  `/workspace/stalker/:id/downloads` retain their current playlist scope.
- All three routes render the same queue/library composition.
- `DownloadsService.loadDownloads()` always refreshes the global list. A
  scoped page applies its route playlist ID only in the pure view model.
- The workspace Downloads badge continues to count global queued/downloading
  rows. The page-title badge counts queued/downloading rows within the current
  route scope.
- Existing portal collection context remains the category source of truth.
  Inline filter chips read and update that same selected category, so scoped
  shell context controls and the page cannot diverge.
- The workspace `?q=` search parameter remains the search source of truth.

No shell chrome from the handoff HTML is duplicated inside the feature.

## Angular component boundaries

The feature remains inside the existing `portal-downloads-feature` Nx project.
It is decomposed by responsibility:

- `DownloadsComponent` is the smart container. It owns route scope, playlist
  lookup, collection context, navigation, dialogs, snackbars, and calls into
  `DownloadsService`. It never requests a playlist-filtered replacement for
  the root service signal.
- A pure download-manager view-model module filters, partitions, sorts, counts,
  and groups `DownloadItem` values without Angular or service dependencies.
- A queue-list component renders section headings and individual queue rows.
- A library-grid component renders completed movie and grouped-series cards.
- A downloaded-series dialog renders the concrete episode files within one
  grouped series and exposes their file actions.
- Presentational children use signal inputs/outputs, OnPush change detection,
  and typed user-intent events. They do not inject `DownloadsService`,
  `Router`, dialogs, or snackbars.

Production TypeScript files stay below the repository's new-file line limit.
The existing max-lines baseline entry for `downloads.component.ts` must shrink
or disappear after the split; no new file is added to the baseline.

## View-model pipeline

The container derives the rendered model through one deterministic pipeline:

1. Apply the optional route playlist scope.
2. Resolve a source label from the loaded playlist map.
3. Apply the normalized workspace search term.
4. Apply the selected content/status filter.
5. Partition rows into active queue, attention queue, and completed library.
6. Sort queue entries by parsed `createdAt` ascending and then numeric `id`
   ascending. Sort library entries by their newest member timestamp descending
   and then stable entity key.
7. Group completed episode rows into series cards.

The view model is recomputed from signals and is never persisted separately.
Electron broadcasts and the subsequent `downloadsGetList()` response remain
authoritative. Missing or invalid timestamps normalize to zero for ordering.

### Filter semantics

| Filter      | Queue                                | Attention           | Library                   |
| ----------- | ------------------------------------ | ------------------- | ------------------------- |
| All         | Movies and episodes                  | Movies and episodes | Movies and grouped series |
| Movies      | VOD rows                             | VOD rows            | Completed VOD cards       |
| Series      | Episode rows                         | Episode rows        | Grouped completed series  |
| In progress | Queued, downloading, and paused rows | Hidden              | Hidden                    |

Chip counts are calculated from the scoped, partitioned, and grouped model
before text search, so typing in the workspace search does not make category
totals jump:

- All counts the entities the unsearched page would render: active rows,
  attention rows, completed movie cards, grouped series cards, and ungrouped
  completed-episode cards.
- Movies counts VOD rows/cards across all three partitions.
- Series counts active/attention episode rows plus grouped or ungrouped
  completed-series entities.
- In progress counts queued, downloading, and paused rows.

Search matches the stored item title, derived series title, source name,
episode label, and error message.

### Queue partitions

- `Downloading now` contains `queued`, `downloading`, and `paused`.
- `Needs attention` contains `failed` and `canceled`.
- A section is omitted when it has no rows.
- `Ready to watch` contains only `completed`.

This avoids describing failed or canceled rows as currently downloading while
keeping them close to the queue actions that repair or dismiss them.

## Completed-series grouping

Completed episode rows with a positive safe-integer `seriesXtreamId` are
grouped by `playlistId + seriesXtreamId`. This prevents identical provider IDs
from different playlists from merging.

- Episodes without a positive safe-integer `seriesXtreamId` fall back to
  individual episode cards.
- The group title is derived from the standardized stored title prefix before
  `- SxxExx -`. If a legacy title does not match that form, the first
  non-empty member title is used unchanged.
- Artwork uses the newest member with a valid poster URL.
- The group exposes episode count, downloaded season range, aggregate tracked
  bytes, source label, and newest member timestamp.
- Members are ordered by season number, episode number, then creation time.
- Aggregate tracked bytes are the sum of each member's
  `bytesDownloaded ?? 0`.

Clicking the series artwork or title opens the existing source series detail
view. That view already marks downloaded episodes and exposes local playback.
A separate `N episodes` control opens a compact downloaded-series dialog so
Play, Show in folder, Copy URL, and Remove from manager remain available for
each concrete file.

If the source playlist has been removed, detail navigation is disabled with
the existing explanatory tooltip only as a defensive corrupted/legacy-data
guard. Normal playlist deletion cascades to download rows, so an orphaned
download is not a supported user-visible state.

An ungrouped completed episode shows its stored title, `SxxExx` label when
season/episode values are usable, Episode type, source, poster, and tracked
size. Because it lacks a trustworthy series identity, it does not claim to
open series details. Play, Show in folder, Copy URL, and Remove from manager
remain available for that concrete file.

## Page composition

The feature owns one fixed header region and one scrolling content region.

### Header region

1. Page title and current-scope queued/downloading count.
2. Current download folder, truncated in the middle-safe available width and
   exposed in full through tooltip/title text.
3. `Change folder`.
4. `Clear finished` when completed, failed, or canceled rows exist.
5. A compact tracked-data summary with the folder and total byte progress
   recorded across the rows still owned by the manager.
6. All, Movies, Series, and In progress filter chips.

The summary says `Tracked downloads`, not disk used or disk free. Its value is
the sum of `bytesDownloaded ?? 0` for every row in the current route scope.
This is database-recorded byte progress, so it is not presented as an exact
filesystem measurement and has no percentage meter. Exact disk reconciliation
belongs to the missing-file/storage work outside this MVP.

### Scrolling region

1. `Downloading now`, if present.
2. `Needs attention`, if present.
3. `Ready to watch`, if present.
4. The relevant compact empty state when a selected filter or search has no
   matches.

Queue sections and the library share one scroll owner. The header, storage
summary, and filters remain visible.

## Queue-row behavior

Every queue row contains:

- poster thumbnail or content-type placeholder;
- title;
- episode label when applicable;
- source label;
- semantic status pill;
- downloaded and total byte values;
- determinate progress when `totalBytes` is known, otherwise indeterminate
  progress for an active transfer;
- status-specific actions.

| Status      | Primary actions                     |
| ----------- | ----------------------------------- |
| queued      | Pause, Cancel                       |
| downloading | Pause, Cancel                       |
| paused      | Resume, Cancel, Remove from manager |
| failed      | Retry, Remove from manager          |
| canceled    | Retry, Remove from manager          |

Copy URL is placed in an overflow menu rather than competing with the primary
transfer controls. Clicking the title/artwork opens the corresponding source
detail when navigation is available. Action controls stop event propagation.

An item-level pending set disables repeated commands until each promise
settles. The UI does not optimistically change status; the backend result and
subsequent broadcast drive the rendered transition. Structured failures use
the existing snackbar path.

## Library-card behavior

Movie and series cards use the shared content-grid dimensions and two-to-three
poster ratio. Each card shows:

- poster or semantic placeholder;
- `Offline` badge;
- title;
- movie or series label;
- tracked size;
- source label;
- episode count and season range for grouped series.

Movie cards expose Play and Show in folder as the most prominent local
actions. Copy URL and Remove from manager live in an overflow menu. Series
cards expose source details and the downloaded-episodes dialog described
above.

Touch and keyboard users can reach every action without relying on hover.

## Removal and clearing semantics

The current backend removes the download database row and any retained
`.part` file, but it does not delete an already finalized media file. The MVP
does not change that contract.

Therefore:

- `Remove` becomes `Remove from manager`.
- `Clear Completed` becomes `Clear finished`.
- Removing a completed entry says that its finalized media file remains on
  disk.
- Removing a paused, failed, or canceled entry warns that any retained partial
  download is deleted and can no longer be resumed.
- `Clear finished` says that finalized media files remain, while retained
  partial data belonging to failed/canceled rows is deleted.
- The completed-card action does not use a trash/delete-file icon or claim to
  reclaim disk space.
- The tracked-data summary includes only rows still owned by the manager. Once
  a row is cleared, its finalized file may remain on disk but its recorded byte
  progress is no longer included.

Changing this behavior requires a separate filesystem/history design with
explicit delete and recovery semantics.

## Loading, empty, and error states

- Desktop-unavailable messaging remains for runtimes without the download
  bridge.
- Playlist loading and download loading render skeletons shaped like the new
  queue and poster sections.
- A profile with no playlists keeps the existing add-playlist/source actions.
- A profile with playlists but no downloads keeps the storage summary visible,
  explains that downloads begin from movie or episode details, and links back
  to the dashboard.
- A filter or search miss uses a compact inline empty state without replacing
  the whole page.
- Broken poster URLs switch once to the semantic placeholder.
- File-not-found and file-action errors continue to use translated snackbars.
- No connectivity-specific state is inferred in this MVP.

## Theme and visual language

The handoff's standalone `tokens.css` is a visual reference, not a new runtime
token source. Its roles map to existing IPTVnator variables:

| Handoff role               | IPTVnator source                                         |
| -------------------------- | -------------------------------------------------------- |
| page background            | `--app-content-bg`                                       |
| panel/card background      | `--app-widget-bg`                                        |
| raised/secondary surface   | `--app-widget-header-bg`, `--app-card-hover-bg`          |
| primary and secondary text | `--app-heading-color`, `--app-body-color`                |
| muted text                 | `--app-muted-color`, `--app-eyebrow-color`               |
| active blue                | `--app-selection-color` and `--app-selection-*` surfaces |
| separators                 | `--app-separator`, `--app-widget-header-border`          |

The implementation reuses DM Sans, JetBrains Mono for compact byte/path
metadata, Material icons, and the shared `content-grid` Sass mixin.
`GridListComponent` itself is not reused because its fixed
poster/rating/title contract cannot expose download badges and file actions
without widening a shared portal API for unrelated consumers.

No parallel surface/text token set is added. Semantic status styling reuses
the application's established download/error colors and always pairs color
with text and iconography.

## Responsive behavior

- Wide layouts keep queue metadata, status, progress, and controls on one row.
- Below the feature's medium container width, progress and byte metadata move
  below the title while controls remain trailing.
- Narrow layouts stack the page heading and folder actions.
- Filter chips become a horizontally scrollable, keyboard-reachable row rather
  than wrapping into several uneven lines.
- The poster grid lowers its minimum card width while preserving the two-to-
  three artwork ratio and readable text.
- On touch-sized layouts, card actions remain visibly reachable instead of
  appearing only on hover.
- Content owns one vertical scroll region and never introduces a competing
  nested list scroll.

Animations are short surface/transform transitions and are removed under
`prefers-reduced-motion`.

## Accessibility

- Sections use headings and named regions.
- Clickable artwork/title controls are real links or buttons, not click-only
  `div` elements.
- Icon buttons have translated accessible names and visible focus states.
- Progress bars expose mode, current value, and a useful item label.
- Byte progress updates do not use a live region every 500 ms.
- Status changes and command failures are announced without duplicating every
  progress tick.
- Poster images use meaningful or deliberately empty alternative text based on
  whether adjacent text already supplies the title.
- Status is never conveyed by color alone.
- Series dialog focus is trapped and restored by Angular Material, supports
  Escape, and labels every episode action with its episode identity.

## Test strategy

The feature receives its own Jest target/config, following an existing Angular
library in the workspace.

### Unit coverage

Pure view-model tests cover:

- global and playlist-scoped filtering;
- all four filter modes and stable counts;
- search across title, derived series title, source, episode, and error text;
- queue/attention/library partitioning;
- deterministic ordering;
- cross-playlist series separation;
- legacy or missing series metadata fallback;
- poster and title selection;
- episode count, season range, and aggregate tracked bytes.

Focused component tests cover:

- typed action emission for every status;
- pending/disabled controls;
- no navigation from nested action buttons;
- keyboard access to cards and filter chips;
- grouped-series dialog actions;
- completed-row versus partial-row confirmation copy;
- loading and compact empty states.

Adding the feature test target also updates the corresponding
`tools/coverage/coverage-policy.json` entry so it no longer claims that the
project has no test target.

### Electron end-to-end coverage

`apps/electron-backend-e2e/src/downloads.e2e.ts` moves from styling-class and
icon-text locators to roles and stable `data-testid` values. It verifies:

- first-run/no-playlist state;
- selected folder presentation;
- two source playlists remain visible globally while each scoped route shows
  only its own rows, without changing the global workspace badge;
- workspace `?q=` search and each filter produce the specified partitions;
- an active transfer appears in `Downloading now`;
- pause retains its partial and resume completes through HTTP Range;
- completion moves the item into `Ready to watch`;
- multiple completed episodes render one grouped series card whose details and
  downloaded-episodes dialog target the correct playlist/series;
- Play and Show in folder remain available;
- removing a completed row preserves the finalized file;
- removing/clearing a retained failed or canceled row deletes its `.part`.

Backend unit suites are rerun only if implementation reveals an unintended
contract change; the approved design does not require one.

### Visual and build validation

- Feature lint and unit tests.
- Services tests if service helpers change.
- Web typecheck and Angular/Nx production build.
- Targeted Electron downloads E2E.
- Release-note and i18n validation.
- Running Electron inspection at wide/narrow dimensions and in light/dark
  themes through `agent-browser`.
- A final native-window inspection through Computer Use.

Any documentation screenshot uses only the repository's mock servers and
release-capture workflow; real playlist artwork, metadata, streams, and
credentials are prohibited.

## Documentation and release impact

- Update `docs/architecture/download-manager.md` to describe the queue/library
  view model, grouping behavior, route scope, and honest removal semantics.
- Update affected `CLAUDE.md` download-manager text only if an existing claim
  becomes stale after implementation.
- Add a user-facing `.changes/downloads-*.md` note and validate it.
- Assess the README download-manager screenshot. Refresh it only through a
  mock-backed release capture; otherwise record why capture support remains a
  follow-up.

## Acceptance criteria

The MVP is complete when:

1. active work, attention states, and ready content are visually distinct;
2. global and scoped routes preserve their intended data boundaries;
3. filters, search, queue actions, grouped-series navigation, and all local
   file actions work with current backend contracts;
4. removal and clearing preserve finalized media, delete retained partial data
   where the existing backend does so, and explain both outcomes accurately;
5. the screen is intentional in light/dark and wide/narrow layouts;
6. keyboard and screen-reader semantics do not depend on hover or color;
7. unit, build, targeted Electron E2E, i18n, and release-note validation pass;
8. canonical download-manager documentation and the release note are current.
