# Download Manager Offline Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add metadata-rich, full-width offline movie and series details to Download Manager, with local-only playback and an explicit handoff to the normal provider detail.

**Architecture:** Persist a validated provider-neutral metadata snapshot on managed download rows, then render a dedicated Download Manager detail route from that local snapshot and the authoritative list of available files. A renderer metadata resolver reuses current provider records and `TmdbEnrichmentService` for best-effort enrichment/backfill. The existing provider navigation remains separate and gains a scoped provider-only presentation flag for `View in portal`.

**Tech Stack:** Angular 20 standalone components and signals, Nx/Jest, Electron IPC, Drizzle/SQLite, Angular Material 3, ngx-translate, Playwright Electron E2E.

---

## File Map

### Shared contracts and persistence

- Create `libs/shared/interfaces/src/lib/download-metadata.interface.ts` — bounded versioned snapshot DTO.
- Modify `libs/shared/interfaces/src/index.ts` — export the snapshot DTO.
- Modify `libs/shared/interfaces/src/lib/electron-api.interface.ts` — add snapshot fields and managed update IPC.
- Modify `libs/shared/database/src/lib/schema.ts` — add nullable `metadataSnapshot` column.
- Modify `libs/shared/database/src/lib/connection.ts` — create/migrate the SQLite column.
- Modify `libs/shared/database/src/lib/connection.spec.ts` — migration and rebuild regression coverage.

### Electron download boundary

- Create `apps/electron-backend/src/app/events/database/download-metadata-snapshot.ts` — validate, bound, encode, and decode snapshots.
- Create `apps/electron-backend/src/app/events/database/download-metadata-snapshot.spec.ts` — malformed/oversized/credential-key cases.
- Modify `apps/electron-backend/src/app/events/database/download-requests.ts` — persist snapshot on start/restart.
- Modify `apps/electron-backend/src/app/events/database/download-file-availability.ts` — decode snapshots while decorating rows.
- Modify `apps/electron-backend/src/app/events/database/downloads.events.ts` — managed group metadata update handler.
- Modify `apps/electron-backend/src/app/events/database/downloads-file-availability.events.spec.ts` — row decoding coverage.
- Create `apps/electron-backend/src/app/events/database/download-metadata.events.spec.ts` — managed update and series-group coverage.
- Modify `apps/electron-backend/src/app/api/main.preload.ts` — expose update IPC.
- Modify `apps/electron-backend/src/app/api/main.preload.spec.ts` — bridge argument coverage.

### Renderer download model and metadata

- Modify `libs/services/src/lib/downloads.models.ts` — expose `metadataSnapshot`.
- Modify `libs/services/src/lib/downloads.service.ts` — start/update/get helpers.
- Modify `libs/services/src/lib/downloads.service.spec.ts` — update and snapshot pass-through tests.
- Create `libs/portal/downloads/feature/src/lib/offline-detail/download-offline-detail.viewmodel.ts` — pure movie/series offline view model.
- Create `libs/portal/downloads/feature/src/lib/offline-detail/download-offline-detail.viewmodel.spec.ts` — grouping, ordering, missing-file exclusion.
- Create `libs/portal/downloads/feature/src/lib/offline-detail/download-metadata.mapper.ts` — provider/TMDB-to-snapshot mapping and safe merge.
- Create `libs/portal/downloads/feature/src/lib/offline-detail/download-metadata.mapper.spec.ts` — field precedence and bounds.
- Create `libs/portal/downloads/feature/src/lib/offline-detail/download-offline-metadata.service.ts` — snapshot/provider/TMDB resolution and backfill.
- Create `libs/portal/downloads/feature/src/lib/offline-detail/download-offline-metadata.service.spec.ts` — disabled/enabled TMDB and failure fallbacks.
- Create `libs/portal/shared/util/src/lib/downloads/download-metadata-snapshot.ts` — provider-neutral snapshot factories shared by download callers and offline backfill.
- Create `libs/portal/shared/util/src/lib/downloads/download-metadata-snapshot.spec.ts` — snapshot factory coverage.
- Modify `libs/portal/shared/util/src/index.ts` — export snapshot factories.

### Offline detail UI and navigation

- Create `libs/portal/downloads/feature/src/lib/offline-detail/download-offline-detail.component.ts`
- Create `libs/portal/downloads/feature/src/lib/offline-detail/download-offline-detail.component.html`
- Create `libs/portal/downloads/feature/src/lib/offline-detail/download-offline-detail.component.scss`
- Create `libs/portal/downloads/feature/src/lib/offline-detail/download-offline-detail.component.spec.ts`
- Modify `libs/portal/downloads/feature/src/index.ts` — export the route component.
- Modify `libs/portal/downloads/feature/src/lib/downloads.component.ts` — card clicks enter offline detail.
- Modify `libs/portal/downloads/feature/src/lib/downloads.component.html` — remove source-availability gating from offline opens.
- Modify `libs/portal/downloads/feature/src/lib/download-library.component.ts`
- Modify `libs/portal/downloads/feature/src/lib/download-library.component.html`
- Modify `libs/portal/downloads/feature/src/lib/download-library.component.spec.ts`
- Modify `libs/portal/downloads/feature/src/lib/download-library-navigation.service.ts` — retain only provider handoff responsibility.
- Modify `libs/portal/downloads/feature/src/lib/download-library-navigation.service.spec.ts`
- Modify `apps/web/src/app/app.routes.ts` — top-level focused detail route.
- Modify `libs/portal/xtream/feature/src/lib/xtream-feature.routes.ts` — scoped focused detail route.
- Modify `libs/portal/stalker/feature/src/lib/stalker-feature.routes.ts` — scoped focused detail route.
- Modify `libs/workspace/shell/util/src/lib/navigation/workspace-shell-route.utils.ts` — hide context/search for focused download detail.
- Modify `libs/workspace/shell/util/src/lib/navigation/workspace-shell-route.utils.spec.ts`

### Provider-only handoff

