# Season Download Queue Design

**Date:** 2026-08-01

**Status:** Approved design; awaiting written-spec review

**Scope:** Xtream and Stalker series details in the Electron application

## Summary

IPTVnator will let a user enqueue several episode downloads one after another
and enqueue every eligible episode in the currently selected season. The
existing Electron transfer model remains unchanged: one active transfer and a
FIFO queue behind it.

Download availability becomes episode-specific. A pending, queued,
downloading, paused, or locally available completed episode cannot be enqueued
again, while unrelated episodes remain actionable. Failed, canceled, and
completed-but-missing episodes are eligible for a fresh download. Season batch
processing is best-effort and reports how many episodes were added, skipped,
and failed.

The shared season UI owns presentation and interaction state. A
provider-neutral coordinator owns pending identities, eligibility, sequential
submission, and result aggregation. Xtream and Stalker adapters remain
responsible for producing provider-specific download requests. No batch IPC,
transfer concurrency, or database schema change is introduced.

## Context and Confirmed Findings

- `download-runtime.ts` already processes one active transfer at a time and
  appends other tasks to an in-memory FIFO queue.
- The downloads table already has a unique index on
  `(xtream_id, playlist_id, content_type)`, and the runtime also rejects a
  duplicate managed row id.
- `DownloadsService.downloads` is the renderer's authoritative global list and
  is refreshed through the existing download update broadcast.
- `SeasonContainerComponent` currently owns the episode download controls. It
  builds Xtream requests itself but emits an event for Stalker, which leaves
  the two providers with different orchestration paths.
- Stalker adapters already create a stable per-episode tracking id in
  `episode.id`. The current download path instead derives `xtreamId` from
  `originalId` or `originalCmd`; those playback fields can be shared by
  multiple episodes. That collision makes one managed download appear to own
  several episode buttons.
- The backend already allows `failed`, `canceled`, and `completed` rows to be
  restarted through `DOWNLOADS_START`. A completed row is eligible in this
  feature only when its derived `fileAvailability` is exactly `missing`.

The work starts from `760099358` (`feat(downloads): redesign download manager
(#1313)`) on a dedicated worktree and branch.

## Goals

1. Keep download blocking and pending state scoped to one episode identity.
2. Allow several individual episode Download actions to be accepted in quick
   succession.
3. Add `Download season (N)` for the currently selected, loaded season.
4. Make season enqueue idempotent across local pending state, authoritative
   renderer state, backend duplicate checks, and legacy Stalker identities.
5. Continue after per-episode errors and report `added`, `skipped`, and
   `failed` counts truthfully.
6. Preserve the existing FIFO transfer queue, destination authorization,
   partial-file, retry, and resume semantics.
7. Give Xtream and Stalker the same shared orchestration contract while
   keeping provider request construction in their respective feature areas.

## Non-goals

- Parallel transfers or configurable transfer concurrency.
- Full-series download across every season.
- Selecting or enqueueing several seasons in one action.
- Queue reordering or priority controls.
- Live recording.
- Bulk pause, resume, cancel, retry, or removal.
- A visual redesign of series details, episode cards, or the download manager.
- A new batch IPC endpoint.

## Architecture and Ownership

### Shared season presentation

`SeasonContainerComponent` remains the reusable UI owner for season selection,
episode rows/cards, and download controls. It will no longer construct an
Xtream URL or branch on Stalker markers. Instead it receives a typed
provider adapter through a signal input.

The component is responsible for:

- rendering `Download season (N)` in the existing section header;
- projecting coordinator state into individual episode buttons;
- snapshotting the selected season's visible episode order on batch click;
- invoking the coordinator for one episode or a season snapshot;
- showing a localized aggregate snackbar after batch completion.

The provider adapter contract returns a candidate for an episode. A candidate
contains a canonical episode identity and an async request factory. The
factory may resolve immediately for Xtream or perform Stalker link resolution
before returning `DownloadStartInput`.

Conceptually:

```ts
interface EpisodeDownloadIdentity {
    playlistId: string;
    xtreamId: number;
    contentType: 'episode';
    seriesXtreamId: number;
    seasonNumber: number;
    episodeNumber: number;
}

interface EpisodeDownloadCandidate {
    identity: EpisodeDownloadIdentity;
    prepare: () => Promise<DownloadStartInput>;
}

interface SeasonEpisodeDownloadAdapter {
    createCandidate(
        episode: XtreamSerieEpisode,
        fallbackSeasonKey: string | undefined
    ): EpisodeDownloadCandidate | null;
}
```

The exact exported names may follow existing repository naming conventions,
but the boundary and responsibilities are fixed by this design.

### Provider-neutral orchestration

A coordinator in `libs/portal/shared/data-access` injects the existing
`DownloadsService`. This location owns provider-neutral stateful orchestration
under the repository's Nx placement rules.

