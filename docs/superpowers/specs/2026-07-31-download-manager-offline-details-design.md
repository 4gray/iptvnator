# Download Manager Offline Details Design

## Status

Approved for implementation on 2026-07-31.

## Context

Download Manager ready cards currently navigate into the provider's canonical
catalog detail flow. That fixed the earlier accidental playback-on-card-click
behavior, but it also reintroduces the playlist category panel and provider
catalog context. Stalker series opened from a sparse persisted download can
also lack the metadata that Favorites and Recently Viewed retain.

The download library needs a distinct offline detail experience. It must make
the local file authoritative, remain useful without network access, and offer
an explicit escape hatch into the full provider catalog when the user wants
online context.

## Goals

- Open downloaded movies and series in a full-width, collection-owned offline
  detail view without the playlist category panel.
- Reuse the metadata quality and visual language of existing Xtream and
  Stalker detail views, including optional TMDB enrichment.
- Keep movie playback explicitly local.
- Show only locally available seasons and episodes for downloaded series.
- Provide an explicit `View in portal` action that opens the normal provider
  detail with the category panel, full episode catalog, and provider playback.
- Preserve useful metadata when the portal or TMDB is unavailable.
- Keep old downloads functional even though they predate metadata snapshots.

## Non-goals

- Building a second provider catalog inside Download Manager.
- Streaming an episode from the offline detail view.
- Showing unavailable provider episodes as disabled offline rows.
- Downloading a full season or series in one action.
- Replacing the existing Xtream or Stalker provider detail architecture.
- Changing normal provider-detail behavior when it was not opened through the
  offline view's `View in portal` action.

## Approved UX

### Navigation

Ready cards navigate to a dedicated offline detail route owned by Download
Manager. The route remains inside the current global or provider-scoped
downloads context:

- `/workspace/downloads/:downloadId`
- `/workspace/xtreams/:playlistId/downloads/:downloadId`
- `/workspace/stalker/:playlistId/downloads/:downloadId`

For a grouped series card, `downloadId` is the representative completed
episode. The detail resolver uses its `(playlistId, seriesXtreamId)` identity
to load the complete locally available group.

The workspace shell treats a downloads item route as a focused detail route:
the collection/category context panel and collection search controls are
hidden. Back returns to the Download Manager route and preserves its query
search, filter, scope, and browser-history position.

`View in portal` deliberately leaves the offline route and invokes the
existing provider navigation flow:

- Xtream opens its canonical movie or series route.
- Stalker opens its existing category/store-state detail flow.

The provider route restores the playlist category panel and full provider
catalog context.

### Movie Detail

The movie screen uses the shared portal detail visual language:

- Back to Downloads
- artwork/backdrop
- title, description, year, duration, genres, rating, cast, and other available
  editorial metadata
- an `Available offline` state
- primary `Play offline`
- secondary `View in portal` beside the primary action
- file-management actions such as Show in folder in the existing overflow
  pattern

There is no `Play from source` action on the offline screen.

### Series Detail

The series screen uses the same metadata-rich hero, followed by an offline-only
season and episode list:

- `View in portal` remains a visible hero action; it is not hidden in overflow;
- only seasons containing at least one currently available local file appear;
- only downloaded episodes whose finalized files are currently available
  appear;
- season chips show the number of available offline episodes;
- each row shows the season/episode coordinate, title when known, file size,
  and an explicit local Play action;
- episode ordering is natural by season, episode, creation time, and id;
- no provider-only episode appears, even if provider or TMDB metadata returns a
  complete season.

There is no ambiguous series-level streaming action. Playback starts from the
explicit action on an available episode row.

### Provider-only Handoff

`View in portal` is navigation, not playback. It opens the existing provider
detail in an explicit provider-only presentation for that handoff:

- full provider metadata and full season/episode catalog are visible;
- normal provider Play actions are available;
- downloaded/offline badges and local playback actions are suppressed;
- the category panel behaves exactly as it does during normal catalog
  browsing.