- Create `libs/portal/shared/util/src/lib/navigation/provider-detail-mode.ts` — navigation-state contract.
- Modify `libs/portal/shared/util/src/index.ts` — export contract.
- Modify `libs/portal/xtream/feature/src/lib/vod-details/vod-details-route.component.ts`
- Modify `libs/portal/xtream/feature/src/lib/vod-details/vod-details-route.component.html`
- Modify `libs/portal/xtream/feature/src/lib/vod-details/vod-details-route.actions.spec.ts`
- Modify `libs/portal/xtream/feature/src/lib/serial-details/serial-details.component.ts`
- Modify `libs/portal/xtream/feature/src/lib/serial-details/serial-details.component.html`
- Modify `libs/portal/xtream/feature/src/lib/serial-details/serial-details.component.spec.ts`
- Modify `libs/portal/stalker/feature/src/lib/stalker-catalog-detail/stalker-catalog-detail.component.ts`
- Create `libs/portal/stalker/feature/src/lib/stalker-catalog-detail/stalker-catalog-detail.component.spec.ts`
- Modify `libs/portal/stalker/feature/src/lib/stalker-inline-detail/stalker-inline-detail.component.ts`
- Create `libs/portal/stalker/feature/src/lib/stalker-inline-detail/stalker-inline-detail.component.spec.ts`
- Modify `libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-view.component.ts`
- Modify `libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-view.component.html`
- Modify `libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-view.component.spec.ts`
- Modify `libs/ui/playback/src/lib/vod-details/vod-details.component.ts`
- Modify `libs/ui/playback/src/lib/vod-details/vod-details.component.html`
- Modify `libs/ui/playback/src/lib/vod-details/vod-details.component.spec.ts`

### Start-time snapshots, translations, docs, and E2E

- Modify `libs/portal/xtream/feature/src/lib/vod-details/vod-details-downloads.service.ts`
- Modify `libs/portal/xtream/feature/src/lib/vod-details/vod-details-route-playback.spec.ts`
- Modify `libs/portal/stalker/feature/src/lib/stalker-catalog-detail/stalker-vod-download.ts`
- Create `libs/portal/stalker/feature/src/lib/stalker-catalog-detail/stalker-vod-download.spec.ts`
- Modify `libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-view.component.ts`
- Modify `libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-view.component.spec.ts`
- Modify all `apps/web/src/assets/i18n/*.json` locale files with English fallback and localized Russian text.
- Modify `apps/electron-backend-e2e/src/downloads.e2e.ts`
- Modify `docs/architecture/download-manager.md`
- Modify `docs/architecture/portal-detail-navigation.md`
- Modify `docs/architecture/stalker-portal.md`
- Modify `CLAUDE.md`
- Modify `.changes/downloads-manager-mvp.md`

---

### Task 1: Define and Persist the Metadata Snapshot Contract

**Files:**

- Create: `libs/shared/interfaces/src/lib/download-metadata.interface.ts`
- Modify: `libs/shared/interfaces/src/index.ts`
- Modify: `libs/shared/interfaces/src/lib/electron-api.interface.ts`
- Modify: `libs/shared/database/src/lib/schema.ts`
- Modify: `libs/shared/database/src/lib/connection.ts`
- Test: `libs/shared/database/src/lib/connection.spec.ts`

- [ ] **Step 1: Write the failing database migration tests**

Add assertions that new databases and upgraded databases expose
`metadata_snapshot`, while the pause/resume rebuild preserves the column:

```ts
expect(downloadColumns).toContain('metadata_snapshot');
expect(__databaseConnectionTestHooks.columnMigrationStatements).toContain(
    'ALTER TABLE downloads ADD COLUMN metadata_snapshot TEXT'
);
```

Extend the rebuild fixture with a JSON value and assert it survives when the
legacy table already has the column.

- [ ] **Step 2: Run the database test and verify it fails**

Run:

```bash
pnpm nx test database --runInBand
```

Expected: FAIL because `metadata_snapshot` is absent from the Drizzle schema,
create SQL, and migration statements.

- [ ] **Step 3: Add the snapshot DTO and bridge fields**

Create the complete provider-neutral contract:

```ts
export interface DownloadMetadataPerson {
    tmdbPersonId?: number;
    name: string;
    role?: string;
    profileUrl?: string;
}

export interface DownloadEpisodeMetadata {
    title?: string;
    plot?: string;
    stillUrl?: string;
    seasonNumber: number;
    episodeNumber: number;
}

export interface DownloadMetadataSnapshot {
    version: 1;
    language: string;
    mediaKind: 'movie' | 'series';
    title: string;
    originalTitle?: string;
    plot?: string;
    releaseDate?: string;
    year?: number;
    durationMinutes?: number;
    genres?: string[];
    rating?: number;
    status?: string;
    posterUrl?: string;
    backdropUrl?: string;
    tmdbId?: number;
    providerCategoryId?: string;
    cast?: DownloadMetadataPerson[];
    creators?: DownloadMetadataPerson[];
    episode?: DownloadEpisodeMetadata;
    enrichedAt?: string;
}
```

Export it and add `metadataSnapshot?: DownloadMetadataSnapshot` to
`ElectronBridgeDownloadStartPayload` and `ElectronDownloadItem`. Add this API
method:

```ts
downloadsUpdateMetadata: (
    downloadId: number,
    metadataSnapshot: DownloadMetadataSnapshot
) => Promise<ElectronBridgeErrorResult>;
```

- [ ] **Step 4: Add the nullable SQLite column**

Add `metadataSnapshot: text('metadata_snapshot')` to the Drizzle table, add the
column to `DOWNLOADS_TABLE_SQL`, and append:

```ts
`ALTER TABLE downloads ADD COLUMN metadata_snapshot TEXT`;
```

to `COLUMN_MIGRATION_STATEMENTS`. Preserve `metadata_snapshot` in the
pause/resume rebuild by detecting the column and selecting either
`metadata_snapshot` or `NULL AS metadata_snapshot`.

- [ ] **Step 5: Run the database and interface checks**

Run:

```bash
pnpm nx test database --runInBand
pnpm nx lint database
pnpm nx test shared-interfaces --runInBand
```

Expected: all targets pass and no new lint errors are reported.

- [ ] **Step 6: Commit the contract**

```bash
git add libs/shared/interfaces libs/shared/database
git commit -m "feat(downloads): persist offline metadata snapshots"
```

---

### Task 2: Validate Snapshots and Add Managed Metadata IPC

**Files:**

- Create: `apps/electron-backend/src/app/events/database/download-metadata-snapshot.ts`
- Create: `apps/electron-backend/src/app/events/database/download-metadata-snapshot.spec.ts`
- Create: `apps/electron-backend/src/app/events/database/download-metadata.events.spec.ts`
- Modify: `apps/electron-backend/src/app/events/database/download-requests.ts`
- Modify: `apps/electron-backend/src/app/events/database/download-file-availability.ts`
- Modify: `apps/electron-backend/src/app/events/database/downloads.events.ts`
- Modify: `apps/electron-backend/src/app/events/database/downloads-file-availability.events.spec.ts`
- Modify: `apps/electron-backend/src/app/api/main.preload.ts`
- Modify: `apps/electron-backend/src/app/api/main.preload.spec.ts`