The coordinator owns:

- a signal-backed set of pending episode identity keys;
- pure eligibility evaluation against the global download list;
- synchronous reservation of every eligible batch identity before the first
  asynchronous request begins;
- sequential invocation of each candidate's request factory and
  `DownloadsService.startDownload()`;
- best-effort continuation and aggregate result counts;
- an authoritative list refresh before successful pending state is released.

Pure identity matching and eligibility helpers belong in
`libs/portal/shared/util`. Reusable visual work stays in
`libs/ui/components`. No new project or boundary exception is required.

### Provider adapters

Xtream request construction moves out of the shared season component and next
to `SerialDetailsComponent`. It continues to use the loaded playlist
credentials, series metadata, episode extension, and metadata snapshot.

Stalker request construction moves out of the component method into a focused
adapter next to `StalkerSeriesViewComponent`. It continues to use
`fetchLinkToPlay`, portal headers, the current playlist, and the existing
metadata snapshot builder.

Both adapters use the already-normalized `episode.id` as the canonical
`xtreamId`. Stalker `originalId` and `originalCmd` remain inputs to provider
link resolution only and never determine download ownership.

### Electron backend compatibility guard

The backend keeps the current `DOWNLOADS_START` handler and transfer runtime.
The existing-row lookup gains a compatibility fallback for episode requests
that contain safe integer series, season, and episode coordinates:

1. Look up the canonical `(playlistId, xtreamId, contentType)` identity.
2. Look up an episode row with the same
   `(playlistId, contentType, seriesXtreamId, seasonNumber, episodeNumber)`.
3. Use the one row found, or the same row when both lookups agree.
4. If the lookups resolve to different rows, or a canonical row carries
   conflicting complete episode coordinates, fail closed as an identity
   conflict without mutating either row.
5. Apply the existing status rules to the matched row.
6. When an eligible coordinate-matched legacy row is restarted, update its
   `xtreamId` to the canonical value as part of the existing queued reset.

The fallback does not run for VOD rows or coordinate-incomplete legacy rows.
It does not merge or delete ambiguous data. A uniqueness conflict fails closed
without enqueueing a second runtime task.

The existing start result gains an optional machine-readable
`already-in-progress` reason for a queued, downloading, or paused match. The
human-readable error remains for compatibility. The coordinator uses the
reason rather than comparing localized or free-form error strings, so a stale
renderer snapshot is counted as `skipped`. This extends the current result
contract without adding an IPC method.

This is a duplicate-ownership compatibility fix, not a schema migration. The
unique index, download destination authorization, partial ownership, and
single-transfer queue remain unchanged.

## Eligibility and Identity Rules

An episode identity is matched against a download row by canonical identity,
then by the legacy episode coordinates described above. Matching includes the
playlist, so identical provider ids in different sources never share state.

Eligibility is evaluated as follows:

| State                     | Season batch | Individual episode action       |
| ------------------------- | ------------ | ------------------------------- |
| Local pending             | Skip         | Disabled                        |
| `queued`                  | Skip         | Disabled                        |
| `downloading`             | Skip         | Disabled                        |
| `paused`                  | Skip         | Show existing Resume action     |
| `completed` + `available` | Skip         | Show existing Play local action |
| `completed` + `missing`   | Eligible     | Show Download again action      |
| `failed`                  | Eligible     | Show Download action            |
| `canceled`                | Eligible     | Show Download action            |
| No row                    | Eligible     | Show Download action            |

For safety, a completed row whose file availability is not yet known is
treated as blocked, not as missing. Season batch is disabled until the first
authoritative download-list load has completed. Later background refreshes do
not globally disable unrelated episode controls.

If the provider adapter cannot produce a valid candidate for an otherwise
visible episode, the episode is not included in the eligible count and is
counted as `skipped` when a batch with other eligible episodes runs. An
operation that creates a candidate but fails during provider preparation is
counted as `failed`.

## UX Specification

### Season action

The visible text button `Download season (N)` appears in the season section
header immediately before the existing Grid/List toggle. It is present only
when all of the following are true:

- the runtime supports downloads;
- download presentation is enabled for the current detail view;
- a provider adapter is available.

It is absent in the Web application and provider-only details. It is disabled
when the selected season is loading, empty, has zero eligible episodes, the
initial download list is not ready, or a season batch is already running in
that component.

`N` is the current eligible count for the selected season. It excludes every
item that would be skipped at click time. During execution the button shows a
spinner and `Adding to queue…`. The clicked season key and episode array are
snapshotted, so changing tabs does not alter the in-flight batch.

Only one season batch is initiated by a season component at a time. Individual
actions for unrelated episodes remain available and may be accepted while a
batch prepares Stalker links. The Electron backend's actual receive order
remains the FIFO order; no renderer-side transfer scheduler is added.

