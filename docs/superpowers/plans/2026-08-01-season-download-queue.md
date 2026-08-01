# Season Download Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Electron users enqueue several series episodes independently and
enqueue every eligible episode in the selected season while preserving the
existing single-transfer FIFO queue.

**Architecture:** Keep `SeasonContainerComponent` as the shared presentation
owner, move provider-neutral pending/eligibility/batch orchestration into
`portal-shared-data-access`, keep pure identity rules in
`portal-shared-util`, and construct requests in focused Xtream and Stalker
adapters. Extend the existing `DOWNLOADS_START` path with canonical/legacy
episode identity resolution and a stable duplicate reason; do not add batch
IPC, schema changes, or renderer-side transfer scheduling.

**Tech Stack:** Angular 21 standalone components and signals, TypeScript 5.9,
Angular Material, ngx-translate, Jest through Nx, Electron IPC, Drizzle/SQLite,
Playwright Electron E2E, Markdown architecture/release documentation.

---

### Task 0: Preserve The Approved Baseline And Load Required Skills

**Files:**

- Verify: `docs/superpowers/specs/2026-08-01-season-download-queue-design.md`
- Verify: `package.json`
- Verify: `pnpm-lock.yaml`

- [x] **Step 1: Create the isolated branch from current master**

The linked worktree was created at commit `760099358`, the merge of PR #1313,
and the branch is:

```bash
git switch -c agent/download-season-queue
```

Expected: `git branch --show-current` prints
`agent/download-season-queue`.

- [x] **Step 2: Bootstrap and verify Nx discovery**

Run:

```bash
pnpm install --frozen-lockfile
pnpm nx show projects
```

Expected: both commands exit 0 and the project list includes `components`,
`portal-shared-util`, `portal-shared-data-access`, `portal-xtream-feature`,
`portal-stalker-feature`, `services`, `electron-backend`,
`xtream-mock-server`, and `electron-backend-e2e`.

- [x] **Step 3: Record the focused baseline**

The following suites already pass before implementation:

```bash
pnpm nx test components --runInBand \
  --testPathPatterns=season-container.component.spec.ts \
  --testPathPatterns=episode-utils.spec.ts
pnpm nx test portal-xtream-feature --runInBand \
  --testPathPatterns=serial-details.component.spec.ts
pnpm nx test portal-stalker-feature --runInBand \
  --testPathPatterns=stalker-series-view.component.spec.ts
pnpm nx test services --runInBand \
  --testPathPatterns=downloads.service.spec.ts
pnpm nx test electron-backend --runInBand \
  --testPathPatterns=download-requests.spec.ts
```

Expected baseline: components 128 tests, focused Xtream 14, focused Stalker
16, services downloads 21, and Electron download requests 20 all pass.

- [ ] **Step 4: Load the implementation skills before changing runtime code**

Read the full instructions for:

```text
.codex/skills/iptvnator-ui-design/SKILL.md
.codex/skills/iptvnator-theme-style/SKILL.md
.codex/skills/iptvnator-sqlite-db-worker/SKILL.md
.codex/skills/xtream-electron/SKILL.md
.codex/skills/stalker-portal/SKILL.md
~/.agents/skills/angular-developer/SKILL.md
~/.agents/skills/angular-signals/SKILL.md
~/.agents/skills/angular-testing/SKILL.md
~/.agents/skills/test-driven-development/SKILL.md
~/.agents/skills/playwright/SKILL.md
```

Announce each skill-driven action in commentary. Use
`test-driven-development` for every task below and keep the RED test output in
the working notes before writing its production code.

### Task 1: Define Canonical Episode Identity And Eligibility

**Files:**

- Create:
  `libs/portal/shared/util/src/lib/downloads/episode-download-identity.ts`
- Create:
  `libs/portal/shared/util/src/lib/downloads/episode-download-identity.spec.ts`
- Modify: `libs/portal/shared/util/src/index.ts`
- Modify: `libs/shared/interfaces/src/lib/electron-api.interface.ts`
- Modify: `libs/services/src/lib/downloads.models.ts`
- Modify: `libs/services/src/lib/downloads.service.ts`
- Modify: `libs/services/src/lib/downloads.service.spec.ts`

- [ ] **Step 1: Write the failing identity and eligibility tests**

Create `episode-download-identity.spec.ts` with a small row builder and these
assertions:

```typescript
const identity: EpisodeDownloadIdentity = {
    playlistId: 'playlist-1',
    xtreamId: 101,
    contentType: 'episode',
    seriesXtreamId: 900,
    seasonNumber: 2,
    episodeNumber: 3,
};

it('matches canonical identity before legacy coordinates', () => {
    const coordinateRow = row({ id: 1, xtreamId: 777 });
    const canonicalRow = row({ id: 2, xtreamId: 101 });
    expect(
        findEpisodeDownload(identity, [coordinateRow, canonicalRow])?.id
    ).toBe(2);
});

it('recognizes a legacy row by complete episode coordinates', () => {
    expect(findEpisodeDownload(identity, [row({ xtreamId: 777 })])).toEqual(
        expect.objectContaining({ xtreamId: 777 })
    );
});

it('does not coordinate-match another playlist or incomplete row', () => {
    expect(
        findEpisodeDownload(identity, [
            row({ playlistId: 'playlist-2', xtreamId: 777 }),
            row({ episodeNumber: undefined, xtreamId: 778 }),
        ])
    ).toBeUndefined();
});

it.each([
    ['queued', undefined, false],
    ['downloading', undefined, false],
    ['paused', undefined, false],
    ['completed', 'available', false],
    ['completed', undefined, false],
    ['completed', 'not-applicable', false],
    ['completed', 'missing', true],
    ['failed', undefined, true],
    ['canceled', undefined, true],
] as const)(
    'classifies %s/%s eligibility',
    (status, fileAvailability, expected) => {
        expect(
            isEpisodeDownloadEligible(row({ status, fileAvailability }))
        ).toBe(expected);
    }
);

it('creates collision-free keys across playlists and coordinates', () => {
    expect(createEpisodeDownloadIdentityKey(identity)).not.toBe(
        createEpisodeDownloadIdentityKey({
            ...identity,
            playlistId: 'playlist-2',
        })
    );
    expect(createEpisodeDownloadIdentityKey(identity)).not.toBe(
        createEpisodeDownloadIdentityKey({
            ...identity,
            episodeNumber: 4,
        })
    );
});
```

Run:

```bash
pnpm nx test portal-shared-util --runInBand \
  --testPathPatterns=episode-download-identity.spec.ts
```

Expected: FAIL because the identity module does not exist.

- [ ] **Step 2: Implement the pure contract and helpers**

Add the following provider-neutral shape and behavior:

```typescript
export interface EpisodeDownloadIdentity {
    readonly playlistId: string;
    readonly xtreamId: number;
    readonly contentType: 'episode';
    readonly seriesXtreamId: number;
    readonly seasonNumber: number;
    readonly episodeNumber: number;
}

export interface EpisodeDownloadRecord {
    readonly id: number;
    readonly playlistId: string;
    readonly xtreamId: number;
    readonly contentType: 'vod' | 'episode';
    readonly seriesXtreamId?: number;
    readonly seasonNumber?: number;
    readonly episodeNumber?: number;
    readonly status:
        | 'queued'
        | 'downloading'
        | 'paused'
        | 'completed'
        | 'failed'
        | 'canceled';
    readonly fileAvailability?: 'available' | 'missing' | 'not-applicable';
    readonly filePath?: string;
}

export function createEpisodeDownloadIdentityKey(
    identity: EpisodeDownloadIdentity
): string {
    return JSON.stringify([
        identity.playlistId,
        identity.contentType,
        identity.xtreamId,
        identity.seriesXtreamId,
        identity.seasonNumber,
        identity.episodeNumber,
    ]);
}

export function findEpisodeDownload<T extends EpisodeDownloadRecord>(
    identity: EpisodeDownloadIdentity,
    downloads: readonly T[]
): T | undefined {
    return (
        downloads.find(
            (item) =>
                item.playlistId === identity.playlistId &&
                item.contentType === 'episode' &&
                item.xtreamId === identity.xtreamId
        ) ??
        downloads.find(
            (item) =>
                item.playlistId === identity.playlistId &&
                item.contentType === 'episode' &&
                item.seriesXtreamId === identity.seriesXtreamId &&
                item.seasonNumber === identity.seasonNumber &&
                item.episodeNumber === identity.episodeNumber
        )
    );
}

export function isEpisodeDownloadEligible(
    download: EpisodeDownloadRecord | undefined
): boolean {
    if (!download) return true;
    if (download.status === 'failed' || download.status === 'canceled') {
        return true;
    }
    return (
        download.status === 'completed' &&
        download.fileAvailability === 'missing'
    );
}
```

Export the module from `portal/shared/util/src/index.ts`. Keep the util pure:
it must not import `DownloadsService` or another `type:data-access` library.

Run the focused util spec again. Expected: PASS.

- [ ] **Step 3: Extend the start-result contract without changing IPC shape**

In `electron-api.interface.ts`, add:

```typescript
export type ElectronBridgeDownloadStartReason = 'already-in-progress';

export interface ElectronBridgeDownloadStartResult extends ElectronBridgeErrorResult {
    id?: number;
    reason?: ElectronBridgeDownloadStartReason;
}
```

Export `DownloadStartInput` publicly from the services package:

```typescript
export type {
    DownloadItem,
    DownloadStartInput,
    DownloadStatus,
} from './downloads.models';
```

Type `DownloadsService.startDownload()` as
`Promise<ElectronBridgeDownloadStartResult>`. Extend its spec so a bridge
result containing `reason: 'already-in-progress'` is returned unchanged.

Run:

```bash
pnpm nx test services --runInBand \
  --testPathPatterns=downloads.service.spec.ts
pnpm nx test portal-shared-util --runInBand \
  --testPathPatterns=episode-download-identity.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Commit the identity slice**

```bash
git add libs/portal/shared/util libs/shared/interfaces/src/lib/electron-api.interface.ts \
  libs/services/src/lib/downloads.models.ts \
  libs/services/src/lib/downloads.service.ts \
  libs/services/src/lib/downloads.service.spec.ts
git commit -m "feat(downloads): define episode queue identity"
```

### Task 2: Build The Provider-Neutral Queue Coordinator

**Files:**

- Create:
  `libs/portal/shared/data-access/src/lib/downloads/season-download.models.ts`
- Create:
  `libs/portal/shared/data-access/src/lib/downloads/season-download-coordinator.service.ts`
- Create:
  `libs/portal/shared/data-access/src/lib/downloads/season-download-coordinator.service.spec.ts`
- Create: `libs/portal/shared/data-access/src/lib/downloads/index.ts`
- Modify: `libs/portal/shared/data-access/src/index.ts`

- [ ] **Step 1: Write failing pending, deduplication, and batch tests**

Define candidates with a deferred `prepare` promise and a
`DownloadsService` stub whose `downloads`, `hasLoadedDownloads`, and
`isAvailable` values are signals. Cover all of these cases:

```typescript
it('reserves one identity synchronously and leaves another actionable', () => {
    const first = candidate({ xtreamId: 101, episodeNumber: 1 });
    const second = candidate({ xtreamId: 102, episodeNumber: 2 });

    const pending = coordinator.enqueueOne(first);

    expect(coordinator.isPending(first.identity)).toBe(true);
    expect(coordinator.isEligible(first)).toBe(false);
    expect(coordinator.isEligible(second)).toBe(true);
    return pending;
});

it('dispatches one of two rapid requests for the same identity', async () => {
    await Promise.all([
        coordinator.enqueueOne(candidate()),
        coordinator.enqueueOne(candidate()),
    ]);
    expect(downloads.startDownload).toHaveBeenCalledTimes(1);
});

it('dispatches distinct candidates sequentially in display order', async () => {
    const result = await coordinator.enqueueSeason([
        candidate({ xtreamId: 101, episodeNumber: 1 }),
        candidate({ xtreamId: 102, episodeNumber: 2 }),
    ]);
    expect(
        downloads.startDownload.mock.calls.map(([request]) => request.xtreamId)
    ).toEqual([101, 102]);
    expect(result).toEqual({ added: 2, skipped: 0, failed: 0 });
});

it('partitions invalid, duplicate, blocked, and failed candidates', async () => {
    downloads.downloads.set([
        row({ xtreamId: 102, episodeNumber: 2, status: 'paused' }),
    ]);
    downloads.startDownload
        .mockResolvedValueOnce({ success: true, id: 1 })
        .mockResolvedValueOnce({
            success: false,
            id: 2,
            reason: 'already-in-progress',
            error: 'Download already in progress',
        })
        .mockResolvedValueOnce({ success: false, error: 'rejected' });

    const result = await coordinator.enqueueSeason([
        candidate({ xtreamId: 101, episodeNumber: 1 }),
        null,
        candidate({ xtreamId: 102, episodeNumber: 2 }),
        candidate({ xtreamId: 103, episodeNumber: 3 }),
        candidate({ xtreamId: 104, episodeNumber: 4 }),
    ]);

    expect(result).toEqual({ added: 1, skipped: 3, failed: 1 });
});