- [ ] **Step 1: Write failing validation tests**

Cover a valid snapshot, invalid version, empty title, more than 30 cast members,
oversized JSON, and forbidden nested keys such as `url`, `headers`, `password`,
`macAddress`, and `cookie`:

```ts
expect(encodeDownloadMetadataSnapshot(validSnapshot)).toBe(
    JSON.stringify(validSnapshot)
);
expect(() =>
    encodeDownloadMetadataSnapshot({
        ...validSnapshot,
        password: 'secret',
    } as never)
).toThrow('Invalid download metadata snapshot');
```

Use a fixed UTF-8 ceiling of `128 * 1024` bytes.

- [ ] **Step 2: Write failing IPC tests**

Register the downloads event module with the existing database test harness and
assert:

```ts
await expect(
    getHandler('DOWNLOADS_UPDATE_METADATA')(null, row.id, snapshot)
).resolves.toEqual({ success: true });
expect(updateWhere).toHaveBeenCalled();
```

For an episode, assert the update predicate is derived from the stored
`playlistId`, `seriesXtreamId`, and `contentType`, updating the whole managed
series group. Give the group distinct stored episode snapshots and assert the
parent fields update while every row keeps its own episode title/coordinate.
Assert a movie updates only its managed id. Assert a missing id, invalid
snapshot, or unsafe payload returns `{ success: false }`.

- [ ] **Step 3: Run Electron backend tests and verify failure**

Run:

```bash
pnpm nx test electron-backend --runInBand
```

Expected: FAIL because the validator and `DOWNLOADS_UPDATE_METADATA` do not
exist.

- [ ] **Step 4: Implement the bounded validator**

Implement an allowlist-based clone rather than persisting arbitrary input:

```ts
export const DOWNLOAD_METADATA_MAX_BYTES = 128 * 1024;

export function encodeDownloadMetadataSnapshot(
    input: DownloadMetadataSnapshot
): string {
    const snapshot = normalizeDownloadMetadataSnapshot(input);
    const encoded = JSON.stringify(snapshot);
    if (Buffer.byteLength(encoded, 'utf8') > DOWNLOAD_METADATA_MAX_BYTES) {
        throw new Error('Download metadata snapshot is too large');
    }
    return encoded;
}

export function decodeDownloadMetadataSnapshot(
    value: string | null | undefined
): DownloadMetadataSnapshot | undefined {
    if (!value) return undefined;
    try {
        return normalizeDownloadMetadataSnapshot(JSON.parse(value));
    } catch {
        return undefined;
    }
}
```

The normalizer keeps only defined DTO fields, trims strings, caps people arrays
at 30 and genre arrays at 20, and rejects unknown credential-bearing keys
before cloning.

- [ ] **Step 5: Persist and decode snapshots**

In `startDownloadRequest`, encode the optional start payload and write it on
insert. On restart, replace the stored snapshot only when a new valid snapshot
is supplied.

Decode the Drizzle string in `decorateDownloadItem`:

```ts
return {
    ...row,
    metadataSnapshot: decodeDownloadMetadataSnapshot(row.metadataSnapshot),
    fileAvailability: getDownloadFileAvailability(row, lstat),
};
```

Remove the raw JSON string from the object returned to the renderer.

- [ ] **Step 6: Implement managed group update**

Register:

```ts
ipcMain.handle(
    'DOWNLOADS_UPDATE_METADATA',
    async (_event, downloadId: number, snapshot: DownloadMetadataSnapshot) => {
        const encoded = encodeDownloadMetadataSnapshot(snapshot);
        const [row] = await db
            .select()
            .from(schema.downloads)
            .where(eq(schema.downloads.id, downloadId))
            .limit(1);
        if (!row) return { error: 'Download not found', success: false };

        if (row.contentType !== 'episode' || !row.seriesXtreamId) {
            await db
                .update(schema.downloads)
                .set({
                    metadataSnapshot: encoded,
                    updatedAt: sql`CURRENT_TIMESTAMP`,
                })
                .where(eq(schema.downloads.id, downloadId));
            return { success: true };
        }

        const members = await db
            .select()
            .from(schema.downloads)
            .where(
                and(
                    eq(schema.downloads.playlistId, row.playlistId),
                    eq(schema.downloads.contentType, 'episode'),
                    eq(schema.downloads.seriesXtreamId, row.seriesXtreamId)
                )
            );
        for (const member of members) {
            const current = decodeDownloadMetadataSnapshot(
                member.metadataSnapshot
            );
            const memberSnapshot = {
                ...snapshot,
                episode:
                    current?.episode ??
                    (member.seasonNumber && member.episodeNumber
                        ? {
                              episodeNumber: member.episodeNumber,
                              seasonNumber: member.seasonNumber,
                              title: member.title,
                          }
                        : undefined),
            };
            await db
                .update(schema.downloads)
                .set({
                    metadataSnapshot:
                        encodeDownloadMetadataSnapshot(memberSnapshot),
                    updatedAt: sql`CURRENT_TIMESTAMP`,
                })
                .where(eq(schema.downloads.id, member.id));
        }
        return { success: true };
    }
);
```

Use the database transaction API around the series member updates so the group
cannot be half-refreshed. Expose the exact two-argument bridge method from the
preload.

- [ ] **Step 7: Run backend tests**

Run:

```bash
pnpm nx test electron-backend --runInBand
pnpm nx lint electron-backend
```

Expected: all tests pass; lint reports zero new errors.

- [ ] **Step 8: Commit the IPC boundary**

```bash
git add apps/electron-backend
git commit -m "feat(downloads): manage offline metadata snapshots"
```

---

### Task 3: Expose Snapshot APIs in DownloadsService

**Files:**

- Modify: `libs/services/src/lib/downloads.models.ts`
- Modify: `libs/services/src/lib/downloads.service.ts`
- Test: `libs/services/src/lib/downloads.service.spec.ts`

- [ ] **Step 1: Write failing service tests**

Assert start forwards `metadataSnapshot`, update sends only managed id plus
snapshot, and `getDownload` returns the current signal row:

```ts
await service.updateMetadata(42, snapshot);
expect(electron.downloadsUpdateMetadata).toHaveBeenCalledWith(42, snapshot);
expect(service.getDownload(42)).toEqual(expect.objectContaining({ id: 42 }));
```

Also assert an unsupported runtime returns `{ success: false }` without bridge
access.

- [ ] **Step 2: Run the service test and verify it fails**

Run:

```bash
pnpm nx test services --runInBand
```

Expected: FAIL because `DownloadItem.metadataSnapshot`, `getDownload`, and
`updateMetadata` are absent.

