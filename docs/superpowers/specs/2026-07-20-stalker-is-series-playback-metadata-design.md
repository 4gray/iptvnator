# Stalker `is_series` Playback Metadata Design

## Context

Some Stalker/Ministra portals expose series inside the VOD catalog by setting
`is_series=1`. IPTVnator already normalizes this provider-specific shape and
loads its seasons and episodes lazily, but two cross-surface contracts are
incomplete:

1. The Stalker quick-start button renders `XTREAM.PLAY_EPISODE` without the
   translation parameters supplied by the shared series quick-start action.
   The result is a visible `{{episode}}` placeholder.
2. Stalker episode playback does not add `seasonNumber` and `episodeNumber` to
   `ResolvedPortalPlayback.contentInfo`. Playback positions therefore lack the
   metadata used by the workspace dashboard hero and Continue Watching cards
   to render their season/episode badge.

The dashboard already classifies raw Stalker records carrying `is_series` as
series activity. No new dashboard-specific content-type branch is required.

## Goals

- Render parameterized Stalker quick-start translations correctly.
- Persist season and episode numbers for future Stalker episode playback,
  including VOD-backed `is_series` series.
- Let the existing dashboard position lookup and badge rendering consume that
  metadata without provider-specific duplication.
- Document `is_series` as a cross-surface compatibility contract so future
  changes cover detail rendering, activity persistence, playback metadata, and
  dashboard presentation together.

## Non-goals

- Migrating or reconstructing existing playback-position rows that do not
  contain season/episode metadata.
- Loading Stalker catalog data from the dashboard to infer missing metadata.
- Changing Stalker season-loading behavior, episode ordering, tracking IDs, or
  playback URLs.
- Redesigning the detail-page or dashboard UI.

## Design

### Quick-start translation

`StalkerQuickStartButton` will expose the optional `labelParams` already
provided by `SeriesQuickStartAction`. For loaded episode actions, the Stalker
adapter will copy those parameters into its button view model. Lazy-season
actions will leave the field undefined because their label keys do not require
an episode parameter.

The Stalker series template will call the translate pipe with
`action.labelParams`, matching the established Xtream series template. This
keeps translation-key selection in the shared quick-start utility and keeps
template behavior consistent across providers.

### Playback metadata

`StalkerSeriesViewComponent` already maps all three supported series shapes to
`Record<string, XtreamSerieEpisode[]>`:

- regular Stalker series;
- VOD with an embedded `series[]`;
- VOD with `is_series=1`.

When an episode is selected, the component will use the mapped episode identity
to resolve its normalized season and episode numbers. After
`StalkerStore.resolveVodPlayback(...)` returns, the component will enrich the
episode `contentInfo` with those two fields before handing the playback object
to either the inline player or an external player.

If no mapped episode state can be resolved, the component will preserve the
existing playback object unchanged. Missing metadata must never block
playback.

This placement avoids expanding the positional `resolveVodPlayback(...)`
contract and ensures both inline and external playback receive the same
metadata. Subsequent playback-position writes will therefore carry:

```text
playlistId
contentXtreamId
contentType = episode
seriesXtreamId
seasonNumber
episodeNumber
```

### Dashboard behavior

No new dashboard branching will be introduced. Existing behavior remains:

1. `extractStalkerItemType(...)` normalizes `is_series` activity to `series`.
2. `DashboardDataService` finds the newest episode position by
   `seriesXtreamId`.
3. The dashboard hero and Continue Watching cards render the season/episode
   badge when both metadata fields are present.

Existing positions without these fields will remain badge-less until the user
plays an episode again and a new position is saved.

## Tests

Regression coverage will be added before production changes:

1. Stalker series quick-start view-model/component coverage will demonstrate
   that a parameterized `PLAY_EPISODE` action carries and renders the episode
   number instead of `{{episode}}`.
2. Stalker `is_series` component coverage will demonstrate that resolved
   playback contains the mapped season and episode numbers.
3. Dashboard coverage will use a Stalker `is_series` recent item plus an
   episode playback position and assert that the hero exposes the expected
   season/episode badge.

Targeted Nx tests will run for the affected Stalker feature and workspace
dashboard projects. Broader validation will be selected after checking the
available project targets.

## Documentation

The implementation will update:

- `docs/architecture/stalker-portal.md` with the activity/playback/dashboard
  contract for all three series modes;
- `docs/architecture/workspace-dashboard.md` with Stalker episode-position
  badge behavior and the forward-only limitation;
- `.codex/skills/stalker-portal/SKILL.md` with a cross-surface `is_series`
  checklist for future agents.

## Compatibility and failure handling

- Raw `true`, `1`, and `"1"` `is_series` forms continue to normalize through
  existing Stalker helpers.
- Existing series tracking IDs and saved positions remain valid.
- Playback remains functional when season/episode metadata cannot be derived.
- Old position rows are read unchanged and are not rewritten speculatively.