it('continues after prepare rejects and refreshes once after successes', async () => {
    const broken = candidate({ xtreamId: 101, episodeNumber: 1 });
    broken.prepare.mockRejectedValue(new Error('secret provider failure'));
    const good = candidate({ xtreamId: 102, episodeNumber: 2 });

    await expect(coordinator.enqueueSeason([broken, good])).resolves.toEqual({
        added: 1,
        skipped: 0,
        failed: 1,
    });
    expect(downloads.startDownload).toHaveBeenCalledTimes(1);
    expect(downloads.loadDownloads).toHaveBeenCalledTimes(1);
});
```

Also assert initial `hasLoadedDownloads=false` blocks eligibility, a missing
completed row is eligible, an available completed row is skipped, candidate
duplicates inside one batch prepare once, and successful pending keys are kept
until the final `loadDownloads()` promise settles.

Run:

```bash
pnpm nx test portal-shared-data-access --runInBand \
  --testPathPatterns=season-download-coordinator.service.spec.ts
```

Expected: FAIL because the models and coordinator do not exist.

- [ ] **Step 2: Add the adapter/candidate/result contracts**

Create `season-download.models.ts`:

```typescript
import type { XtreamSerieEpisode } from '@iptvnator/shared/interfaces';
import type { DownloadStartInput } from '@iptvnator/services';
import type { EpisodeDownloadIdentity } from '@iptvnator/portal/shared/util';

export interface EpisodeDownloadCandidate {
    readonly identity: EpisodeDownloadIdentity;
    readonly prepare: () => Promise<DownloadStartInput>;
}

export interface SeasonEpisodeDownloadAdapter {
    createCandidate(
        episode: XtreamSerieEpisode,
        fallbackSeasonKey: string | undefined
    ): EpisodeDownloadCandidate | null;
}

export interface SeasonDownloadResult {
    readonly added: number;
    readonly skipped: number;
    readonly failed: number;
}

export type EpisodeDownloadSubmission = 'added' | 'skipped' | 'failed';
```

- [ ] **Step 3: Implement synchronous reservation and sequential submission**

Create an injectable root coordinator. The key mechanics must be:

```typescript
@Injectable({ providedIn: 'root' })
export class SeasonDownloadCoordinator {
    private readonly downloadsService = inject(DownloadsService);
    private readonly pendingKeys = signal<ReadonlySet<string>>(new Set());

    isPending(identity: EpisodeDownloadIdentity): boolean {
        return this.pendingKeys().has(
            createEpisodeDownloadIdentityKey(identity)
        );
    }

    findDownload(identity: EpisodeDownloadIdentity): DownloadItem | undefined {
        return findEpisodeDownload(identity, this.downloadsService.downloads());
    }

    isEligible(candidate: EpisodeDownloadCandidate): boolean {
        return (
            this.downloadsService.hasLoadedDownloads() &&
            !this.isPending(candidate.identity) &&
            isEpisodeDownloadEligible(this.findDownload(candidate.identity))
        );
    }

    async enqueueOne(
        candidate: EpisodeDownloadCandidate
    ): Promise<EpisodeDownloadSubmission> {
        if (!this.reserve(candidate.identity)) return 'skipped';
        const outcome = await this.submit(candidate);
        if (outcome === 'added') {
            try {
                await this.downloadsService.loadDownloads();
            } finally {
                this.release(candidate.identity);
            }
        } else {
            this.release(candidate.identity);
        }
        return outcome;
    }

    async enqueueSeason(
        candidates: readonly (EpisodeDownloadCandidate | null)[]
    ): Promise<SeasonDownloadResult> {
        const result = { added: 0, skipped: 0, failed: 0 };
        const reserved: EpisodeDownloadCandidate[] = [];

        for (const candidate of candidates) {
            if (!candidate || !this.reserve(candidate.identity)) {
                result.skipped++;
            } else {
                reserved.push(candidate);
            }
        }

        const accepted: EpisodeDownloadIdentity[] = [];
        for (const candidate of reserved) {
            const outcome = await this.submit(candidate);
            result[outcome]++;
            if (outcome === 'added') accepted.push(candidate.identity);
            else this.release(candidate.identity);
        }

        if (accepted.length > 0) {
            try {
                await this.downloadsService.loadDownloads();
            } finally {
                this.releaseMany(accepted);
            }
        }
        return result;
    }
}
```

`reserve()` must clone the set, re-check authoritative eligibility, and add
the key in the same synchronous call. `submit()` must catch provider/IPC
exceptions, log through `createLogger`, return `skipped` only for
`reason === 'already-in-progress'`, and return `failed` for every other
unsuccessful result. Never compare the human-readable `error` string and never
log request URLs or credentials.

Export the downloads sub-entrypoint from the library root.

Run the focused coordinator spec. Expected: PASS.

- [ ] **Step 4: Commit the orchestration slice**

```bash
git add libs/portal/shared/data-access
git commit -m "feat(downloads): coordinate season queue submissions"
```

### Task 3: Add The Backend Legacy Identity Guard

**Files:**

- Create:
  `apps/electron-backend/src/app/events/database/download-request-identity.ts`
- Create:
  `apps/electron-backend/src/app/events/database/download-request-identity.spec.ts`
- Modify:
  `apps/electron-backend/src/app/events/database/download-requests.ts`
- Modify:
  `apps/electron-backend/src/app/events/database/download-requests.spec.ts`

- [ ] **Step 1: Write failing resolver tests**

The focused resolver spec must cover:

```typescript
expect(await resolveExistingDownloadIdentity(db, episodeRequest())).toEqual({
    kind: 'match',
    item: canonicalRow,
    migrateCanonicalId: false,
});

expect(
    await resolveExistingDownloadIdentity(
        dbWithRows([], [legacyRow]),
        episodeRequest()
    )
).toEqual({
    kind: 'match',
    item: legacyRow,
    migrateCanonicalId: true,
});

expect(
    await resolveExistingDownloadIdentity(
        dbWithRows([canonicalRow], [differentCoordinateRow]),
        episodeRequest()
    )
).toEqual({ kind: 'conflict' });
```

Add explicit cases for a canonical row with conflicting complete coordinates,
two coordinate rows, VOD, and an episode request missing any of
`seriesXtreamId`, `seasonNumber`, or `episodeNumber`. VOD/incomplete requests
must perform only the canonical lookup.

Run:

```bash
pnpm nx test electron-backend --runInBand \
  --testPathPatterns=download-request-identity.spec.ts
```

Expected: FAIL because the resolver does not exist.

- [ ] **Step 2: Implement exact-first, fail-closed resolution**

Use `DownloadsDatabase` and `schema.downloads.$inferSelect`. The result union
must be:

```typescript
export type ExistingDownloadIdentityResolution =
    | { readonly kind: 'none' }
    | { readonly kind: 'conflict' }
    | {
          readonly kind: 'match';
          readonly item: typeof schema.downloads.$inferSelect;
          readonly migrateCanonicalId: boolean;
      };