- [ ] **Step 3: Add the renderer model and methods**

Add the imported snapshot type to `DownloadItem`, extend the `startDownload`
input, and implement:

```ts
getDownload(downloadId: number): DownloadItem | undefined {
    return this.downloads().find(({ id }) => id === downloadId);
}

async updateMetadata(
    downloadId: number,
    metadataSnapshot: DownloadMetadataSnapshot
): Promise<{ success: boolean; error?: string }> {
    if (!this.isAvailable()) return { success: false };
    const result = await window.electron.downloadsUpdateMetadata(
        downloadId,
        metadataSnapshot
    );
    if (result.success) await this.loadDownloads();
    return result;
}
```

- [ ] **Step 4: Run service tests and lint**

Run:

```bash
pnpm nx test services --runInBand
pnpm nx lint services
```

Expected: tests pass and there are no new lint errors.

- [ ] **Step 5: Commit the renderer service API**

```bash
git add libs/services
git commit -m "feat(downloads): expose offline metadata updates"
```

---

### Task 4: Build the Pure Offline Detail View Model

**Files:**

- Create: `libs/portal/downloads/feature/src/lib/offline-detail/download-offline-detail.viewmodel.ts`
- Create: `libs/portal/downloads/feature/src/lib/offline-detail/download-offline-detail.viewmodel.spec.ts`

- [ ] **Step 1: Write failing movie and series view-model tests**

Use frozen inputs. Prove that a movie resolves by id, while a representative
episode resolves all available group members and excludes missing/non-completed
rows:

```ts
const result = buildDownloadOfflineDetail({
    downloadId: 10,
    downloads: [
        episode(10, 1, 5, 'available'),
        episode(11, 1, 2, 'available'),
        episode(12, 1, 3, 'missing'),
        episode(13, 2, 1, 'available'),
    ],
});

expect(result?.kind).toBe('series');
expect(result?.seasons.map(({ seasonNumber }) => seasonNumber)).toEqual([1, 2]);
expect(
    result?.seasons[0].episodes.map(({ episodeNumber }) => episodeNumber)
).toEqual([2, 5]);
```

Assert invalid ids, missing representatives, and mixed playlists/series ids do
not leak into a grouped series. A legacy episode without `seriesXtreamId`
resolves as an isolated one-episode series detail so its local file remains
reachable, but it never groups with unrelated legacy rows.

- [ ] **Step 2: Run the focused project test and verify it fails**

Run:

```bash
pnpm nx test portal-downloads-feature --runInBand
```

Expected: FAIL because the view-model module does not exist.

- [ ] **Step 3: Implement immutable filtering and ordering**

Export discriminated view models:

```ts
export type DownloadOfflineDetail =
    | { kind: 'movie'; item: DownloadItem; snapshot?: DownloadMetadataSnapshot }
    | {
          kind: 'series';
          representative: DownloadItem;
          snapshot?: DownloadMetadataSnapshot;
          seasons: DownloadOfflineSeason[];
      };
```

Define availability as `status === 'completed'`, non-empty `filePath`, and
`fileAvailability !== 'missing'`. Sort seasons and episodes numerically, then
by `createdAt`, then `id`. Select the newest valid parent snapshot while
retaining the representative's episode metadata per row. For an ungrouped
legacy episode, synthesize exactly one season/episode entry from its stored
coordinates and title rather than returning not found.

- [ ] **Step 4: Run the view-model tests**

Run:

```bash
pnpm nx test portal-downloads-feature --runInBand
```

Expected: all project tests pass.

- [ ] **Step 5: Commit the offline projection**

```bash
git add libs/portal/downloads/feature/src/lib/offline-detail
git commit -m "feat(downloads): derive offline detail content"
```

---

### Task 5: Add Focused Download Detail Routes and Shell State

**Files:**

- Create: `libs/portal/downloads/feature/src/lib/offline-detail/download-offline-detail.component.ts`
- Modify: `apps/web/src/app/app.routes.ts`
- Modify: `libs/portal/xtream/feature/src/lib/xtream-feature.routes.ts`
- Modify: `libs/portal/stalker/feature/src/lib/stalker-feature.routes.ts`
- Modify: `libs/workspace/shell/util/src/lib/navigation/workspace-shell-route.utils.ts`
- Test: `libs/workspace/shell/util/src/lib/navigation/workspace-shell-route.utils.spec.ts`
- Modify: `libs/portal/downloads/feature/src/index.ts`

- [ ] **Step 1: Write failing route-state tests**

Add:

```ts
expect(
    parseWorkspaceShellRoute('/workspace/xtreams/pl-1/downloads/42')
).toEqual(
    expect.objectContaining({
        section: 'downloads',
        contextPanel: 'none',
        searchMode: 'none',
        usesQuerySearch: false,
    })
);

expect(parseWorkspaceShellRoute('/workspace/downloads/42')).toEqual(
    expect.objectContaining({
        kind: 'downloads',
        contextPanel: 'none',
        searchMode: 'none',
    })
);
```

Keep existing `/downloads` assertions unchanged.

- [ ] **Step 2: Run route-state tests and verify failure**

Run:

```bash
pnpm nx test workspace-shell-util --runInBand
```

Expected: FAIL because focused detail still inherits downloads search/collection
state.

- [ ] **Step 3: Parse focused details explicitly**

Compute:

```ts
const isFocusedDownload =
    (provider !== null &&
        sectionSegment === 'downloads' &&
        segments.length >= 5) ||
    (provider === null && segments[1] === 'downloads' && segments.length >= 3);
```

Override `searchMode`, `usesQuerySearch`, and `contextPanel` to `none` only for
that state.

- [ ] **Step 4: Register all three detail routes**

Create and export a route-loadable shell so route compilation remains green
before the complete presentation lands:

```ts
@Component({
    selector: 'app-download-offline-detail',
    imports: [PortalDetailShellComponent],
    template: '<app-portal-detail-shell [isLoading]="true" />',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DownloadOfflineDetailComponent {}
```

Add `downloads/:downloadId` before or beside each existing exact downloads
route:

```ts
{
    path: 'downloads/:downloadId',
    loadComponent: () =>
        import('@iptvnator/portal/downloads/feature').then(
            (c) => c.DownloadOfflineDetailComponent
        ),
},
```

- [ ] **Step 5: Run shell tests and an Angular build**

Run:

```bash
pnpm nx test workspace-shell-util --runInBand
pnpm nx run web:build:electron-e2e --skipNxCache --outputStyle=static
```

Expected: tests and build pass.

- [ ] **Step 6: Commit focused routing**

