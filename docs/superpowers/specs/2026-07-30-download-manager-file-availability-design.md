# Download Manager File Availability and Card Cleanup

**Status:** Approved  
**Date:** 2026-07-30

## Context

The Download Manager currently treats every persisted `completed` row as
ready to watch. That is only historical transfer state: the finalized file may
have been deleted or its external volume may be unavailable. The main process
checks the filesystem only after Play or Show in folder, so an unavailable
item remains in `Ready to watch` until an action fails.

The completed-library cards also repeat information that is already implied by
the section:

- every card carries an `Offline` badge under the `Ready to watch` heading;
- the source label permanently occupies the narrow metadata row.

This follow-up makes the library reflect current file availability, simplifies
the cards, and preserves source information in the existing overflow menus.
It supersedes the missing-file non-goal in the original Download Manager MVP
spec without adding a background filesystem watcher or database migration.

## Decisions

- `Ready to watch` contains only completed downloads whose finalized files are
  currently available as regular, non-symbolic-link files.
- A completed row whose file is unavailable appears in `Needs attention` with
  a `File missing` status.
- File availability is derived by the Electron main process and is not
  persisted as a replacement download status.
- `Download again` revalidates the file and requeues the existing download row
  at its retained destination when the file is still unavailable.
- The Download Manager removes the `Offline` badge from completed cards.
  Provider detail pages retain their `Offline` indicator for available local
  files.
- The source label moves from always-visible card/row metadata into the top of
  the overflow menu.
- Existing Stalker series detail navigation remains unchanged and gains
  regression coverage for both ordinary series and VOD-series routes.

## Goals

- Never describe an unavailable local file as ready to watch.
- Keep temporary volume disconnection recoverable without permanently
  rewriting transfer history.
- Offer an immediate, understandable recovery action.
- Keep available members of a partially missing series playable.
- Remove redundant card chrome while keeping file size and source provenance
  reachable.
- Ensure missing files cannot make detail views advertise local playback.
- Reuse existing Material components, theme tokens, queue rows, dialogs,
  pending-state handling, and download destination rules.

## Non-goals

This change does not add:

- a continuous filesystem watcher;
- persisted availability columns or a download-table migration;
- automatic redownload without an explicit user action;
- folder relocation or a search-for-file workflow;
- offline metadata caching or provider-independent detail pages;
- bulk redownload for a partially missing series;
- automatic deletion of a missing download record;
- changes to provider playback or Stalker/Xtream route structure.

## Availability contract

`DownloadItem` gains a renderer-visible availability value:

```ts
type DownloadFileAvailability = 'available' | 'missing' | 'not-applicable';
```

The Electron main process decorates rows returned by `DOWNLOADS_GET_LIST` and
`DOWNLOADS_GET`:

- `available` — status is `completed`, `filePath` is present, and `lstat`
  identifies a regular non-symbolic-link file;
- `missing` — status is `completed`, but the path is absent, inaccessible, a
  directory, or a symbolic link;
- `not-applicable` — the download is not completed.

The value is computed for each list request and never written into SQLite.
This distinction matters for removable volumes: reconnecting a volume and
refreshing the list restores `available` without repairing database state.

Filesystem inspection stays in the trusted main process. Renderer code does
not receive a new arbitrary-path probe and cannot request checks for unmanaged
files.

## View-model partitioning

The pure Download Manager view model partitions rows in this order:

1. `queued`, `downloading`, and `paused` enter `Downloading now`;
2. `failed` and `canceled` enter `Needs attention`;
3. `completed + missing` also enters `Needs attention` with a derived
   missing-file presentation;
4. only `completed + available` enters `Ready to watch`.

Missing completed items retain their persisted `completed` status. The
attention-row view model carries a distinct presentation reason so the queue
component does not pretend that the transfer itself failed.

For series:

- available episodes continue to group by `(playlistId, seriesXtreamId)` in
  `Ready to watch`;
- each unavailable episode appears as a concrete `File missing` row in
  `Needs attention`, because recovery operates on one finalized file;
- if every episode is unavailable, the series has no ready card;
- a partially available series card reports only its currently available
  members and aggregate available bytes.

Filter and search semantics remain unchanged. Missing VOD rows match Movies,
missing episode rows match Series, and source name remains searchable even
though it is no longer always visible. Category counts reflect the entities
the page renders; each missing episode is an attention entity.

## Missing-file row

The existing queue-row component renders a derived missing-file variant:

- poster, title, episode label when applicable, and tracked size;
- amber `File missing` status;
- restrained, token-based muted treatment without reducing text contrast
  below the normal queue-row contract;
- `Download again` as the primary recovery action;
- overflow menu containing source provenance, Copy URL, and Remove from
  manager.

Artwork and title may still open provider details when provider navigation is
available. They never attempt local playback. Play and Show in folder are not
rendered for a missing item.