```

Perform a canonical query with `limit(1)`. Only for an `episode` request with
all three safe integer coordinates, perform the coordinate query with
`limit(2)`. Return `conflict` when:

- more than one coordinate row exists;
- exact and coordinate lookups point at different row ids; or
- the exact row has complete coordinates that disagree with the request.

Return the exact row before the coordinate row when they agree. Do not merge,
delete, or mutate inside the resolver.

Run the resolver spec. Expected: PASS.

- [ ] **Step 3: Drive start-request integration from failing tests**

Refactor the existing download-request test harness so it can return separate
canonical and coordinate lookup rows. Add tests asserting:

```typescript
await expect(
    startDownloadRequest(activeLegacyPayload, authorizer)
).resolves.toEqual({
    success: false,
    id: legacyRow.id,
    error: 'Download already in progress',
    reason: 'already-in-progress',
});

await startDownloadRequest(canceledLegacyPayload, authorizer);
expect(set).toHaveBeenCalledWith(
    expect.objectContaining({
        status: 'queued',
        xtreamId: canceledLegacyPayload.xtreamId,
    })
);

await expect(
    startDownloadRequest(conflictingPayload, authorizer)
).resolves.toEqual({
    success: false,
    error: 'Download identity conflict',
});
expect(enqueueDownload).not.toHaveBeenCalled();
```

Use `it.each` for `queued`, `downloading`, and `paused`; each must carry the
stable reason. Use `it.each` for `failed`, `canceled`, and `completed`; each
eligible coordinate match must reuse the row id and migrate `xtreamId`.
Assert a rejected uniqueness update does not call `enqueueDownload`.

Run both backend specs. Expected: the new integration assertions FAIL against
the current exact-only implementation.

- [ ] **Step 4: Integrate the resolver without changing queue semantics**

Replace only the existing download-row lookup in `startDownloadRequest()`:

```typescript
const resolution = await resolveExistingDownloadIdentity(db, data);
if (resolution.kind === 'conflict') {
    return { success: false, error: 'Download identity conflict' };
}
const item = resolution.kind === 'match' ? resolution.item : undefined;

if (item && !['completed', 'failed', 'canceled'].includes(item.status)) {
    return {
        success: false,
        id: item.id,
        error: 'Download already in progress',
        reason: 'already-in-progress',
    };
}
```

In the existing restart update, add `xtreamId: data.xtreamId` only when
`resolution.migrateCanonicalId` is true. Leave directory authorization,
remote URL validation, retained partial cleanup, metadata validation, file
naming, row insertion, `enqueueDownload()`, and `download-runtime.ts`
unchanged. A database uniqueness rejection must propagate before enqueueing,
which is the fail-closed race behavior.

Run:

```bash
pnpm nx test electron-backend --runInBand \
  --testPathPatterns=download-request-identity.spec.ts \
  --testPathPatterns=download-requests.spec.ts
```

Expected: PASS, including all pre-existing authorization/restart tests.

- [ ] **Step 5: Commit the backend guard**

```bash
git add apps/electron-backend/src/app/events/database/download-request-identity.ts \
  apps/electron-backend/src/app/events/database/download-request-identity.spec.ts \
  apps/electron-backend/src/app/events/database/download-requests.ts \
  apps/electron-backend/src/app/events/database/download-requests.spec.ts
git commit -m "fix(downloads): reconcile legacy episode identities"
```

### Task 4: Move Xtream Request Construction Behind An Adapter

**Files:**

- Create:
  `libs/portal/xtream/feature/src/lib/serial-details/xtream-series-download.adapter.ts`
- Create:
  `libs/portal/xtream/feature/src/lib/serial-details/xtream-series-download.adapter.spec.ts`
- Modify:
  `libs/portal/xtream/feature/src/lib/serial-details/serial-download-metadata.ts`
- Modify:
  `libs/portal/xtream/feature/src/lib/serial-details/serial-details.component.ts`
- Modify:
  `libs/portal/xtream/feature/src/lib/serial-details/serial-details.component.html`
- Modify:
  `libs/portal/xtream/feature/src/lib/serial-details/serial-details.component.spec.ts`

- [ ] **Step 1: Write the failing Xtream adapter tests**

Cover the complete request, not just its URL:

```typescript
const adapter = createXtreamSeriesDownloadAdapter({
    playlistId: 'playlist-1',
    seriesId: 900,
    seriesTitle: 'Signal House',
    serverUrl: 'http://host/',
    username: 'user',
    password: 'pass',
    metadataContext: {
        language: 'en',
        title: 'Signal House',
        plot: 'Series plot',
    },
});
const candidate = adapter.createCandidate(episode, '1');

expect(candidate?.identity).toEqual({
    playlistId: 'playlist-1',
    xtreamId: 55,
    contentType: 'episode',
    seriesXtreamId: 900,
    seasonNumber: 2,
    episodeNumber: 3,
});
await expect(candidate?.prepare()).resolves.toEqual(
    expect.objectContaining({
        playlistId: 'playlist-1',
        xtreamId: 55,
        title: 'Signal House - S02E03 - The One',
        url: 'http://host/series/user/pass/55.mkv',
        posterUrl: 'https://images.test/episode.jpg',
        metadataSnapshot: expect.objectContaining({
            mediaKind: 'series',
            episode: expect.objectContaining({
                seasonNumber: 2,
                episodeNumber: 3,
            }),
        }),
    })
);
```

Also assert fallback season/episode defaults and `null` candidates for missing
provider credentials, playlist, unsafe episode id, unsafe series id, or unsafe
coordinates.

Run:

```bash
pnpm nx test portal-xtream-feature --runInBand \
  --testPathPatterns=xtream-series-download.adapter.spec.ts
```

Expected: FAIL because the adapter does not exist.

- [ ] **Step 2: Implement the Xtream adapter and provider-local metadata type**

Move `buildXtreamEpisodeDownloadRequest()` and its metadata snapshot assembly
out of `ui/components` into the new adapter. Define the adapter options next to
the provider implementation and return `SeasonEpisodeDownloadAdapter`:

```typescript
export function createXtreamSeriesDownloadAdapter(
    options: XtreamSeriesDownloadAdapterOptions
): SeasonEpisodeDownloadAdapter {
    return {
        createCandidate(episode, fallbackSeasonKey) {
            const identity = createIdentity(
                options,
                episode,
                fallbackSeasonKey
            );
            if (!identity || !hasRequiredXtreamContext(options)) return null;
            return {
                identity,
                prepare: async () => buildRequest(options, episode, identity),
            };
        },
    };
}
```

Change `createXtreamSeriesDownloadMetadataContext()` to return the pure
`DownloadMovieSnapshotInput` type from `@iptvnator/portal/shared/util`, removing
its dependency on a UI-owned type. Preserve the current raw Xtream URL,
credential, extension, title, poster, coordinate, and metadata semantics.

Run the adapter spec. Expected: PASS.

- [ ] **Step 3: Wire the adapter into SerialDetailsComponent**

Replace the old `xtreamDownloadContext` and `downloadMetadataContext` inputs
with one computed adapter:

```typescript
readonly episodeDownloadAdapter = computed(() => {
    const playlist = this.xtreamStore.currentPlaylist();
    const item = this.selectedItem();
    if (!playlist || !item) return null;
    return createXtreamSeriesDownloadAdapter({
        playlistId: playlist.id,
        seriesId: Number(item.series_id),
        seriesTitle: item.info.name,
        serverUrl: playlist.serverUrl,
        username: playlist.username,
        password: playlist.password,
        metadataContext: createXtreamSeriesDownloadMetadataContext(
            item.info,
            this.translateService.currentLang ||
                this.translateService.defaultLang ||
                'en'
        ),
    });
});
```

Template binding:

```html
<app-season-container
    ...
    [downloadAdapter]="episodeDownloadAdapter()"
    [downloadsEnabled]="!providerOnly()"