```bash
git add apps/web/src/app/app.routes.ts libs/portal/xtream/feature/src/lib/xtream-feature.routes.ts libs/portal/stalker/feature/src/lib/stalker-feature.routes.ts libs/workspace/shell/util libs/portal/downloads/feature/src/index.ts libs/portal/downloads/feature/src/lib/offline-detail/download-offline-detail.component.ts
git commit -m "feat(downloads): add focused offline detail routes"
```

---

### Task 6: Make Ready Cards Open Offline Detail

**Files:**

- Modify: `libs/portal/downloads/feature/src/lib/downloads.component.ts`
- Modify: `libs/portal/downloads/feature/src/lib/downloads.component.html`
- Modify: `libs/portal/downloads/feature/src/lib/downloads.component.spec.ts`
- Modify: `libs/portal/downloads/feature/src/lib/download-library.component.ts`
- Modify: `libs/portal/downloads/feature/src/lib/download-library.component.html`
- Modify: `libs/portal/downloads/feature/src/lib/download-library.component.spec.ts`

- [ ] **Step 1: Write failing card-navigation tests**

Assert movie and series card opens call:

```ts
expect(router.navigate).toHaveBeenCalledWith(['17'], {
    relativeTo: route,
    state: { returnUrl: '/workspace/downloads?q=signal' },
});
```

Assert cards remain openable when the source playlist is unavailable because
local details do not depend on the provider. Keep explicit local Play
unchanged.

- [ ] **Step 2: Run the downloads feature tests and verify failure**

Run:

```bash
pnpm nx test portal-downloads-feature --runInBand
```

Expected: FAIL because card opens still invoke provider navigation and the
library disables cards without a source playlist.

- [ ] **Step 3: Replace card-open provider navigation**

Implement:

```ts
openOfflineDetail(item: DownloadItem): void {
    if (this.pendingIds().has(item.id)) return;
    void this.router.navigate([String(item.id)], {
        relativeTo: this.route,
        state: { returnUrl: this.router.url },
    });
}
```

Wire `openRequested` to this method. Remove `availablePlaylistIds` from
`DownloadLibraryComponent` only where it controlled detail-card disabled state;
source availability remains a concern of `View in portal`.

- [ ] **Step 4: Run feature tests**

Run:

```bash
pnpm nx test portal-downloads-feature --runInBand
pnpm nx lint portal-downloads-feature
```

Expected: all tests pass and lint has no errors.

- [ ] **Step 5: Commit card navigation**

```bash
git add libs/portal/downloads/feature
git commit -m "feat(downloads): open ready cards in offline details"
```

---

### Task 7: Resolve Provider and TMDB Metadata

**Files:**

- Create: `libs/portal/shared/util/src/lib/downloads/download-metadata-snapshot.ts`
- Create: `libs/portal/shared/util/src/lib/downloads/download-metadata-snapshot.spec.ts`
- Modify: `libs/portal/shared/util/src/index.ts`
- Create: `libs/portal/downloads/feature/src/lib/offline-detail/download-metadata.mapper.ts`
- Create: `libs/portal/downloads/feature/src/lib/offline-detail/download-metadata.mapper.spec.ts`
- Create: `libs/portal/downloads/feature/src/lib/offline-detail/download-offline-metadata.service.ts`
- Create: `libs/portal/downloads/feature/src/lib/offline-detail/download-offline-metadata.service.spec.ts`

- [ ] **Step 1: Write failing mapper tests**

Prove provider values seed the snapshot and TMDB replaces only editorial
fields:

```ts
const merged = mergeSnapshotWithTmdb(providerSnapshot, tmdbDetails);
expect(merged.plot).toBe('Localized TMDB overview');
expect(merged.posterUrl).toContain('image.tmdb.org');
expect(merged.providerCategoryId).toBe('12');
expect(merged.title).toBe('Provider title');
expect(merged.cast).toHaveLength(2);
```

Assert people and genre arrays are bounded and credentials/stream URLs are not
part of the returned DTO.

- [ ] **Step 2: Write failing resolver tests**

Cover:

1. a rich, current-language snapshot renders immediately and avoids provider
   lookup;
2. a sparse Stalker legacy row uses the matching portal recent item;
3. a sparse Xtream row uses `DatabaseService.getContentByXtreamId`;
4. enabled TMDB calls `enrichMovie` or `enrichTv`;
5. disabled/failing TMDB retains provider/local data;
6. a successful merge calls `DownloadsService.updateMetadata` once;
7. series enrichment never adds episodes.

- [ ] **Step 3: Run downloads feature tests and verify failure**

Run:

```bash
pnpm nx test portal-downloads-feature --runInBand
```

Expected: FAIL because mapper and resolver do not exist.

- [ ] **Step 4: Implement deterministic snapshot mapping**

Create provider-neutral factories in `@iptvnator/portal/shared/util`:

```ts
export function createMovieDownloadSnapshot(
    input: DownloadMovieSnapshotInput
): DownloadMetadataSnapshot {
    return {
        version: 1,
        language: input.language,
        mediaKind: 'movie',
        title: input.title,
        plot: input.plot,
        posterUrl: input.posterUrl,
        enrichedAt: new Date().toISOString(),
    };
}
```

Add a matching `createSeriesEpisodeDownloadSnapshot` factory accepting parent
series and episode display fields. The offline mapper supplies provider-record
fields from Xtream content and Stalker recent payloads. Reuse
`mergeVodInfoWithTmdb`,
`mergeSerieInfoWithTmdb`, and `mergeStalkerInfoWithTmdb` through normalized
provider seeds rather than inventing different precedence.

- [ ] **Step 5: Implement asynchronous best-effort resolution**

The service exposes:

```ts
async resolve(
    detail: DownloadOfflineDetail
): Promise<DownloadMetadataSnapshot>
```

It starts from the best local snapshot, resolves playlist type, loads a matching
provider record only when the snapshot is sparse/stale/language-mismatched,
applies TMDB when enabled, persists a changed snapshot, and returns the best
result even when every network/provider step fails.

- [ ] **Step 6: Run feature and service tests**

Run:

```bash
pnpm nx test portal-downloads-feature --runInBand
pnpm nx test portal-shared-util --runInBand
pnpm nx test services --runInBand
```

Expected: all tests pass.

- [ ] **Step 7: Commit metadata resolution**

```bash
git add libs/portal/shared/util libs/portal/downloads/feature/src/lib/offline-detail
git commit -m "feat(downloads): enrich offline detail metadata"
```

---

### Task 8: Implement the Offline Movie and Series Detail UI

**Files:**