### Per-episode controls

The coordinator reserves an episode identity synchronously before awaiting
provider or IPC work. The corresponding Download button immediately becomes a
non-actionable pending/downloading presentation. Every unrelated episode keeps
its own state and remains clickable.

The same coordinator path handles single-item and season actions, preventing
different pending or error behavior between them. A failed operation releases
only that episode's pending key. A successful operation keeps its key pending
until the global list has been refreshed, avoiding a re-enabled gap between
the IPC acknowledgement and the authoritative queued row.

An individual success relies on the visible queued/downloading state and does
not add a redundant snackbar. An individual provider or start failure shows a
generic localized download-failed snackbar; raw backend or provider text is
not displayed.

Existing Resume and Play local actions remain unchanged. The grid and list
views expose equivalent states and actions.

### Result feedback

After every season batch, one Material snackbar announces:

- `Added N · Skipped M` when `failed` is zero;
- `Added N · Skipped M · Failed K` when at least one candidate fails.

The three counts partition every episode in the snapshotted selected season:

- `added`: `DOWNLOADS_START` accepted the item;
- `skipped`: the item had no valid provider candidate, was already blocked
  locally or authoritatively, or the backend returned the stable
  `already-in-progress` reason;
- `failed`: provider preparation, URL resolution, authorization, or IPC failed.

Processing never stops at the first failure. No raw URL, credential, backend
message, or exception text is rendered in the snackbar. Technical diagnostics
use the existing redacted logger.

## Data Flow

### Individual episode

1. The season component asks the adapter for a candidate.
2. The coordinator evaluates current eligibility and reserves its identity.
3. The adapter prepares the provider-specific request.
4. `DownloadsService.startDownload()` obtains the current authorized folder
   and invokes the existing bridge method.
5. The main process validates the folder and remote URL, resolves canonical or
   legacy ownership, persists `queued`, and calls the existing
   `enqueueDownload()`.
6. The renderer refreshes the global list and hands UI ownership from pending
   state to the authoritative row.

### Selected season

1. The component snapshots the selected season and asks the adapter for
   candidates in the displayed episode order.
2. The coordinator classifies the full snapshot and reserves every eligible
   identity before awaiting work.
3. Invalid candidates and already-blocked items are counted without invoking
   provider preparation.
4. Eligible candidates are prepared and submitted one at a time in snapshot
   order.
5. A preparation or start failure increments `failed`, releases that identity,
   and processing continues.
6. The global list is refreshed after processing. Successful pending keys are
   released only after that refresh attempt.
7. The component shows one aggregate snackbar and recomputes `N` from the new
   authoritative state.

The coordinator does not mutate `DownloadsService.downloads` optimistically.
The existing Electron broadcast remains authoritative, with an explicit final
refresh closing the acknowledgement-to-list timing gap.

## Error and Race Semantics

- Two rapid clicks for the same episode race only against the synchronous
  pending reservation; the second is skipped without calling the provider.
- Separate episode clicks reserve separate keys and both reach the existing
  backend queue.
- Repeating `Download season` after completion skips rows now reported as
  queued, downloading, paused, or available completed.
- A backend `already-in-progress` response caused by a stale renderer snapshot
  counts as skipped rather than failed.
- Stalker link resolution failures affect only their candidate.
- A missing or unauthorized download folder produces failed results through
  the current service/backend path; destination selection is not bypassed.
- A failed row with a retained partial follows today's `DOWNLOADS_START`
  restart behavior, including its existing safe partial cleanup.
- A paused row is never restarted by the season action, preserving Resume and
  retained-partial semantics.
- A missing completed row follows today's detail-page fresh-download behavior
  and targets the currently authorized download folder.
- If the final renderer refresh fails, pending state is released after the
  attempt so controls cannot become permanently stuck. The backend uniqueness
  and runtime-id guards remain the final duplicate defense.

## Accessibility, Responsive Layout, and Themes

- The season action uses a real Material button with visible localized text,
  a keyboard focus indicator, and an accessible name that includes the
  eligible count.
- The progress spinner is decorative; the visible `Adding to queue…` text
  communicates the state without relying on animation or color.
- Disabled controls retain the existing native/Material disabled semantics.
- Material snackbar supplies its existing live-region announcement for the
  aggregate result.
- The section header may wrap at narrow widths rather than clipping the label
  or shrinking the touch target.
- Styling reuses existing `--app-*` and Material system tokens. Light and dark
  themes must preserve contrast, hover, focus, pending, and disabled states.
- Grid and list presentations must expose the same action names and state
  semantics.

## Test Strategy

Implementation follows test-driven development. Regression tests are written
and observed failing before production changes for each behavior slice.

### Pure and service tests

- Canonical identity and legacy coordinate matching.
- Unique Stalker identities when episodes share `originalId` or
  `originalCmd`.