/>
```

Update the stub component and assert the bound adapter creates canonical
candidate id 1001 and the existing metadata snapshot. Run:

```bash
pnpm nx test portal-xtream-feature --runInBand \
  --testPathPatterns=xtream-series-download.adapter.spec.ts \
  --testPathPatterns=serial-details.component.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Commit the Xtream adapter**

```bash
git add libs/portal/xtream/feature/src/lib/serial-details
git commit -m "refactor(downloads): adapt Xtream episode requests"
```

### Task 5: Move Stalker Request Construction Behind The Same Contract

**Files:**

- Create:
  `libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-download.adapter.ts`
- Create:
  `libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-download.adapter.spec.ts`
- Modify:
  `libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-view.component.ts`
- Modify:
  `libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-view.component.html`
- Modify:
  `libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-view.component.spec.ts`

- [ ] **Step 1: Write the Stalker collision regression first**

Create two mapped episodes with different normalized `episode.id` values but
the same playback ownership fields:

```typescript
const first = stalkerEpisode({
    id: '61001',
    episode_num: 1,
    originalCmd: '/media/file_777.mpg',
});
const second = stalkerEpisode({
    id: '61002',
    episode_num: 2,
    originalCmd: '/media/file_777.mpg',
});

const firstCandidate = adapter.createCandidate(first, '1');
const secondCandidate = adapter.createCandidate(second, '1');

expect(firstCandidate?.identity.xtreamId).toBe(61001);
expect(secondCandidate?.identity.xtreamId).toBe(61002);
expect(firstCandidate?.identity).not.toEqual(secondCandidate?.identity);
```

Repeat the regression for VOD-series episodes sharing `originalId`. Assert
that `originalCmd`/`originalId` is still used to call `resolveUrl`, while the
prepared `DownloadStartInput.xtreamId` remains the normalized `episode.id`.
Also test headers, playlist fields, metadata snapshot, empty resolved URL, and
a rejected resolver promise.

Run:

```bash
pnpm nx test portal-stalker-feature --runInBand \
  --testPathPatterns=stalker-series-download.adapter.spec.ts
```

Expected: FAIL because the adapter does not exist.

- [ ] **Step 2: Implement provider preparation without owning orchestration**

The adapter options must contain only the current playlist/item/language,
canonical series id, and an injected URL resolver callback. Its candidate
shape is:

```typescript
return {
    identity: {
        playlistId: playlist._id,
        xtreamId: Number(episode.id),
        contentType: 'episode',
        seriesXtreamId,
        seasonNumber,
        episodeNumber,
    },
    prepare: async () => {
        const url = await resolveUrl(cmd, episodeNumber);
        if (!url) throw new Error('Stalker episode URL was not resolved');
        return {
            ...identity,
            title,
            url,
            posterUrl,
            metadataSnapshot: createStalkerSeriesDownloadSnapshot(...),
            headers: {
                userAgent: playlist.userAgent,
                referer: playlist.referrer,
                origin: playlist.origin,
            },
            playlistName: playlist.title || 'Stalker Portal',
            playlistType: 'stalker',
            portalUrl: playlist.portalUrl,
            macAddress: playlist.macAddress,
        };
    },
};
```

Validate canonical ids and coordinates before returning the candidate. Do not
inject or call `DownloadsService` from the adapter. Run its focused spec;
expected: PASS.

- [ ] **Step 3: Wire StalkerSeriesViewComponent and remove legacy hashing**

Add a computed `episodeDownloadAdapter` that snapshots the current playlist,
display item, language, series id, and wraps
`stalkerStore.fetchLinkToPlay()`. Bind it through `[downloadAdapter]`.

Delete:

- `(episodeDownloadRequested)` from the template;
- `downloadEpisode()` from the component;
- the component's `getEpisodeDownloadId()` and `hashString()` methods;
- the now-unused `DownloadsService` injection.

Update the stub and host tests to assert the adapter binding. Keep Stalker
playback behavior and URL resolution unchanged.

Run:

```bash
pnpm nx test portal-stalker-feature --runInBand \
  --testPathPatterns=stalker-series-download.adapter.spec.ts \
  --testPathPatterns=stalker-series-view.component.spec.ts
```

Expected: PASS, including the shared-playback-identifier regression.

- [ ] **Step 4: Commit the Stalker adapter**

```bash
git add libs/portal/stalker/feature/src/lib/stalker-series-view
git commit -m "fix(downloads): use canonical Stalker episode ids"
```

### Task 6: Convert SeasonContainer To Per-Episode And Season Actions

**Files:**

- Modify:
  `libs/ui/components/src/lib/season-container/season-container.component.ts`
- Modify:
  `libs/ui/components/src/lib/season-container/season-container.component.html`
- Modify:
  `libs/ui/components/src/lib/season-container/season-container.component.scss`
- Modify:
  `libs/ui/components/src/lib/season-container/season-container.component.spec.ts`
- Modify:
  `libs/ui/components/src/lib/season-container/episode-utils.spec.ts`
- Delete:
  `libs/ui/components/src/lib/season-container/episode-download.util.ts`
- Modify: `tools/eslint/max-lines-baseline.mjs` only if regeneration removes
  the season container entry

- [ ] **Step 1: Replace old request-building tests with failing UI behavior tests**

Remove the old UI-owned Xtream/Stalker id tests from `episode-utils.spec.ts`;
keep only `episode-progress.util` coverage there. Extend the season component
spec with a real `SeasonDownloadCoordinator`, signal-backed
`DownloadsService` stub, `MatSnackBar` spy, and a simple adapter.

Add RED tests for:

```typescript
it('keeps a second episode downloadable while the first is pending', async () => {
    const first = createEpisode({ id: '101', episode_num: 1 });
    const second = createEpisode({ id: '102', episode_num: 2 });
    const deferred = createDeferred<ElectronBridgeDownloadStartResult>();
    downloadsServiceStub.startDownload.mockReturnValueOnce(deferred.promise);
    setDownloadableSeason([first, second]);

    clickDownload(101);
    fixture.detectChanges();

    expect(downloadButton(101).disabled).toBe(true);
    expect(downloadButton(102).disabled).toBe(false);
    deferred.resolve({ success: true, id: 1 });
    await fixture.whenStable();
});

it('shows Download season with the eligible count and truthful result', async () => {
    downloadsServiceStub.downloads.set([
        row({ xtreamId: 102, episodeNumber: 2, status: 'paused' }),
    ]);
    setDownloadableSeason([
        createEpisode({ id: '101', episode_num: 1 }),
        createEpisode({ id: '102', episode_num: 2 }),
        createEpisode({ id: '103', episode_num: 3 }),
    ]);

    const button = seasonDownloadButton();
    expect(button.textContent).toContain('DOWNLOADS.DOWNLOAD_SEASON');
    expect(button.getAttribute('aria-label')).toContain('2');
    button.click();
    await fixture.whenStable();

    expect(snackBar.open).toHaveBeenCalledWith(
        expect.stringContaining('added'),
        undefined,
        expect.any(Object)
    );
});
```

Also cover:

- initial list not loaded, loading, empty, zero eligible, and batch-running
  disabled states;
- no button in Web (`isAvailable=false`), provider-only
  (`downloadsEnabled=false`), or missing-adapter views;
- queued/downloading/local-pending disabled, paused Resume, completed available
  Play local, completed missing Download, and completed unknown blocked;
- resume by managed row id and local play by the coordinate-aware matched row;
- duplicate rapid clicks dispatch once;
- generic individual failure snackbar without raw backend text;
- equal action names and disabled behavior after switching to list view;
- batch snapshots the selected season before async preparation.

Run:

```bash
pnpm nx test components --runInBand \
  --testPathPatterns=season-container.component.spec.ts \
  --testPathPatterns=episode-utils.spec.ts
```

Expected: FAIL because the adapter input, per-item state, and season action do
not exist.

- [ ] **Step 2: Replace provider branching with the shared adapter input**

In the component remove `xtreamDownloadContext`,
`downloadMetadataContext`, and `episodeDownloadRequested`. Add:

```typescript
readonly downloadAdapter =
    input<SeasonEpisodeDownloadAdapter | null>(null);
readonly batchRunning = signal(false);

readonly downloadPresentationVisible = computed(
    () =>
        this.downloadsService.isAvailable() &&
        this.downloadsEnabled() &&
        this.downloadAdapter() !== null
);

readonly eligibleEpisodeCount = computed(() => {
    const adapter = this.downloadAdapter();
    if (!adapter || !this.downloadsService.hasLoadedDownloads()) return 0;
    return this.selectedSeasonEpisodes().filter((episode) => {
        const candidate = adapter.createCandidate(
            episode,
            this.selectedSeason()
        );
        return candidate ? this.coordinator.isEligible(candidate) : false;
    }).length;
});

readonly seasonDownloadDisabled = computed(
    () =>
        this.isLoading() ||
        this.batchRunning() ||
        !this.downloadsService.hasLoadedDownloads() ||
        this.selectedSeasonEpisodes().length === 0 ||
        this.eligibleEpisodeCount() === 0
);
```

Create focused helpers `candidateFor()`, `downloadFor()`, and
`episodeDownloadState()` so both grid and list branches use the same state.
The presentation-state mapping must be:

```text
local pending / queued / downloading -> pending disabled action
paused                              -> Resume using row.id
completed + available              -> Play local using row.filePath
completed + unknown/not-applicable -> blocked disabled action
failed/canceled/completed missing/no row -> Download
invalid candidate                  -> blocked disabled action
```

`downloadEpisode()` calls `coordinator.enqueueOne()`. On `failed`, show only
the localized generic error. On `added` or `skipped`, rely on the visible
state and show no individual success snackbar.

- [ ] **Step 3: Add the season batch action and aggregate snackbar**

Implement:

```typescript
async downloadSelectedSeason(): Promise<void> {
    if (this.batchRunning()) return;
    const adapter = this.downloadAdapter();
    const seasonKey = this.selectedSeason();
    if (!adapter || !seasonKey) return;

    const snapshot = [...this.selectedSeasonEpisodes()];
    const candidates = snapshot.map((episode) =>
        adapter.createCandidate(episode, seasonKey)
    );
    this.batchRunning.set(true);
    try {
        const result = await this.coordinator.enqueueSeason(candidates);
        const key = result.failed
            ? 'DOWNLOADS.SEASON_QUEUE_RESULT_WITH_FAILURES'
            : 'DOWNLOADS.SEASON_QUEUE_RESULT';
        this.snackBar.open(this.translate.instant(key, result), undefined, {
            duration: 5000,
        });
    } finally {
        this.batchRunning.set(false);
    }
}
```

Render the Material stroked button immediately before the existing view
toggle:

```html
@if (downloadPresentationVisible()) {
<button
    mat-stroked-button
    data-test-id="download-season"
    (click)="downloadSelectedSeason()"
    [disabled]="seasonDownloadDisabled()"
    [attr.aria-label]="
            'DOWNLOADS.DOWNLOAD_SEASON_ARIA'
                | translate: { count: eligibleEpisodeCount() }
        "
>
    @if (batchRunning()) {
    <mat-spinner diameter="18" aria-hidden="true" />
    {{ 'DOWNLOADS.ADDING_TO_QUEUE' | translate }} } @else {
    <mat-icon aria-hidden="true">download</mat-icon>
    {{ 'DOWNLOADS.DOWNLOAD_SEASON' | translate: { count: eligibleEpisodeCount()
    } }} }
</button>
}
```

Give every grid/list episode action a localized `aria-label` and stable
`data-test-id="episode-download-<id>"`. Use native/Material `disabled`, not
CSS-only blocking.

- [ ] **Step 4: Apply responsive, theme-safe styling without redesigning cards**

Wrap the season action and toggle in `.section-header__actions`. Add only
layout/alignment rules:

```scss
.section-header__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
}

.season-download-button {
    min-height: 36px;

    mat-spinner {
        display: inline-block;
        margin-inline-end: 8px;
    }
}

@media (max-width: 560px) {
    .section-header {
        align-items: flex-start;
        flex-wrap: wrap;
    }

    .section-header__actions {
        width: 100%;
        justify-content: space-between;
    }
}
```

Use existing Material system and `--app-*` tokens. Do not introduce new
hard-coded light/dark foreground or background colors.

- [ ] **Step 5: Delete obsolete shared provider code and verify the component**

Delete `episode-download.util.ts` after both adapters own request creation.
Remove all remaining references found by:

```bash
rg -n "episode-download\.util|getEpisodeDownloadId|isStalkerEpisode|SeasonContainerXtreamDownloadContext|SeasonContainerDownloadMetadataContext|episodeDownloadRequested" \
  libs/ui/components libs/portal/xtream libs/portal/stalker
```