- Modify: `libs/portal/downloads/feature/src/lib/offline-detail/download-offline-detail.component.ts`
- Create: `libs/portal/downloads/feature/src/lib/offline-detail/download-offline-detail.component.html`
- Create: `libs/portal/downloads/feature/src/lib/offline-detail/download-offline-detail.component.scss`
- Create: `libs/portal/downloads/feature/src/lib/offline-detail/download-offline-detail.component.spec.ts`
- Modify: `libs/portal/downloads/feature/src/index.ts`

- [ ] **Step 1: Write failing component tests**

Use signal-backed `DownloadsService` stubs and route param `downloadId=17`.
Assert:

```ts
expect(text()).toContain('Available offline');
expect(button('Play offline')).toBeTruthy();
expect(text()).not.toContain('Play from source');
expect(button('View in portal')).toBeTruthy();
```

For series, assert only available rows render, season chips expose counts, and
each row emits its own local Play. Assert loading, missing row, source-missing,
and file-race states. Also assert the hero exposes the available year, genres,
duration, rating, status, cast, and creators while gracefully omitting absent
fields.

- [ ] **Step 2: Run feature tests and verify failure**

Run:

```bash
pnpm nx test portal-downloads-feature --runInBand
```

Expected: FAIL because the route-loadable shell does not implement the offline
detail behavior yet.

- [ ] **Step 3: Implement signal-owned route state**

The component:

- loads downloads on entry;
- derives `downloadId` from `ActivatedRoute.paramMap`;
- computes the pure offline detail;
- resolves enriched metadata without blocking the local view;
- uses `DownloadManagerActionsService` for Play/Reveal race handling;
- provides both `DownloadManagerActionsService` and
  `DownloadLibraryNavigationService` at the route-component scope;
- calls `Location.back()` when navigation history exists, otherwise navigates
  to the derived global/scoped downloads fallback.

Keep the TypeScript production file below the repository max-lines threshold by
placing metadata mapping and view-model logic in the files created earlier.

- [ ] **Step 4: Build the shared-detail visual structure**

Use `PortalDetailShellComponent`:

```html
<app-portal-detail-shell
    [title]="metadata().title"
    [description]="metadata().plot"
    [posterUrl]="metadata().posterUrl"
    [backdropUrl]="metadata().backdropUrl"
    (backClicked)="goBack()"
>
    <ng-template appDetailTags>
        <span class="offline-detail__badge">
            {{ 'DOWNLOADS.OFFLINE_DETAIL.AVAILABLE' | translate }}
        </span>
    </ng-template>

    <ng-template appDetailActions>
        @if (detail().kind === 'movie') {
        <button mat-flat-button (click)="play(detail().item)">
            <mat-icon>play_arrow</mat-icon>
            {{ 'DOWNLOADS.OFFLINE_DETAIL.PLAY' | translate }}
        </button>
        }
        <button
            mat-stroked-button
            [disabled]="!canOpenPortal()"
            (click)="viewInPortal()"
        >
            <mat-icon>open_in_new</mat-icon>
            {{ 'DOWNLOADS.OFFLINE_DETAIL.VIEW_IN_PORTAL' | translate }}
        </button>
    </ng-template>
</app-portal-detail-shell>
```

Project season chips and offline episode rows into `[detail-episodes]`.
Add an `appDetailMeta` template for bounded `metadata.cast` and
`metadata.creators`, using the same avatar/name chip anatomy as the Xtream and
Stalker detail views. These offline chips are informational rather than
provider-navigation links; the explicit `View in portal` action owns the
provider transition. Put year, duration, genres, rating, and status into the
hero tag/meta slots with `@if` guards so sparse legacy snapshots never render
placeholder values. Show file size on the movie facts row and on each episode
row. Use only current `--app-*` and Material system tokens.

For `View in portal`, keep the disabled action visible and attach the localized
unavailable explanation as its tooltip and accessible description whenever
the source playlist or target cannot be resolved.

- [ ] **Step 5: Handle disappearing files honestly**

After a `File not found` action result, reload downloads and replace-navigate
back to the manager route. If the initial detail resolves to missing/not found,
render the focused error state with Back rather than provider fallback.

- [ ] **Step 6: Run component tests, lint, and build**

Run:

```bash
pnpm nx test portal-downloads-feature --runInBand
pnpm nx lint portal-downloads-feature
pnpm nx run web:build:electron-e2e --skipNxCache --outputStyle=static
```

Expected: tests, lint, and build pass.

- [ ] **Step 7: Commit the offline UI**

```bash
git add libs/portal/downloads/feature
git commit -m "feat(downloads): render offline movie and series details"
```

---

### Task 9: Add the Explicit Provider-only Handoff

**Files:**

- Create: `libs/portal/shared/util/src/lib/navigation/provider-detail-mode.ts`
- Modify: `libs/portal/shared/util/src/index.ts`
- Modify: `libs/portal/downloads/feature/src/lib/download-library-navigation.service.ts`
- Modify: `libs/portal/downloads/feature/src/lib/download-library-navigation.service.spec.ts`
- Modify: `libs/portal/xtream/feature/src/lib/vod-details/vod-details-route.component.ts`
- Modify: `libs/portal/xtream/feature/src/lib/vod-details/vod-details-route.component.html`
- Modify: `libs/portal/xtream/feature/src/lib/vod-details/vod-details-route.actions.spec.ts`
- Modify: `libs/portal/xtream/feature/src/lib/serial-details/serial-details.component.ts`
- Modify: `libs/portal/xtream/feature/src/lib/serial-details/serial-details.component.html`
- Modify: `libs/portal/xtream/feature/src/lib/serial-details/serial-details.component.spec.ts`
- Modify: `libs/portal/stalker/feature/src/lib/stalker-catalog-detail/stalker-catalog-detail.component.ts`
- Create: `libs/portal/stalker/feature/src/lib/stalker-catalog-detail/stalker-catalog-detail.component.spec.ts`
- Modify: `libs/portal/stalker/feature/src/lib/stalker-inline-detail/stalker-inline-detail.component.ts`
- Create: `libs/portal/stalker/feature/src/lib/stalker-inline-detail/stalker-inline-detail.component.spec.ts`
- Modify: `libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-view.component.ts`
- Modify: `libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-view.component.html`
- Modify: `libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-view.component.spec.ts`
- Modify: `libs/ui/playback/src/lib/vod-details/vod-details.component.ts`
- Modify: `libs/ui/playback/src/lib/vod-details/vod-details.component.html`
- Modify: `libs/ui/playback/src/lib/vod-details/vod-details.component.spec.ts`