The provider-only flag is scoped to this navigation. Opening the same item
normally elsewhere retains the application's existing behavior.

## Metadata Architecture

### Provider-neutral Snapshot

Add a versioned, provider-neutral metadata snapshot to each download row. The
snapshot contains only display data needed by the offline detail view:

- media kind and stable provider/TMDB identifiers
- title and original title
- description/plot
- release date/year, duration, genres, rating, and status
- poster/backdrop metadata
- bounded cast/creator entries
- parent-series metadata for episode downloads
- episode title, description, still, season number, and episode number
- snapshot language, schema version, and enrichment timestamp

The snapshot must never contain stream URLs, request headers, credentials,
MAC/device identity, cookies, or other authentication material. Renderer and
main-process boundaries validate the snapshot shape and enforce a bounded
serialized size before persistence.

Episode rows carry both their episode metadata and the shared parent-series
snapshot. A grouped series selects the newest valid parent snapshot and merges
only missing fields from older valid snapshots. Backfilling a series updates
the matching managed group so later opens do not repeat the same work.

### Snapshot Creation and Refresh

New downloads pass the best metadata already present in the detail view into
`DownloadsService.startDownload`. The main process persists the validated
snapshot with the managed download row.

Opening an offline detail follows this order:

1. Render the persisted snapshot immediately.
2. If the snapshot is absent, sparse, stale, or in another app language, try a
   best-effort provider metadata load through the existing Xtream or Stalker
   data-access path.
3. If TMDB is enabled, run the existing `TmdbEnrichmentService` and existing
   field-level merge helpers. TMDB remains best-effort and cached according to
   the current runtime policy.
4. Persist the validated merged result back to the managed download row or
   series group.
5. If provider or TMDB loading fails, retain and display the best local
   snapshot. A sparse legacy row still renders title, poster, file size, and
   local playback.

Provider metadata remains authoritative for stream identity and provider-only
fields. TMDB wins only for the same editorial fields it already enriches in
the existing detail views.

### Legacy Downloads

No destructive migration is required. Existing rows receive a nullable
snapshot column. Their first offline-detail open attempts the enrichment and
backfill flow. Failure leaves the row playable with its existing
title/poster/file metadata.

## Component Boundaries

### Download Offline Detail Route

A focused route component owns:

- resolving a managed download by id;
- validating that it is completed and locally available;
- resolving grouped-series members;
- choosing movie versus series presentation;
- preserving the return URL;
- coordinating metadata enrichment without blocking initial local rendering.

It does not own provider API details or download IPC implementation.

### Offline Detail Presentation

Provider-neutral movie and series presentation components consume a canonical
offline detail view model. They reuse existing shared detail-shell,
artwork/metadata, cast, and Material controls where practical. They emit only:

- back
- play local item
- reveal local item
- view in portal

### Metadata Adapter

A download metadata service owns:

- mapping current Xtream/Stalker detail data to the snapshot DTO;
- applying existing provider/TMDB merge helpers;
- choosing and merging series snapshots;
- validating and persisting renderer-generated snapshots through managed IPC;
- producing a view model that never adds provider-only episodes to the
  offline list.

Provider-specific lookup behavior stays in the corresponding portal
data-access/feature boundary.

### Portal Navigation

The existing `DownloadLibraryNavigationService` becomes the portal-handoff
service used only by `View in portal`. Ready-card clicks no longer call it.
The handoff carries the provider-only presentation flag and preserves the
current Stalker VOD-series identity rules.

## Data and IPC Changes

- Add nullable `metadata_snapshot` storage to the downloads schema and
  migrations.
- Extend download start payloads and download list rows with the validated
  snapshot type.
- Add a managed metadata-update IPC operation accepting a download id plus a
  bounded snapshot. The backend resolves ownership/group identity from the
  database rather than trusting renderer-supplied playlist or path values.