Expected: no matches except intentional historical text in specs, which should
also be removed.

Run:

```bash
pnpm nx test components --runInBand \
  --testPathPatterns=season-container.component.spec.ts \
  --testPathPatterns=episode-utils.spec.ts
pnpm nx lint components
node tools/eslint/generate-max-lines-baseline.mjs
git diff -- tools/eslint/max-lines-baseline.mjs
```

Expected: component tests and lint PASS. The regenerated max-lines baseline
must not gain any file. Commit a removed season-container entry only if the
refactored production TypeScript is now under the enforced 400-line count;
otherwise restore the unchanged generated file.

- [ ] **Step 6: Commit the shared UI behavior**

```bash
git add libs/ui/components/src/lib/season-container \
  tools/eslint/max-lines-baseline.mjs
git commit -m "feat(downloads): add selected season queue action"
```

Omit `tools/eslint/max-lines-baseline.mjs` from `git add` when it is unchanged.

### Task 7: Localize The New Actions And Feedback

**Files:**

- Modify: `apps/web/src/assets/i18n/ar.json`
- Modify: `apps/web/src/assets/i18n/ary.json`
- Modify: `apps/web/src/assets/i18n/by.json`
- Modify: `apps/web/src/assets/i18n/de.json`
- Modify: `apps/web/src/assets/i18n/el.json`
- Modify: `apps/web/src/assets/i18n/en.json`
- Modify: `apps/web/src/assets/i18n/es.json`
- Modify: `apps/web/src/assets/i18n/fr.json`
- Modify: `apps/web/src/assets/i18n/hu.json`
- Modify: `apps/web/src/assets/i18n/it.json`
- Modify: `apps/web/src/assets/i18n/ja.json`
- Modify: `apps/web/src/assets/i18n/ko.json`
- Modify: `apps/web/src/assets/i18n/nl.json`
- Modify: `apps/web/src/assets/i18n/pl.json`
- Modify: `apps/web/src/assets/i18n/pt.json`
- Modify: `apps/web/src/assets/i18n/ru.json`
- Modify: `apps/web/src/assets/i18n/tr.json`
- Modify: `apps/web/src/assets/i18n/zh.json`
- Modify: `apps/web/src/assets/i18n/zhtw.json`

- [ ] **Step 1: Add the English keys and observe the drift gate fail**

Add these string keys under `DOWNLOADS` in `en.json`:

```text
DOWNLOAD_SEASON
DOWNLOAD_SEASON_ARIA
ADDING_TO_QUEUE
EPISODE_DOWNLOAD_ARIA
EPISODE_DOWNLOAD_PENDING_ARIA
EPISODE_DOWNLOAD_FAILED
SEASON_QUEUE_RESULT
SEASON_QUEUE_RESULT_WITH_FAILURES
```

Use these exact source values:

```json
"DOWNLOAD_SEASON": "Download season ({{count}})",
"DOWNLOAD_SEASON_ARIA": "Download season, {{count}} episodes available",
"ADDING_TO_QUEUE": "Adding to queue…",
"EPISODE_DOWNLOAD_ARIA": "Download {{title}}",
"EPISODE_DOWNLOAD_PENDING_ARIA": "{{title}} is already in the download queue",
"EPISODE_DOWNLOAD_FAILED": "The episode could not be added to downloads.",
"SEASON_QUEUE_RESULT": "Added {{added}} · Skipped {{skipped}}",
"SEASON_QUEUE_RESULT_WITH_FAILURES": "Added {{added}} · Skipped {{skipped}} · Failed {{failed}}"
```

Run:

```bash
pnpm run i18n:check
```

Expected: FAIL with all 18 non-English locales reporting the eight missing
keys. This is the localization RED gate.

- [ ] **Step 2: Add all locale values**

Translate the eight English values naturally in every other listed locale.
Preserve interpolation tokens exactly. Run `pnpm run i18n:check` again.
Expected: PASS with zero missing and zero extra keys in every locale.

- [ ] **Step 3: Re-run the component tests with real English translations**

Load `en.json` into the component spec's translation service for the focused
accessible-name/result cases. Run:

```bash
pnpm nx test components --runInBand \
  --testPathPatterns=season-container.component.spec.ts
```

Expected: PASS with visible English labels and no raw translation keys.

- [ ] **Step 4: Commit localization**

```bash
git add apps/web/src/assets/i18n libs/ui/components/src/lib/season-container/season-container.component.spec.ts
git commit -m "feat(downloads): localize season queue feedback"
```

### Task 8: Add A Deterministic Xtream Series Download E2E

**Files:**

- Modify: `apps/xtream-mock-server/src/app/scenarios.ts`
- Modify: `apps/xtream-mock-server/src/app/server.ts`
- Modify: `apps/xtream-mock-server/src/app/server.spec.ts`
- Create:
  `apps/electron-backend-e2e/src/series-download-queue.e2e.ts`

- [ ] **Step 1: Drive a local slow-series fixture from a failing mock test**

Add a scenario option:

```typescript
/** Optional local media response reserved for download queue E2E. */
downloadStreamFixture?: 'slow-series';
```

Add a `downloadqueue:downloadqueue` scenario with one series category, four
items, one season, and four episodes per season. The server test must request a
series URL with those credentials and assert:

```typescript
expect(response.status).toBe(200);
expect(response.headers.get('content-type')).toContain('video/mp4');
expect(Number(response.headers.get('content-length'))).toBeGreaterThan(
    1024 * 1024
);
await response.body?.cancel();
```

Keep the existing test proving ordinary credentials still return the same 302
redirect.

Run:

```bash
pnpm nx test xtream-mock-server --runInBand \
  --testPathPatterns=server.spec.ts
```

Expected: FAIL because the local download stream is not implemented.

- [ ] **Step 2: Implement the bounded, cancellable slow response**

In `installStreamRoutes()`, inspect `getScenario(username, password)`. For
only `downloadStreamFixture === 'slow-series'` and only `/series/...`, return a
fixed-size local `video/mp4` response in small timed chunks. Clear the timer on
`request.close` and `response.close`; do not allocate the complete payload at
once and do not affect performance-control or ordinary redirect behavior.

Run the mock-server spec. Expected: PASS and no outbound request.

- [ ] **Step 3: Write the Electron UI-to-queue E2E**

The E2E must:

1. reset the Xtream mock;
2. fetch the deterministic series/category title with
   `fetchXtreamSeriesFixture(request, downloadQueueCredentials)`;
3. add the `downloadqueue` portal and wait for the workspace;
4. authorize `join(dataDir, 'series-downloads')` through the existing native
   dialog UI flow;
5. open Series, the deterministic category, and the first series detail;
6. click episode 1 and episode 2 download actions consecutively;
7. poll `window.electron.downloadsGetList()` until the rows show exactly one
   `downloading` and one `queued` episode;