- [ ] **Step 1: Write failing navigation tests**

Assert Xtream navigation adds `state: { detailPresentation: 'provider-only' }`
and Stalker preserves its existing item state plus the same flag. Assert all
regular callers remain unchanged. Resolve a concrete provider target before
enabling the action: Xtream uses the snapshot `providerCategoryId` first and
falls back to `DatabaseService.getContentByXtreamId`; it must return unavailable
instead of navigating to a bare VOD/series collection when neither can identify
the item route.

- [ ] **Step 2: Write failing provider presentation tests**

For a downloaded Xtream movie opened with provider-only state, assert:

```ts
expect(component.providerOnly()).toBe(true);
expect(text()).not.toContain('Offline');
expect(text()).not.toContain('Play from this source');
expect(providerPlayButton()).toBeTruthy();
```

For series/Stalker, assert full provider episodes remain present and local
download actions/badges are absent. Cover both Stalker hosts
(`StalkerCatalogDetailComponent` and `StalkerInlineDetailComponent`) and assert
they pass the provider-only mode to regular VOD, Ministra series, and VOD-series
children.

- [ ] **Step 3: Run affected portal tests and verify failure**

Run:

```bash
pnpm nx test portal-downloads-feature --runInBand
pnpm nx test portal-xtream-feature --runInBand
pnpm nx test portal-stalker-feature --runInBand
```

Expected: FAIL because the presentation state is not consumed.

- [ ] **Step 4: Define and carry the scoped state**

Create:

```ts
export const PROVIDER_ONLY_DETAIL_PRESENTATION = 'provider-only' as const;

export function isProviderOnlyDetailState(state: unknown): boolean {
    return (
        typeof state === 'object' &&
        state !== null &&
        (state as { detailPresentation?: unknown }).detailPresentation ===
            PROVIDER_ONLY_DETAIL_PRESENTATION
    );
}
```

The download navigation service adds this field without removing the Stalker
selected-item payload. Refactor it around one async
`resolveProviderTarget(item)` result used by both availability and navigation,
so the visible enabled state cannot disagree with the eventual destination.
Cache that result in the offline route component for the current detail id and
invalidate it when the route item changes.

- [ ] **Step 5: Suppress offline behavior only for this handoff**

Read `history.state` once per detail host into a signal. In provider-only mode:

- Xtream movie `isDownloaded` presentation becomes false while provider
  playback continues through its existing source resolver;
- Xtream series renders its complete provider season/episode list;
- Stalker movie/series keeps the normal provider store and playback controller;
- shared `VodDetailsComponent` and `StalkerSeriesViewComponent` receive a
  `providerOnly` input from the Stalker detail hosts and hide Offline,
  Play-local, Resume-download, and Download actions while retaining provider
  Play/Resume;
- no component mutates the global DownloadsService state;
- a normal category/favorite/recent open continues to use existing behavior.

- [ ] **Step 6: Run all portal tests**

Run:

```bash
pnpm nx test portal-downloads-feature --runInBand
pnpm nx test portal-shared-util --runInBand
pnpm nx test portal-xtream-feature --runInBand
pnpm nx test portal-stalker-feature --runInBand
pnpm nx test portal-stalker-data-access --runInBand
pnpm nx test ui-playback --runInBand
```

Expected: all tests pass.

- [ ] **Step 7: Commit the provider handoff**

```bash
git add libs/portal/shared/util libs/portal/downloads/feature libs/portal/xtream/feature libs/portal/stalker/feature libs/ui/playback
git commit -m "feat(downloads): hand off to provider-only details"
```

---

### Task 10: Capture Rich Snapshots When Downloads Start

**Files:**

- Modify: `libs/portal/xtream/feature/src/lib/vod-details/vod-details-downloads.service.ts`
- Modify: `libs/portal/xtream/feature/src/lib/vod-details/vod-details-route-playback.spec.ts`
- Modify: `libs/portal/stalker/feature/src/lib/stalker-catalog-detail/stalker-vod-download.ts`
- Create: `libs/portal/stalker/feature/src/lib/stalker-catalog-detail/stalker-vod-download.spec.ts`
- Modify: `libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-view.component.ts`
- Modify: `libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-view.component.spec.ts`
- Reuse: `libs/portal/shared/util/src/lib/downloads/download-metadata-snapshot.ts`

- [ ] **Step 1: Verify the planned shared-util dependency**

Run:

```bash
pnpm nx graph --file=/tmp/iptvnator-offline-detail-graph.json
```

Confirm Xtream/Stalker features import the snapshot factories only from
`@iptvnator/portal/shared/util`; they must not import
`portal-downloads-feature`.

- [ ] **Step 2: Write failing Xtream start-payload assertions**

Extend the current movie download spec:

```ts
expect(startDownload).toHaveBeenCalledWith(
    expect.objectContaining({
        metadataSnapshot: expect.objectContaining({
            version: 1,
            mediaKind: 'movie',
            title: 'Metadata Movie',
            plot: 'Provider or TMDB description',
        }),
    })
);
```

- [ ] **Step 3: Write failing Stalker episode snapshot assertions**

Add a focused `stalker-vod-download.spec.ts` assertion for movie metadata, then
assert `downloadEpisode` includes parent series and episode metadata:

```ts
expect(startDownload).toHaveBeenCalledWith(
    expect.objectContaining({
        metadataSnapshot: expect.objectContaining({
            mediaKind: 'series',
            title: 'Signal House',
            episode: {
                seasonNumber: 1,
                episodeNumber: 2,
                title: 'The Call',
            },
        }),
    })
);
```

- [ ] **Step 4: Run affected tests and verify failure**

Run:

```bash
pnpm nx test portal-xtream-feature --runInBand
pnpm nx test portal-stalker-feature --runInBand
```

Expected: FAIL because Xtream movie, Stalker movie, and Stalker episode start
payloads lack `metadataSnapshot`.

- [ ] **Step 5: Map already-enriched detail state into snapshots**

Xtream uses the currently rendered `VodInfo` after the existing TMDB store
merge. Stalker movie maps `VodDetailsItem.data.info`. Stalker series uses
`displayItem().info` plus `getEpisodeInfo(episode)`. All three call the shared
provider-neutral factories. Do not trigger extra TMDB requests at
download-click time; capture the best state already available and let the
offline resolver backfill later.

- [ ] **Step 6: Run provider tests and boundary lint**

Run:

```bash
pnpm nx test portal-xtream-feature --runInBand
pnpm nx test portal-stalker-feature --runInBand
pnpm nx lint portal-xtream-feature
pnpm nx lint portal-stalker-feature
```