- Eligibility for every download status and completed file-availability value.
- Unknown completed availability fails closed.
- Per-item pending reservation and release.
- Two rapid requests for one identity dispatch once.
- Requests for distinct identities both dispatch.
- Batch order, deduplication, skip counts, missing-completed behavior, and
  best-effort continuation.
- Provider preparation and IPC failures produce `failed` without aborting the
  batch.
- Invalid provider candidates contribute to `skipped`, so the three result
  counts always total the snapshotted season size.
- A stale backend duplicate is classified as `skipped`.
- Final authoritative refresh and pending handoff behavior.

### Component and provider tests

- `Download season (N)` visibility, count, loading, empty, initial-load, and
  zero-eligible states.
- Batch pending presentation and per-episode isolation in both grid and list.
- Web and provider-only views omit download presentation.
- Accessible names and native disabled state.
- Xtream URL, title, identity, coordinates, poster, and metadata snapshot.
- Stalker link resolution, headers, metadata, canonical identity, and isolated
  error handling.
- The regression test demonstrates that two Stalker episodes sharing playback
  identifiers no longer share download state.

### Backend tests

- Canonical exact-match behavior remains unchanged.
- A coordinate-matched legacy active row is rejected as already in progress.
- Queued, downloading, and paused duplicate results carry the stable
  `already-in-progress` reason.
- Eligible legacy failed, canceled, and completed rows are reused and upgraded
  to the canonical id.
- Coordinate fallback does not apply to VOD or incomplete episode requests.
- A uniqueness conflict fails without mutating or enqueueing another task.
- Existing destination authorization and runtime FIFO tests stay green.

### Electron E2E and manual verification

Extend the closest existing Electron series/download coverage to prove:

- two consecutive episode clicks produce one downloading and one queued row;
- `Download season` submits eligible episodes in display order;
- a repeated action does not create duplicate managed rows;
- the aggregate snackbar shows correct counts;
- only one transfer is active at a time.

Use the existing Xtream mock flow for the complete UI-to-queue journey. Add a
Stalker UI E2E when the existing deterministic mock exposes downloadable
episode streams without expanding fixture scope; otherwise retain Stalker
collision coverage at adapter, component, and backend integration levels and
record that reason in the final summary.

Web E2E does not require a new download workflow because the feature is
Electron-only. Component coverage explicitly verifies that Web does not render
the action.

Perform CDP/manual checks in light and dark themes at desktop and narrow
content widths, including keyboard focus, button names, disabled states, and
snackbar announcement text.

## Documentation and Release Note

Implementation updates:

- `docs/architecture/download-manager.md` with season orchestration, canonical
  episode identity, legacy Stalker compatibility, and per-item pending rules;
- the relevant Download Manager description in `CLAUDE.md` so repository
  bootstrap guidance remains current;
- one user-facing `.changes/downloads-<short-slug>.md` feature note following
  `.changes/README.md`.

Translation keys for the season action, in-progress label, accessible name,
and aggregate result are added to every locale file using the repository's
current localization convention.

## Validation

The implementation plan must name exact targets after Nx discovery. The
expected validation ladder is:

1. focused tests for shared util/data-access, `components`, Xtream feature,
   Stalker feature, `services`, and Electron backend;
2. full affected-project tests;
3. affected-project lint;
4. the atomized Electron E2E target covering the new series download flow;
5. `pnpm run release:notes:validate`;
6. light/dark and keyboard/CDP verification.

The fresh-worktree baseline already passes the nearest existing suites:

- `components`: 128 tests;
- `portal-xtream-feature` serial details: 14 tests;
- `portal-stalker-feature` series view: 16 tests;
- `services` downloads: 21 tests;
- Electron backend download requests: 20 tests.

## Acceptance Criteria

1. Starting one episode immediately blocks only that episode's Download
   action; a different episode can be clicked and enqueued before the first
   transfer completes.
2. The backend runs one transfer and preserves FIFO ordering for queued tasks.
3. `Download season (N)` applies only to the selected loaded season and uses
   the displayed episode order.
4. Pending, queued, downloading, paused, and available completed episodes are
   skipped without duplicate provider or IPC work.
5. Failed, canceled, and missing-completed episodes are eligible.
6. Batch failures do not stop later episodes and the final counts partition
   the entire snapshotted season truthfully.
7. Xtream and Stalker use the same shared orchestration path while retaining
   provider-specific request preparation.
8. Stalker episodes with shared playback identifiers have independent
   canonical download identities.
9. Legacy Stalker download rows remain recognized by episode coordinates and
   are reused rather than duplicated when eligible.
10. The season action is absent from Web and provider-only details.
11. Grid/List, light/dark, keyboard focus, and accessible names remain usable.
12. No batch IPC, transfer concurrency, queue reordering, full-series action,
    or multi-season selection is introduced.