8. assert the season button shows `(2)`, click it, and assert the aggregate
   snackbar reports `Added 2 · Skipped 2`;
9. poll until four unique episode rows exist in displayed episode order;
10. assert at most one row is `downloading`, all others are `queued`, the
    season button is disabled with count zero, and an additional wait does not
    increase the row count.

Use the new `data-test-id="episode-download-<id>"` and
`data-test-id="download-season"` selectors. Always close Electron in `finally`;
the slow server's connection cleanup must make shutdown deterministic.

Run:

```bash
pnpm nx show project electron-backend-e2e | rg "series-download-queue"
pnpm nx run electron-backend-e2e:e2e-ci--src/series-download-queue.e2e.ts
```

Expected: the inferred atomized target exists and the E2E passes. No Web E2E
is added because component coverage proves the Electron-only action is absent.
No Stalker UI E2E is added because its current mock resolves downloadable
episodes through the general fast playback transport; adapter, component, and
backend tests cover the Stalker identity regression without broadening that
mock.

- [ ] **Step 4: Commit mock and E2E coverage**

```bash
git add apps/xtream-mock-server/src/app \
  apps/electron-backend-e2e/src/series-download-queue.e2e.ts
git commit -m "test(downloads): cover series batch queue flow"
```

### Task 9: Document The Contract And Add The Release Note

**Files:**

- Modify: `docs/architecture/download-manager.md`
- Modify: `CLAUDE.md`
- Create: `.changes/downloads-season-queue.md`

- [ ] **Step 1: Load and follow the release-notes skill**

Read `.codex/skills/release-notes/SKILL.md` fully before creating the note.
The change is user-visible, so it must not use `type: internal` and must not be
skipped.

- [ ] **Step 2: Update canonical architecture documentation**

Add a focused “Series season queueing” subsection to
`docs/architecture/download-manager.md` covering:

```text
- one active transfer plus FIFO remains the backend invariant;
- SeasonDownloadCoordinator owns renderer pending and best-effort batching;
- adapters own provider URL/request preparation;
- episode.id is canonical for Xtream and normalized Stalker episodes;
- exact identity precedes legacy coordinate compatibility;
- active/paused/available rows skip, failed/canceled/missing-completed retry;
- DOWNLOADS_START remains the only start IPC and returns the optional stable
  already-in-progress reason.
```

Update the Download Manager section of `CLAUDE.md` with the same ownership and
identity boundary. Do not modify `AGENTS.md`: it does not currently enumerate
series download behavior, so no mirrored process or path claim changes.

- [ ] **Step 3: Add and validate the user-facing note**

Create:

```markdown
---
type: feature
area: downloads
---

Series downloads now let you queue several episodes in a row or add every available episode from the selected season. Already queued, paused, or downloaded episodes are skipped without duplicates, and the app reports the batch result.
```

The body is under 400 characters and contains no implementation jargon.

Run:

```bash
pnpm run release:notes:validate
pnpm exec prettier --check \
  docs/architecture/download-manager.md \
  CLAUDE.md \
  .changes/downloads-season-queue.md
```

Expected: PASS.

- [ ] **Step 4: Commit docs and release note**

```bash
git add docs/architecture/download-manager.md CLAUDE.md \
  .changes/downloads-season-queue.md
git commit -m "docs(downloads): describe season queueing"
```

### Task 10: Run The Full Verification Ladder

**Files:**

- Verify all files changed by Tasks 1–9

- [ ] **Step 1: Load verification-before-completion**

Read `~/.agents/skills/verification-before-completion/SKILL.md` fully and
follow its evidence requirements. Do not claim success from cached or earlier
test output.

- [ ] **Step 2: Run focused and full affected tests**

Run fresh:

```bash
pnpm nx test portal-shared-util
pnpm nx test portal-shared-data-access
pnpm nx test components
pnpm nx test portal-xtream-feature
pnpm nx test portal-stalker-feature
pnpm nx test services
pnpm nx test electron-backend
pnpm nx test xtream-mock-server
pnpm nx run electron-backend-e2e:e2e-ci--src/series-download-queue.e2e.ts
```

Expected: every command exits 0. The E2E proves one active transfer and FIFO
queued rows through the real renderer bridge.

- [ ] **Step 3: Run affected lint and type/build validation**

Run:

```bash
pnpm nx run-many --target=lint --projects=portal-shared-util,portal-shared-data-access,components,portal-xtream-feature,portal-stalker-feature,services,electron-backend,xtream-mock-server,electron-backend-e2e
pnpm nx build electron-backend
pnpm run release:notes:validate
pnpm exec prettier --check \
  docs/superpowers/specs/2026-08-01-season-download-queue-design.md \
  docs/superpowers/plans/2026-08-01-season-download-queue.md \
  docs/architecture/download-manager.md \
  CLAUDE.md \
  .changes/downloads-season-queue.md
```

Expected: PASS. Inspect `git diff --check` and confirm max-lines baseline gained
no entries.

- [ ] **Step 4: Perform the manual accessibility and theme pass**

Launch the Electron development app against the deterministic Xtream mock and
use CDP at `127.0.0.1:9222`. Check:

```text
- light and dark themes;
- desktop width and a narrow content width around 520 px;
- season action wrapping without clipping;
- keyboard focus order and visible focus rings;
- accessible names for season and grid/list episode actions;
- native disabled state for pending and zero-eligible actions;
- live-region snackbar text for success and partial failure;
- first episode pending does not disable another episode.
```

Capture screenshots only into `/tmp`; do not publish or add them to the repo.
If manual/CDP verification is not possible, record the exact blocker and rely
on the component accessibility assertions without claiming the manual pass.

- [ ] **Step 5: Self-review scope and repository state**

Run:

```bash
git diff master...HEAD --stat
git diff master...HEAD --check
git status --short
rg -n "TODO|TBD|placeholder" \
  libs/portal/shared/util/src/lib/downloads \
  libs/portal/shared/data-access/src/lib/downloads \
  libs/portal/xtream/feature/src/lib/serial-details/xtream-series-download.adapter.ts \
  libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-download.adapter.ts \
  apps/electron-backend/src/app/events/database/download-request-identity.ts
```

Confirm the diff contains no batch IPC, concurrency setting, queue reordering,
schema migration, full-series action, multi-season selection, GitHub mutation,
or opportunistic redesign.

- [ ] **Step 6: Present completion without publishing**

Summarize:

- per-episode and season behavior delivered;
- files and architectural boundary changed;
- tests added/updated and every fresh validation result;
- light/dark/accessibility outcome;
- `docs/architecture/download-manager.md` and `CLAUDE.md` updates;
- `.changes/downloads-season-queue.md` addition;
- Stalker E2E omission reason from Task 8.

Do not push, create a PR, or edit GitHub issues. Offer those actions only if
the user explicitly authorizes them in a later message.