If the source playlist is no longer available, the existing source-missing
navigation behavior remains authoritative. Local recovery can still use the
stored download request metadata.

## Download-again flow

Recovery uses an explicit main-process command rather than overloading the
existing failed-download Retry contract:

1. The renderer sends the managed download ID, never a caller-selected file
   path.
2. The main process reloads the row and requires persisted status
   `completed`.
3. It rechecks the finalized path.
4. If the file has reappeared, it performs no network request, returns a
   successful recovered result, and causes the renderer to refresh.
5. If the file is still unavailable, it requeues the existing row using the
   retained destination and existing request URL/header metadata.
6. Existing destination reservation, no-overwrite, authorization, partial
   cleanup, queue serialization, broadcast, and structured-error rules remain
   authoritative.

The retained destination follows the existing retry/resume ownership rule:
changing the preferred download folder does not relocate a previously owned
row. If the retained directory itself is unavailable, recovery returns a
structured failure and the row remains in `Needs attention`.

The item participates in the existing pending-ID set, so repeated clicks are
disabled until the operation settles. Successful requeueing moves it to
`Downloading now` after the backend broadcast. A failed Play or Reveal caused
by a file deleted after the last list load triggers a list refresh, so the row
moves to `Needs attention` immediately after that failure.

## Completed-card cleanup

Ready cards keep the shared cover-size and content-grid contracts.

- Remove the `Offline` artwork badge from movie, grouped-series, and
  standalone-episode cards.
- Remove the source label and separator from the permanent metadata row.
- Keep tracked size visible.
- Keep movie Play and Show in folder actions unchanged for available files.
- Put a small non-interactive `Source` label and the resolved playlist title at
  the top of the movie overflow menu, followed by Copy URL and Remove from
  manager.
- Give grouped-series cards an overflow menu with the same source header and
  an action to open downloaded episodes. Per-episode file actions remain in
  the existing series dialog.
- Put source provenance at the top of missing-file and other queue-row overflow
  menus instead of keeping it in the row metadata.

The source header truncates long values, exposes the full value through
accessible text or tooltip, and uses existing typography/color tokens. It is
informational rather than a disabled Material menu item, so screen readers do
not announce it as an unavailable command.

## Detail playback

`DownloadsService.isDownloaded()` and `getDownloadedFilePath()` require
`fileAvailability === 'available'`. Therefore:

- an available completed item keeps the `Offline` detail indicator and local
  primary Play action;
- a missing completed item does not expose local playback or identify itself
  as offline on a detail page;
- provider playback remains available when the provider item is usable.

This prevents the detail page from reintroducing the same misleading state
after the item has correctly moved out of `Ready to watch`.

## Series navigation regression

Manual Electron reproduction on the current build confirmed that Stalker
series cards no longer navigate to Recently viewed:

- a VOD-series download opened the canonical Stalker `vod/vod` detail route;
- an ordinary series download opened the canonical Stalker `series/series`
  detail route.

The implementation therefore changes no routing production code unless a
failing regression test reveals a separate case. Focused tests must prove that
both series shapes call the canonical detail target and never navigate to a
recent route.

## Error handling and refresh

- A filesystem inspection error is treated as `missing` and does not crash or
  reject the entire list.
- A recovery race in which the file reappears is resolved in favor of the
  existing file; IPTVnator never overwrites it.
- A deleted file detected by Play or Reveal shows the existing file-not-found
  feedback and refreshes the list.
- A network, folder, or queue error during Download again uses the existing
  action-error snackbar and leaves the item in `Needs attention`.
- Removing a missing entry removes only the manager row and any owned partial;
  there is no finalized media file to delete.

## Testing

The implementation follows red-green TDD and adds coverage at the closest
ownership boundaries:

- Electron event tests for list decoration, regular-file validation,
  unavailable paths, reappeared-file races, and Download again;
- `DownloadsService` tests for the availability-aware local-playback contract
  and refresh after file-action failure;
- pure view-model tests for missing movies, fully missing series, partially
  missing series, search, filters, counts, and input immutability;
- queue component tests for File missing presentation, actions, source menu,
  pending state, and accessibility;
- library component tests proving Offline/source removal and source placement
  in movie and series menus;
- container tests for recovery wiring and file-not-found refresh;
- Stalker navigation regressions for both canonical series detail shapes;
- Electron E2E covering an unavailable finalized file moving to
  `Needs attention`, a successful Download again transition, and available
  cards remaining in `Ready to watch`;
- affected project tests, lint, Electron web build, release-note validation,
  and manual light/dark Electron inspection.

## Documentation and release note

The implementation updates `docs/architecture/download-manager.md` to make
filesystem-derived readiness canonical and adds a user-facing release note.
The original MVP spec remains historical context; this approved follow-up is
the source of truth for missing-file presentation and card metadata cleanup.