- Continue deriving file availability in the main process on every read.
- Do not persist availability into the snapshot or database status.

## File Availability and Errors

- A detail route whose row no longer exists shows a focused not-found state
  with Back to Downloads.
- A completed row whose file is missing redirects/replaces back to Download
  Manager, where the existing Needs attention recovery UI is authoritative.
- A Play race that returns `File not found` refreshes downloads and returns to
  the manager without advertising successful playback.
- `View in portal` is disabled with a clear explanation when the source
  playlist is gone or a reliable provider target cannot be resolved.
- Provider/TMDB failures never block local playback.
- Corrupt or oversized snapshots are ignored and never crash the detail view.

## Accessibility and Visual Rules

- Use existing Material and `--app-*`/Material system tokens; introduce no new
  global design tokens.
- Preserve light/dark theme behavior.
- The primary local Play and secondary `View in portal` have distinct labels,
  icons, and accessible names.
- Season tabs/chips and episode rows expose selected state, coordinates, and
  offline availability to assistive technology.
- Keyboard focus returns predictably on Back and remains visible throughout
  the detail surface.
- Reduced-motion preferences continue to disable nonessential transitions.

## Testing Strategy

### Unit and Integration

- route parsing hides the context panel only for a focused downloads item;
- movie and grouped-series card clicks navigate to offline detail;
- Back preserves manager scope, filter, search, and history;
- movie detail exposes local Play and no `Play from source`;
- series view contains only available downloaded seasons/episodes in natural
  order;
- missing files never enter the offline episode list;
- `View in portal` produces correct Xtream and all Stalker series-mode targets;
- provider-only handoff suppresses local/offline actions while preserving
  provider playback;
- snapshot validation, size limits, migrations, legacy fallback, language
  refresh, provider failure, TMDB disabled/enabled, and TMDB merge behavior;
- metadata backfill updates the correct managed movie or series group.

### Electron E2E

Extend the existing downloads E2E journey to prove:

- ready-card click opens a focused detail with no context panel;
- movie Play uses the finalized local file;
- series detail lists only downloaded episodes;
- `View in portal` restores provider/category context;
- a removed local file returns to Needs attention;
- legacy sparse metadata still renders and remains playable.

Use mock servers and original fixture artwork/metadata only.

### Manual Verification

Verify the built Electron app in light and dark themes, all three cover-size
settings on the manager, movie/series offline details, Stalker regular series
and VOD-series modes, provider handoff, and keyboard/focus behavior.

## Documentation and Release Notes

Update:

- `docs/architecture/download-manager.md`
- `docs/architecture/portal-detail-navigation.md`
- `docs/architecture/stalker-portal.md` if the Stalker handoff contract changes
- root living docs only if their described routes or subsystem contracts
  change
- the existing Download Manager release note under `.changes/`

## Alternatives Considered

### Reuse Provider Detail Directly

Rejected because it keeps provider catalog state, shows the category panel,
loads all provider episodes, and cannot guarantee an honest offline-only view.

### Show Full Seasons With Offline Badges

Rejected because unavailable episodes create visual noise, depend on a live
portal response, and leave playback provenance ambiguous.

### Put `View in portal` Only in Overflow

Rejected because the mode switch is important and should remain visible beside
the local Play action.

## Acceptance Criteria

- Downloaded movies and grouped series open a focused offline detail without a
  category panel.
- Offline movie Play and episode Play always target managed available local
  files.
- Offline series show only available downloaded episodes.
- Offline details reuse provider metadata and optional TMDB enrichment, then
  persist a safe snapshot for later offline use.
- For movies, `View in portal` sits beside `Play offline`; for series it remains
  visible in the hero above the episode list. It opens the provider detail with
  complete online context and no offline actions for that handoff.
- Missing files and missing sources degrade honestly without blocking other
  local content.