Expected: tests and lint pass without module-boundary violations.

- [ ] **Step 7: Commit start-time metadata**

```bash
git add libs/portal/shared/util libs/portal/xtream/feature libs/portal/stalker/feature
git commit -m "feat(downloads): capture metadata at download time"
```

---

### Task 11: Add Localizations, Canonical Docs, and Release Note

**Files:**

- Modify: all `apps/web/src/assets/i18n/*.json`
- Modify: `docs/architecture/download-manager.md`
- Modify: `docs/architecture/portal-detail-navigation.md`
- Modify: `docs/architecture/stalker-portal.md`
- Modify: `CLAUDE.md`
- Modify: `.changes/downloads-manager-mvp.md`

- [ ] **Step 1: Add translation keys**

Add under `DOWNLOADS.OFFLINE_DETAIL`:

```json
{
    "AVAILABLE": "Available offline",
    "PLAY": "Play offline",
    "VIEW_IN_PORTAL": "View in portal",
    "VIEW_IN_PORTAL_UNAVAILABLE": "The source item is no longer available",
    "DOWNLOADED_EPISODES": "{{count}} downloaded episodes",
    "FILE_SIZE": "{{size}}",
    "NOT_FOUND_TITLE": "Download not found",
    "NOT_FOUND_BODY": "This download is no longer available.",
    "BACK": "Back to Downloads"
}
```

Use Russian translations in `ru.json` and English fallbacks in locales without
an established translation for the new copy.

- [ ] **Step 2: Update canonical behavior docs**

Document:

- focused download item routes and hidden context panel;
- local-only movie/episode playback;
- offline-only series projection;
- safe metadata snapshot and legacy backfill;
- provider-only handoff semantics for Xtream and all Stalker series modes.

Update `CLAUDE.md` because its route inventory must include the three
`downloads/:downloadId` variants and its Download Manager feature summary must
replace the old provider-detail/Play-from-source behavior. `AGENTS.md` does not
enumerate these routes or this feature contract, so leave it unchanged.

- [ ] **Step 3: Update the existing release note**

Keep the note body under 400 characters and user-facing:

```md
Downloads now open movies and series in focused offline details with saved
metadata and optional TMDB enrichment. Series show only episodes that are
actually available locally, while View in portal opens the complete online
catalog and provider playback.
```

- [ ] **Step 4: Validate JSON, formatting, and release notes**

Run:

```bash
node -e 'const fs=require("node:fs"); for(const file of fs.readdirSync("apps/web/src/assets/i18n").filter(file=>file.endsWith(".json"))){JSON.parse(fs.readFileSync(`apps/web/src/assets/i18n/${file}`,"utf8"));} console.log("All locale JSON files parse successfully.")'
pnpm run release:notes:validate
pnpm exec prettier --check apps/web/src/assets/i18n docs/architecture CLAUDE.md .changes/downloads-manager-mvp.md
```

Expected: locale parse succeeds, all release notes are valid, and Prettier
reports no differences.

- [ ] **Step 5: Commit docs and copy**

```bash
git add apps/web/src/assets/i18n docs/architecture CLAUDE.md .changes/downloads-manager-mvp.md
git commit -m "docs(downloads): document offline detail views"
```

---

### Task 12: Extend Electron E2E and Run the Final Validation Ladder

**Files:**

- Modify: `apps/electron-backend-e2e/src/downloads.e2e.ts`

- [ ] **Step 1: Extend the existing end-to-end journey**

After a fixture movie completes:

```ts
await card.getByRole('button', { name: /open details/i }).click();
await expect(page.getByText('Available offline')).toBeVisible();
await expect(page.getByRole('button', { name: 'Play offline' })).toBeVisible();
await expect(page.getByText('Play from source')).toHaveCount(0);
await expect(contextPanel).toHaveCount(0);
```

Use fixture/mock IPC to assert local Play receives the finalized file path.
Click `View in portal`, assert the provider detail and category context return,
and assert the provider-only view has no Offline/local actions.

For a Stalker series fixture, download two non-contiguous episodes and assert
the offline route renders exactly those two rows. Remove one finalized file and
assert the detail returns to Needs attention.

- [ ] **Step 2: Run focused E2E and fix only observed failures**

Run:

```bash
pnpm nx run electron-backend-e2e:e2e-ci--src/downloads.e2e.ts
```

Expected: all downloads E2E cases pass.

- [ ] **Step 3: Run the affected unit suites**

Run:

```bash
pnpm nx test database --runInBand
pnpm nx test electron-backend --runInBand
pnpm nx test shared-interfaces --runInBand
pnpm nx test services --runInBand
pnpm nx test workspace-shell-util --runInBand
pnpm nx test portal-downloads-feature --runInBand
pnpm nx test portal-shared-util --runInBand
pnpm nx test portal-xtream-feature --runInBand
pnpm nx test portal-stalker-feature --runInBand
pnpm nx test portal-stalker-data-access --runInBand
pnpm nx test ui-playback --runInBand
```

Expected: all suites pass with zero failed tests.

- [ ] **Step 4: Run lint and build**

Run:

```bash
pnpm nx lint database
pnpm nx lint electron-backend
pnpm nx lint shared-interfaces
pnpm nx lint services
pnpm nx lint workspace-shell-util
pnpm nx lint portal-downloads-feature
pnpm nx lint portal-shared-util
pnpm nx lint portal-xtream-feature
pnpm nx lint portal-stalker-feature
pnpm nx lint ui-playback
pnpm nx run web:build:electron-e2e --skipNxCache --outputStyle=static
pnpm run release:notes:validate
git diff --check
```

Expected: no lint errors, build succeeds, release notes validate, and diff
check is empty.

- [ ] **Step 5: Perform manual Electron CDP verification**

Start:

```bash
IPTVNATOR_ALLOW_MULTIPLE_INSTANCES=1 pnpm nx serve electron-backend
```

Connect with:

```bash
agent-browser --cdp 9222 tab list
```

Verify global and scoped Downloads, movie/series focused details, absence of
the category panel, local Play, provider handoff, light/dark themes, and
keyboard focus. Do not expose real playlist titles, URLs, or credentials in
logs or screenshots.

- [ ] **Step 6: Commit the regression journey**

```bash
git add apps/electron-backend-e2e/src/downloads.e2e.ts
git commit -m "test(downloads): cover offline detail journeys"
```

- [ ] **Step 7: Push the existing draft PR branch**

```bash
git status --short
git push origin agent/download-manager-mvp
gh pr view 1313 --json url,isDraft,state,headRefName
```

Expected: branch and remote HEAD match; draft PR #1313 remains open.
