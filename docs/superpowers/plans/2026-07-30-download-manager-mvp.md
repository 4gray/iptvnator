# Download Manager MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the desktop download manager's uniform card list with a truthful, theme-native active queue and completed-content library while preserving the existing Electron download contracts.

**Architecture:** Keep `DownloadsService.downloads` global and derive route scope, filters, search, queue partitions, and completed-series groups in a pure view-model module. Split the Angular page into a small smart container, queue and library presentational components, a downloaded-series dialog, and an isolated navigation service; all mutations continue through the existing service and Electron broadcasts remain authoritative.

**Tech Stack:** Angular 21.2 standalone components, signals and signal inputs/outputs, Angular Material, ngx-translate, Jest 30 with jest-preset-angular, Nx 22.7, Electron Playwright E2E, SCSS with IPTVnator theme tokens.

---

## File map

Create:

- `libs/portal/downloads/feature/jest.config.ts` — Jest project configuration.
- `libs/portal/downloads/feature/tsconfig.spec.json` — TypeScript test configuration.
- `libs/portal/downloads/feature/src/test-setup.ts` — strict Angular zone test environment.
- `libs/portal/downloads/feature/src/lib/download-manager.viewmodel.ts` — pure filtering, counting, sorting, grouping, and display metadata.
- `libs/portal/downloads/feature/src/lib/download-manager.viewmodel.spec.ts` — exhaustive pure model coverage.
- `libs/portal/downloads/feature/src/lib/download-actions.ts` — typed item/open action contracts shared by presentational children.
- `libs/portal/downloads/feature/src/lib/download-library-navigation.service.ts` — Xtream/Stalker detail route resolution extracted from the current container.
- `libs/portal/downloads/feature/src/lib/download-library-navigation.service.spec.ts` — route and defensive navigation tests.
- `libs/portal/downloads/feature/src/lib/download-queue.component.ts` — active/attention queue presentation and typed outputs.
- `libs/portal/downloads/feature/src/lib/download-queue.component.html` — semantic queue regions and action controls.
- `libs/portal/downloads/feature/src/lib/download-queue.component.scss` — compact responsive queue styling.
- `libs/portal/downloads/feature/src/lib/download-queue.component.spec.ts` — status/action/pending/accessibility tests.
- `libs/portal/downloads/feature/src/lib/download-library.component.ts` — movie, grouped-series, and fallback-episode card presentation.
- `libs/portal/downloads/feature/src/lib/download-library.component.html` — accessible poster grid and local actions.
- `libs/portal/downloads/feature/src/lib/download-library.component.scss` — `content-grid`-based responsive library styling.
- `libs/portal/downloads/feature/src/lib/download-library.component.spec.ts` — grouping-card and action tests.
- `libs/portal/downloads/feature/src/lib/downloaded-series-dialog.component.ts` — typed downloaded-series dialog surface.
- `libs/portal/downloads/feature/src/lib/downloaded-series-dialog.component.html` — concrete episode rows and actions.
- `libs/portal/downloads/feature/src/lib/downloaded-series-dialog.component.scss` — dialog layout.
- `libs/portal/downloads/feature/src/lib/downloaded-series-dialog.component.spec.ts` — episode identity and output tests.
- `.changes/downloads-manager-mvp.md` — user-facing release note.

Modify:

- `libs/services/src/lib/downloads.service.ts` and `.spec.ts` — make list loading global-only and retain latest-request protection.
- `libs/workspace/shell/feature/src/lib/workspace-shell/services/workspace-shell.facade.{ts,spec.ts}` — expose the global active count.
- `libs/workspace/shell/feature/src/lib/workspace-shell/workspace-shell.component.{html,spec.ts}` — pass the global count to the header.
- `libs/workspace/shell/feature/src/lib/workspace-shell/components/workspace-shell-header/workspace-shell-header.component.{ts,html,scss,spec.ts}` — render the numeric global badge.
- `libs/portal/downloads/feature/project.json` — add the Jest target.
- `tools/coverage/coverage-policy.json` — move the feature out of the “no test target” exclusion.
- `libs/portal/downloads/feature/src/lib/downloads.component.{ts,html,scss}` — reduce to orchestration, fixed header, state switching, and action handling.
- `apps/web/src/assets/i18n/*.json` — add the same complete download-manager key set in every locale, with authored English and Russian copy and explicit English fallback copy where a translation is unavailable.
- `apps/electron-backend-e2e/src/downloads.e2e.ts` — use semantic/test-id locators and cover the new workflow.
- `docs/architecture/download-manager.md` — document global store ownership, scoped derivation, queue/library model, grouping, and file-retention semantics.
- `CLAUDE.md` only if its current download-manager description becomes stale.

## Task 1: Enforce the global download-store invariant

**Files:**

- Modify: `libs/services/src/lib/downloads.service.spec.ts`
- Modify: `libs/services/src/lib/downloads.service.ts`
- Modify: `libs/workspace/shell/feature/src/lib/workspace-shell/services/workspace-shell.facade.spec.ts`
- Modify: `libs/workspace/shell/feature/src/lib/workspace-shell/services/workspace-shell.facade.ts`
- Modify: `libs/workspace/shell/feature/src/lib/workspace-shell/workspace-shell.component.spec.ts`
- Modify: `libs/workspace/shell/feature/src/lib/workspace-shell/workspace-shell.component.html`
- Modify: `libs/workspace/shell/feature/src/lib/workspace-shell/components/workspace-shell-header/workspace-shell-header.component.spec.ts`
- Modify: `libs/workspace/shell/feature/src/lib/workspace-shell/components/workspace-shell-header/workspace-shell-header.component.ts`
- Modify: `libs/workspace/shell/feature/src/lib/workspace-shell/components/workspace-shell-header/workspace-shell-header.component.html`
- Modify: `libs/workspace/shell/feature/src/lib/workspace-shell/components/workspace-shell-header/workspace-shell-header.component.scss`

- [ ] **Step 1: Write a failing service test**

Replace the playlist-scoped loading assertion with a no-argument contract:

```ts
it('always loads the global download list', async () => {
    const item = createDownload(1, 'playlist-1');
    const electron = {
        downloadsGetList: jest.fn(async () => [item]),
    };
    testWindow.electron = electron;
    const service = createService();

    await service.loadDownloads();

    expect(electron.downloadsGetList).toHaveBeenCalledWith();
    expect(service.downloads()).toEqual([item]);
});
```

Keep the overlapping-request test, but invoke `loadDownloads()` twice and
assert that a late first global response cannot replace the second response.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm nx test services --runInBand --testPathPatterns=downloads.service.spec.ts
```

Expected: FAIL because `downloadsGetList` currently receives one explicit
`undefined` argument.

- [ ] **Step 3: Make list loading global-only**

Change the public method and bridge invocation to:

```ts
async loadDownloads(): Promise<void> {
    if (!this.isAvailable()) return;

    const requestId = ++this.loadDownloadsRequestId;
    this._isLoadingDownloads.set(true);
    try {
        const list = await window.electron.downloadsGetList();
        if (requestId === this.loadDownloadsRequestId) {
            this.downloads.set(list);
            this._hasLoadedDownloads.set(true);
        }
    } catch (error) {
        console.error('[DownloadsService] Error loading downloads:', error);
        if (requestId === this.loadDownloadsRequestId) {
            this._hasLoadedDownloads.set(true);
        }
    } finally {
        if (requestId === this.loadDownloadsRequestId) {
            this._isLoadingDownloads.set(false);
        }
    }
}
```

Do not change `clearCompleted(playlistId?)`; clearing remains route-scoped.

- [ ] **Step 4: Run service tests and verify GREEN**

Run:

```bash
pnpm nx test services --runInBand --testPathPatterns=downloads.service.spec.ts
```

Expected: PASS with the global call and stale-response test both covered.

- [ ] **Step 5: Write failing shell count tests**

Set `DownloadsService.activeCount` to a signal with value `3` and prove:

```ts
expect(facade.activeDownloadsCount()).toBe(3);
expect(facade.hasActiveDownloads()).toBe(true);
```

In the header spec, set `activeDownloadsCount` to `3` and assert the download
shortcut renders a visible `3` badge; set it to `0` and assert the badge is
absent. In the shell host spec, assert the facade count is bound through to the
header stub.

- [ ] **Step 6: Run shell tests and verify RED**

```bash
pnpm nx test workspace-shell-feature --runInBand \
  --testPathPatterns='workspace-shell.facade.spec.ts|workspace-shell-header.component.spec.ts|workspace-shell.component.spec.ts'
```

Expected: FAIL because the shell currently exposes only a boolean activity
indicator.

- [ ] **Step 7: Render the global numeric badge**

Add:

```ts
readonly activeDownloadsCount = computed(() =>
    this.supportsDownloads ? this.downloadsService.activeCount() : 0
);
readonly hasActiveDownloads = computed(
    () => this.activeDownloadsCount() > 0
);
```

Pass `[activeDownloadsCount]="facade.activeDownloadsCount()"` through the
shell, declare `readonly activeDownloadsCount = input(0)` on the header, and
render:

```html
@if (activeDownloadsCount() > 0) {
    <span
        class="download-count-badge"
        data-test-id="global-download-count"
        aria-hidden="true"
    >
        {{ activeDownloadsCount() }}
    </span>
}
```

Style it with the existing selection/on-selection tokens and preserve the
current activity animation.

- [ ] **Step 8: Run shell tests and verify GREEN**

Run the focused shell command from Step 6. Expected: PASS.

- [ ] **Step 9: Commit the invariant**

```bash
git add libs/services/src/lib/downloads.service.ts \
  libs/services/src/lib/downloads.service.spec.ts \
  libs/workspace/shell/feature/src/lib/workspace-shell
git commit -m "fix(downloads): keep renderer download state global"
```

## Task 2: Add the feature test target and pure view model

**Files:**

- Create: `libs/portal/downloads/feature/jest.config.ts`
- Create: `libs/portal/downloads/feature/tsconfig.spec.json`
- Create: `libs/portal/downloads/feature/src/test-setup.ts`
- Modify: `libs/portal/downloads/feature/project.json`
- Modify: `tools/coverage/coverage-policy.json`
- Create: `libs/portal/downloads/feature/src/lib/download-manager.viewmodel.spec.ts`
- Create: `libs/portal/downloads/feature/src/lib/download-manager.viewmodel.ts`

- [ ] **Step 1: Configure the test target**

Mirror `portal-catalog-feature` with this project identity:

```ts
// jest.config.ts
export default {
    displayName: 'portal-downloads-feature',
    preset: '../../../../jest.preset.js',
    setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
    coverageDirectory: '../../../../coverage/libs/portal/downloads/feature',
    transform: {
        '^.+\\.(ts|mjs|js|html)$': [
            'jest-preset-angular',
            {
                tsconfig: '<rootDir>/tsconfig.spec.json',
                stringifyContentPathRegex: '\\.(html|svg)$',
            },
        ],
    },
    transformIgnorePatterns: ['node_modules/(?!.*\\.mjs$)'],
    snapshotSerializers: [
        'jest-preset-angular/build/serializers/no-ng-attributes',
        'jest-preset-angular/build/serializers/ng-snapshot',
        'jest-preset-angular/build/serializers/html-comment',
    ],
};
```

```ts
// src/test-setup.ts
import { setupZoneTestEnv } from 'jest-preset-angular/setup-env/zone';

setupZoneTestEnv({
    errorOnUnknownElements: true,
    errorOnUnknownProperties: true,
});
```

Add the same `test` executor/options as
`libs/portal/catalog/feature/project.json`, add `tsconfig.spec.json` with
`jest`/`node` types, and move `portal-downloads-feature` from `tierC` to
`tierA` with:

```json
{
    "name": "portal-downloads-feature",
    "root": "libs/portal/downloads/feature",
    "sourceRoot": "libs/portal/downloads/feature/src",
    "validationCommand": "pnpm nx test portal-downloads-feature",
    "e2eTags": ["@downloads", "@electron", "@persistence"]
}
```

- [ ] **Step 2: Write failing pure-model tests**

Use a `download(overrides)` fixture and cover these exact assertions:

```ts
expect(buildDownloadManagerViewModel(input).active.map((x) => x.item.id))
    .toEqual([oldestId, newestId]);
expect(model.attention.map((x) => x.item.id)).toEqual([failedId, canceledId]);
expect(model.library.map((x) => x.key)).toEqual([
    'series:playlist-a:42',
    'movie:9',
]);
expect(model.counts).toEqual({
    all: 5,
    movie: 2,
    series: 3,
    inProgress: 2,
});
expect(model.trackedBytes).toBe(
    scopedRows.reduce((sum, row) => sum + (row.bytesDownloaded ?? 0), 0)
);
```

Separate tests must prove:

- global versus `scopePlaylistId` rows;
- queued/downloading/paused versus failed/canceled versus completed;
- all/movie/series/in-progress semantics;
- counts do not change with search;
- title, derived series title, source, `SxxExx`, and error search;
- ascending queue order with `id` tie-break;
- descending library order with stable key tie-break;
- grouping by `playlistId + positive safe-integer seriesXtreamId`;
- cross-playlist provider IDs never merge;
- zero, negative, unsafe, or absent series IDs create individual episode cards;
- standardized series title extraction and legacy fallback;
- newest valid poster selection;
- season range, episode ordering, and aggregate bytes.

- [ ] **Step 3: Run the feature test and verify RED**

Run:

```bash
pnpm nx test portal-downloads-feature --runInBand --testPathPatterns=download-manager.viewmodel.spec.ts
```

Expected: FAIL because `download-manager.viewmodel.ts` does not exist.

- [ ] **Step 4: Implement the pure API**

Export this stable surface:

```ts
export type DownloadFilterId = 'all' | 'movie' | 'series' | 'in-progress';

export interface DownloadListItemViewModel {
    readonly item: DownloadItem;
    readonly episodeLabel: string;
    readonly seriesTitle: string;
    readonly sourceName: string;
}

export interface DownloadMovieCardViewModel {
    readonly kind: 'movie';
    readonly key: string;
    readonly item: DownloadItem;
    readonly newestTimestamp: number;
    readonly sourceName: string;
    readonly trackedBytes: number;
}

export interface DownloadEpisodeCardViewModel {
    readonly kind: 'episode';
    readonly key: string;
    readonly item: DownloadItem;
    readonly newestTimestamp: number;
    readonly sourceName: string;
    readonly trackedBytes: number;
    readonly episodeLabel: string;
}

export interface DownloadSeriesCardViewModel {
    readonly kind: 'series';
    readonly key: string;
    readonly representative: DownloadItem;
    readonly members: readonly DownloadItem[];
    readonly seriesXtreamId: number;
    readonly title: string;
    readonly posterUrl?: string;
    readonly newestTimestamp: number;
    readonly sourceName: string;
    readonly trackedBytes: number;
    readonly firstSeason?: number;
    readonly lastSeason?: number;
}

export type DownloadLibraryEntity =
    | DownloadMovieCardViewModel
    | DownloadEpisodeCardViewModel
    | DownloadSeriesCardViewModel;

export interface DownloadManagerViewModel {
    readonly scopedItems: readonly DownloadItem[];
    readonly active: readonly DownloadListItemViewModel[];
    readonly attention: readonly DownloadListItemViewModel[];
    readonly library: readonly DownloadLibraryEntity[];
    readonly counts: {
        readonly all: number;
        readonly movie: number;
        readonly series: number;
        readonly inProgress: number;
    };
    readonly activeCount: number;
    readonly trackedBytes: number;
    readonly hasClearable: boolean;
}

export function buildDownloadManagerViewModel(options: {
    downloads: readonly DownloadItem[];
    playlists: readonly Pick<Playlist, '_id' | 'title'>[];
    scopePlaylistId?: string;
    filter: DownloadFilterId;
    searchTerm?: string;
}): DownloadManagerViewModel;

export function normalizeDownloadFilter(value: string): DownloadFilterId {
    return value === 'movie' ||
        value === 'series' ||
        value === 'in-progress'
        ? value
        : 'all';
}
```

Normalize invalid timestamps to zero, use `Number.isSafeInteger(id) && id > 0`
for grouping, count only queued/downloading rows in `activeCount`, and use
deterministic stable keys in every final sort.

- [ ] **Step 5: Run pure tests and verify GREEN**

Run:

```bash
pnpm nx test portal-downloads-feature --runInBand --testPathPatterns=download-manager.viewmodel.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Refactor under green**

Keep the production model below 300 non-blank/non-comment lines by extracting
small private helpers only inside the same module. Re-run the focused test.

- [ ] **Step 7: Commit the model**

```bash
git add libs/portal/downloads/feature tools/coverage/coverage-policy.json
git commit -m "feat(downloads): derive queue and library view model"
```

## Task 3: Extract and test content navigation

**Files:**

- Create: `libs/portal/downloads/feature/src/lib/download-library-navigation.service.spec.ts`
- Create: `libs/portal/downloads/feature/src/lib/download-library-navigation.service.ts`
- Modify later: `libs/portal/downloads/feature/src/lib/downloads.component.ts`

- [ ] **Step 1: Write failing navigation tests**

Test a public API shaped as:

```ts
await navigation.open(item);
expect(router.navigate).toHaveBeenCalledWith([
    '/workspace',
    'xtreams',
    item.playlistId,
    'series',
    '7',
    String(item.seriesXtreamId),
]);
```

Cover Xtream VOD, Xtream series, Stalker recent navigation state, missing
playlist, missing IDs, and missing category fallback to the collection route.
Assert `canOpen(item, availablePlaylistIds)` is false for absent source IDs.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
pnpm nx test portal-downloads-feature --runInBand --testPathPatterns=download-library-navigation.service.spec.ts
```

Expected: FAIL because the service is absent.

- [ ] **Step 3: Move existing navigation logic without changing routes**

Create an injectable class:

```ts
@Injectable()
export class DownloadLibraryNavigationService {
    private readonly router = inject(Router);
    private readonly db = inject(DatabaseService);
    private readonly playlists = inject(PlaylistsService);

    canOpen(item: DownloadItem, playlistIds: ReadonlySet<string>): boolean {
        return playlistIds.has(item.playlistId) && this.targetId(item) !== null;
    }

    async open(item: DownloadItem): Promise<boolean> {
        const targetId = this.targetId(item);
        if (targetId === null) return false;

        const source = await this.resolveSourceType(item.playlistId);
        if (!source) return false;

        if (source === 'xtream') {
            await this.openXtreamItem(item, targetId);
        } else {
            await this.openStalkerItem(item, targetId);
        }
        return true;
    }

    private targetId(item: DownloadItem): number | null {
        const raw =
            item.contentType === 'episode'
                ? (item.seriesXtreamId ?? item.xtreamId)
                : item.xtreamId;
        const id = Number(raw);
        return Number.isFinite(id) ? id : null;
    }

    private route(
        source: 'xtream' | 'stalker',
        playlistId: string,
        segments: Array<string | number>
    ): Array<string | number> {
        return [
            '/workspace',
            source === 'stalker' ? 'stalker' : 'xtreams',
            playlistId,
            ...segments,
        ];
    }

    private async resolveSourceType(
        playlistId: string
    ): Promise<'xtream' | 'stalker' | null> {
        try {
            const playlist = await firstValueFrom(
                this.playlists.getPlaylistById(playlistId)
            );
            if (!playlist) return null;
            return playlist.portalUrl && playlist.macAddress
                ? 'stalker'
                : 'xtream';
        } catch {
            return null;
        }
    }

    private async openXtreamItem(
        item: DownloadItem,
        targetId: number
    ): Promise<void> {
        const kind = item.contentType === 'episode' ? 'series' : 'vod';
        const content = await this.db.getContentByXtreamId(
            targetId,
            item.playlistId
        );
        const categoryId = content?.category_id;
        const segments =
            categoryId === null || categoryId === undefined
                ? [kind]
                : [kind, String(categoryId), String(targetId)];
        await this.router.navigate(
            this.route('xtream', item.playlistId, segments)
        );
    }

    private normalizePortalItemId(value: unknown): string {
        const raw = String(value ?? '').trim();
        return raw.includes(':') ? raw.split(':')[0] : raw;
    }

    private stalkerCategory(
        value: unknown,
        fallback: 'vod' | 'series'
    ): 'vod' | 'series' | 'itv' {
        const normalized = String(value ?? '').toLowerCase();
        if (normalized === 'movie') return 'vod';
        return normalized === 'vod' ||
            normalized === 'series' ||
            normalized === 'itv'
            ? normalized
            : fallback;
    }

    private async stalkerOpenState(
        item: DownloadItem,
        targetId: number,
        fallback: 'vod' | 'series'
    ): Promise<Record<string, unknown>> {
        try {
            const recent = (await firstValueFrom(
                this.playlists.getPortalRecentlyViewed(item.playlistId)
            )) as Array<Record<string, unknown>>;
            const expected = String(targetId);
            const matched = recent.find((candidate) =>
                ['id', 'movie_id', 'series_id', 'stream_id'].some(
                    (key) =>
                        this.normalizePortalItemId(candidate[key]) === expected
                )
            );
            if (matched) {
                return {
                    ...matched,
                    id:
                        matched['id'] ??
                        matched['series_id'] ??
                        matched['movie_id'] ??
                        expected,
                    category_id: this.stalkerCategory(
                        matched['category_id'],
                        fallback
                    ),
                    title: matched['title'] ?? item.title,
                    name: matched['name'] ?? matched['o_name'] ?? item.title,
                };
            }
        } catch {
            // The route can still open from the persisted download metadata.
        }
        return {
            id: String(targetId),
            category_id: fallback,
            title: item.title,
            name: item.title,
            o_name: item.title,
            cover: item.posterUrl,
            logo: item.posterUrl,
        };
    }

    private async openStalkerItem(
        item: DownloadItem,
        targetId: number
    ): Promise<void> {
        const fallback = item.contentType === 'episode' ? 'series' : 'vod';
        const openRecentItem = await this.stalkerOpenState(
            item,
            targetId,
            fallback
        );
        await this.router.navigate(
            this.route('stalker', item.playlistId, ['recent']),
            { state: { openRecentItem } }
        );
    }
}
```

Provide it on `DownloadsComponent`; do not place it in the root injector.

- [ ] **Step 4: Run and verify GREEN**

Run the focused spec and then:

```bash
pnpm nx test portal-downloads-feature --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit the extraction**

```bash
git add libs/portal/downloads/feature/src/lib/download-library-navigation.service.*
git commit -m "refactor(downloads): isolate library navigation"
```

## Task 4: Build the active and attention queue with TDD

**Files:**

- Create: `libs/portal/downloads/feature/src/lib/download-actions.ts`
- Create: `libs/portal/downloads/feature/src/lib/download-queue.component.spec.ts`
- Create: `libs/portal/downloads/feature/src/lib/download-queue.component.ts`
- Create: `libs/portal/downloads/feature/src/lib/download-queue.component.html`
- Create: `libs/portal/downloads/feature/src/lib/download-queue.component.scss`

- [ ] **Step 1: Define the wished-for typed event contract in the failing spec**

```ts
export type DownloadItemActionType =
    | 'cancel'
    | 'copy-url'
    | 'pause'
    | 'play'
    | 'remove'
    | 'resume'
    | 'retry'
    | 'reveal';

export interface DownloadItemAction {
    readonly type: DownloadItemActionType;
    readonly item: DownloadItem;
}
```

Render one row for each status and assert:

- queued/downloading emit pause and cancel;
- paused emits resume, cancel, and remove;
- failed/canceled emit retry and remove;
- Copy URL remains reachable from the overflow menu;
- pending IDs disable every command on that item;
- nested controls never emit `openRequested`;
- title/artwork buttons emit `openRequested`;
- progress has determinate/indeterminate mode and an accessible label;
- status text and icon both render.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm nx test portal-downloads-feature --runInBand --testPathPatterns=download-queue.component.spec.ts
```

Expected: FAIL because the component is absent.

- [ ] **Step 3: Implement signal-based inputs and outputs**

```ts
export class DownloadQueueComponent {
    readonly activeItems = input.required<readonly DownloadListItemViewModel[]>();
    readonly attentionItems = input.required<readonly DownloadListItemViewModel[]>();
    readonly pendingIds = input<ReadonlySet<number>>(new Set());
    readonly itemAction = output<DownloadItemAction>();
    readonly openRequested = output<DownloadItem>();

    emit(type: DownloadItemActionType, item: DownloadItem): void {
        this.itemAction.emit({ type, item });
    }

    isPending(id: number): boolean {
        return this.pendingIds().has(id);
    }
}
```

Use real buttons, `mat-menu`, translated names, stable
`data-test-id="download-queue-item-<id>"`, and semantic named sections for
`Downloading now` and `Needs attention`.

- [ ] **Step 4: Run and verify GREEN**

Run the focused spec. Expected: PASS with no unknown-element/property errors.

- [ ] **Step 5: Commit the queue**

```bash
git add libs/portal/downloads/feature/src/lib/download-actions.ts \
  libs/portal/downloads/feature/src/lib/download-queue.component.*
git commit -m "feat(downloads): add active download queue"
```

## Task 5: Build the completed library and series dialog with TDD

**Files:**

- Create: `libs/portal/downloads/feature/src/lib/download-library.component.spec.ts`
- Create: `libs/portal/downloads/feature/src/lib/download-library.component.ts`
- Create: `libs/portal/downloads/feature/src/lib/download-library.component.html`
- Create: `libs/portal/downloads/feature/src/lib/download-library.component.scss`
- Create: `libs/portal/downloads/feature/src/lib/downloaded-series-dialog.component.spec.ts`
- Create: `libs/portal/downloads/feature/src/lib/downloaded-series-dialog.component.ts`
- Create: `libs/portal/downloads/feature/src/lib/downloaded-series-dialog.component.html`
- Create: `libs/portal/downloads/feature/src/lib/downloaded-series-dialog.component.scss`

- [ ] **Step 1: Write failing library-card tests**

Set `entities` with one movie, one grouped series, and one invalid-ID episode.
Assert:

```ts
expect(movieCard.getAttribute('data-test-id')).toBe('download-library-movie-9');
expect(seriesCard.textContent).toContain('3 episodes');
expect(seriesCard.textContent).toContain('Seasons 1–2');
expect(fallbackEpisodeCard.textContent).toContain('S02E04');
```

Also prove:

- movie Play/Show in folder/Copy URL/Remove emit the concrete item;
- grouped series artwork/title emits `seriesOpened` with its representative;
- `N episodes` emits `episodesOpened` with the group;
- the fallback episode has local actions but no series navigation control;
- pending item IDs disable local file actions;
- broken artwork switches to the semantic placeholder once;
- keyboard users can activate the same real buttons as pointer users.

- [ ] **Step 2: Run library spec and verify RED**

Run the focused library spec. Expected: FAIL because the component is absent.

- [ ] **Step 3: Implement the library**

Use:

```ts
export class DownloadLibraryComponent {
    readonly entities = input.required<readonly DownloadLibraryEntity[]>();
    readonly pendingIds = input<ReadonlySet<number>>(new Set());
    readonly itemAction = output<DownloadItemAction>();
    readonly seriesOpened = output<DownloadItem>();
    readonly episodesOpened = output<DownloadSeriesCardViewModel>();
    readonly failedArtwork = signal<ReadonlySet<string>>(new Set());
}
```

In SCSS, import the canonical forwarder:

```scss
@use '../../../../shared/ui/src/lib/styles/content-grid' as grid;

.download-library__grid {
    @include grid.content-grid(
        $min-width: min(100%, 168px),
        $gap: clamp(12px, 1.5vw, 20px)
    );
}
```

Use only existing `--app-*` and `--mat-sys-*` tokens.

- [ ] **Step 4: Run library spec and verify GREEN**

Expected: PASS.

- [ ] **Step 5: Write failing downloaded-series dialog tests**

Provide `MAT_DIALOG_DATA` with a grouped series and assert member order,
episode identity in every accessible action name, and concrete
Play/Reveal/Copy/Remove outputs.

- [ ] **Step 6: Run dialog spec and verify RED**

Expected: FAIL because the dialog is absent.

- [ ] **Step 7: Implement the dialog**

```ts
export class DownloadedSeriesDialogComponent {
    readonly group = inject<DownloadSeriesCardViewModel>(MAT_DIALOG_DATA);
    readonly itemAction = output<DownloadItemAction>();
}
```

Let `MatDialogModule` own focus trap, Escape, and focus restoration. The
dialog never injects `DownloadsService`, Router, snackbars, or confirm dialogs.

- [ ] **Step 8: Run dialog and library specs and verify GREEN**

Expected: PASS.

- [ ] **Step 9: Commit the ready-to-watch surface**

```bash
git add libs/portal/downloads/feature/src/lib/download-library.component.* \
  libs/portal/downloads/feature/src/lib/downloaded-series-dialog.component.*
git commit -m "feat(downloads): add ready-to-watch library"
```

## Task 6: Rebuild the smart page and honest interactions

**Files:**

- Create: `libs/portal/downloads/feature/src/lib/downloads.component.spec.ts`
- Modify: `libs/portal/downloads/feature/src/lib/downloads.component.ts`
- Modify: `libs/portal/downloads/feature/src/lib/downloads.component.html`
- Modify: `libs/portal/downloads/feature/src/lib/downloads.component.scss`
- Modify: `apps/web/src/assets/i18n/*.json`

- [ ] **Step 1: Write failing container integration tests**

Provide signal-backed fakes for downloads, playlists, collection context, and
route params. Assert:

- the container calls global `loadDownloads()` with no playlist argument;
- a scoped route derives only matching rows while the root service signal
  remains unchanged;
- page active count is scoped while `DownloadsService.activeCount` stays global;
- `?q=` and shared category selection feed the pure model;
- inline All/Movies/Series/In progress buttons update the shared context;
- the header's tracked byte summary ignores search/filter but honors scope;
- completed removal opens finalized-file-retained copy;
- paused/failed/canceled removal opens retained-partial-deleted copy;
- clear finished copy describes both finalized and partial outcomes;
- dialog episode actions flow back through the same smart action dispatcher;
- an item ID remains pending until its async service operation settles;
- failures use the existing translated snackbar path.

- [ ] **Step 2: Run the container spec and verify RED**

Run:

```bash
pnpm nx test portal-downloads-feature --runInBand --testPathPatterns=downloads.component.spec.ts
```

Expected: FAIL against the current monolithic component.

- [ ] **Step 3: Replace the container with computed orchestration**

The class keeps this shape:

```ts
@Component({
    selector: 'app-downloads',
    providers: [DownloadLibraryNavigationService],
    imports: [
        DownloadLibraryComponent,
        DownloadQueueComponent,
        EmptyStateComponent,
        MatButtonModule,
        MatDialogModule,
        MatIcon,
        MatTooltip,
        TranslatePipe,
    ],
    templateUrl: './downloads.component.html',
    styleUrl: './downloads.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DownloadsComponent {
    readonly pendingIds = signal<ReadonlySet<number>>(new Set());
    readonly model = computed(() =>
        buildDownloadManagerViewModel({
            downloads: this.downloadsService.downloads(),
            playlists: this.playlistItems(),
            scopePlaylistId: this.playlistId() || undefined,
            filter: normalizeDownloadFilter(this.selectedCategoryId()),
            searchTerm: this.searchTerm(),
        })
    );
}
```

Delete the old card rendering and move all source route details to
`DownloadLibraryNavigationService`. Keep `DownloadsService.downloads` global;
route scope exists only in `model`.

- [ ] **Step 4: Implement one pending action dispatcher**

Use one `runAction({type, item})` switch. For async operations:

```ts
private async withPending(
    itemId: number,
    operation: () => Promise<{ success: boolean; error?: string }>
): Promise<void> {
    if (this.pendingIds().has(itemId)) return;
    this.pendingIds.update((ids) => new Set(ids).add(itemId));
    try {
        const result = await operation();
        if (!result.success) this.showActionError(result.error);
    } finally {
        this.pendingIds.update((ids) => {
            const next = new Set(ids);
            next.delete(itemId);
            return next;
        });
    }
}
```

Open the status-specific confirm dialog before calling `withPending` for
Remove. Subscribe to the downloaded-series dialog component's typed output and
unsubscribe on close.

- [ ] **Step 5: Build the fixed header and one-scroll-owner template**

The rendered hierarchy is:

```html
<section class="downloads" aria-labelledby="downloads-title">
    <header class="downloads__header">
        <div>
            <h1 id="downloads-title">{{ 'DOWNLOADS.TITLE' | translate }}</h1>
            @if (model().activeCount > 0) {
                <span data-test-id="downloads-active-count">
                    {{ 'DOWNLOADS.ACTIVE_COUNT' | translate:
                        { count: model().activeCount } }}
                </span>
            }
        </div>
        <div class="downloads__header-actions">
            <span data-test-id="downloads-folder">
                {{ downloadFolder() }}
            </span>
            <button mat-stroked-button (click)="changeFolder()">
                {{ 'DOWNLOADS.CHANGE_FOLDER' | translate }}
            </button>
            @if (model().hasClearable) {
                <button mat-stroked-button (click)="clearFinished()">
                    {{ 'DOWNLOADS.CLEAR_FINISHED' | translate }}
                </button>
            }
        </div>
        <div data-test-id="downloads-tracked-bytes">
            {{ 'DOWNLOADS.TRACKED_DOWNLOADS' | translate }} ·
            {{ formatBytes(model().trackedBytes) }}
        </div>
    </header>
    <div
        class="downloads__filters"
        role="group"
        [attr.aria-label]="'DOWNLOADS.FILTER.LABEL' | translate"
    >
        @for (category of categories(); track category.category_id) {
            <button
                type="button"
                [class.is-selected]="
                    selectedCategoryId() === category.category_id
                "
                [attr.aria-pressed]="
                    selectedCategoryId() === category.category_id
                "
                (click)="setFilter(category.category_id)"
            >
                {{ category.category_name }}
                <span>{{ category.count }}</span>
            </button>
        }
    </div>
    <main class="downloads__content">
        <app-download-queue
            [activeItems]="model().active"
            [attentionItems]="model().attention"
            [pendingIds]="pendingIds()"
            (itemAction)="runAction($event)"
            (openRequested)="openInLibrary($event)"
        />
        <app-download-library
            [entities]="model().library"
            [pendingIds]="pendingIds()"
            (itemAction)="runAction($event)"
            (seriesOpened)="openInLibrary($event)"
            (episodesOpened)="openDownloadedSeries($event)"
        />
    </main>
</section>
```

Preserve unavailable, playlist-loading, no-playlist, no-download, and compact
filter/search-miss states. Keep folder and tracked bytes visible when there
are playlists but no downloads. Add stable test IDs to the header, filters,
queue sections, and library.

- [ ] **Step 6: Add the complete translation key set**

Add consistent keys under `DOWNLOADS` in every locale:

```json
{
  "ACTIVE_COUNT": "{{count}} active",
  "TRACKED_DOWNLOADS": "Tracked downloads",
  "CLEAR_FINISHED": "Clear finished",
  "DOWNLOADING_NOW": "Downloading now",
  "NEEDS_ATTENTION": "Needs attention",
  "READY_TO_WATCH": "Ready to watch",
  "OFFLINE_BADGE": "Offline",
  "FILTER": {
    "ALL": "All",
    "MOVIES": "Movies",
    "SERIES": "Series",
    "IN_PROGRESS": "In progress"
  },
  "REMOVE_FROM_MANAGER": "Remove from manager",
  "REMOVE_COMPLETED_DIALOG": {
    "TITLE": "Remove from manager?",
    "MESSAGE": "This removes the entry from IPTVnator. The downloaded media file remains on disk."
  },
  "REMOVE_PARTIAL_DIALOG": {
    "TITLE": "Remove partial download?",
    "MESSAGE": "This removes the entry and any retained partial download. It can no longer be resumed."
  },
  "CLEAR_FINISHED_DIALOG": {
    "TITLE": "Clear finished downloads?",
    "MESSAGE": "Completed media files remain on disk. Retained partial data for failed or canceled entries is deleted."
  }
}
```

Include episode/season pluralization keys, source/type labels, action aria
labels, and tracked-data explanation used by the templates. Author Russian
copy rather than falling back to English for `ru.json`.

- [ ] **Step 7: Run i18n and component tests**

Run:

```bash
pnpm run i18n:check
pnpm nx test portal-downloads-feature --runInBand
```

Expected: both PASS.

- [ ] **Step 8: Implement token-native responsive styling**

Map all surfaces/text/borders to existing `--app-*` or `--mat-sys-*`
variables. Use one `.downloads__content { overflow-y: auto; min-height: 0; }`,
container/media queries for compact rows and stacked header, horizontal
filter-chip scrolling, visible touch actions, `:focus-visible`, and
`prefers-reduced-motion`. Add no new global design token.

- [ ] **Step 9: Run lint, typecheck, and build**

```bash
pnpm nx lint portal-downloads-feature
pnpm run typecheck:web
pnpm nx build web --configuration=production
```

Expected: PASS. If Nx's web build configuration has a different production
target name, use `pnpm nx show project web` and run its production build.

- [ ] **Step 10: Regenerate the max-lines baseline if the old entry remains**

```bash
node tools/eslint/generate-max-lines-baseline.mjs
git diff -- tools/eslint/max-lines-baseline.mjs
```

Expected: the existing `downloads.component.ts` baseline entry shrinks or is
removed; no new production file appears.

- [ ] **Step 11: Commit the integrated page**

```bash
git add libs/portal/downloads/feature apps/web/src/assets/i18n \
  tools/eslint/max-lines-baseline.mjs
git commit -m "feat(downloads): redesign the manager workspace"
```

## Task 7: Update Electron end-to-end coverage

**Files:**

- Modify: `apps/electron-backend-e2e/src/downloads.e2e.ts`

- [ ] **Step 1: Change locators first and observe the old UI fail**

Replace CSS-class/icon-text locators with roles and stable IDs such as:

```ts
const queueItem = page.getByTestId(`download-queue-item-${id}`);
const movieCard = page.getByTestId(`download-library-movie-${id}`);
await queueItem.getByRole('button', { name: 'Pause' }).click();
```

Run the targeted atomized command:

```bash
pnpm nx run electron-backend-e2e:e2e-ci--src/downloads.e2e.ts
```

Expected: FAIL against the old DOM before Task 6 is applied, or fail at the
first newly asserted queue/library transition when run from the pre-redesign
commit.

- [ ] **Step 2: Preserve and strengthen current real transfer flows**

Keep first-run, folder selection, complete transfer, and Range pause/resume.
Update assertions so completion moves from `Downloading now` to
`Ready to watch`, Remove from manager leaves the final file on disk, and a
retained partial is deleted by removal/clearing.

- [ ] **Step 3: Add deterministic renderer fixtures for view-only boundaries**

Use isolated Electron data, obtain the real playlist IDs from
`window.electron.dbGetAppPlaylistMetas()`, and create download rows only
through `window.electron.downloadsStart()` against controlled local HTTP
servers. Build the following states:

- two playlists with downloads that both appear at `/workspace/downloads`;
- each corresponding portal download route showing only its playlist;
- global workspace badge unchanged after visiting a scoped route;
- search and all four filters;
- two completed episodes from one playlist/series collapsing to one group and
  opening the correct series/dialog.

Do not use real accounts, external images, streams, or credentials.

- [ ] **Step 4: Run targeted Electron E2E**

Run the exact download spec target:

```bash
pnpm nx run electron-backend-e2e:e2e-ci--src/downloads.e2e.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the E2E migration**

```bash
git add apps/electron-backend-e2e/src/downloads.e2e.ts
git commit -m "test(downloads): cover queue and offline library flows"
```

## Task 8: Update canonical documentation and release note

**Files:**

- Modify: `docs/architecture/download-manager.md`
- Modify if stale: `CLAUDE.md`
- Create: `.changes/downloads-manager-mvp.md`

- [ ] **Step 1: Update the canonical renderer architecture**

Document:

- root service list is always global;
- route scope/search/filter/grouping are pure derived state;
- active/attention/ready partitions and sorting;
- valid series identity and fallback episode behavior;
- tracked bytes are manager records, not filesystem capacity;
- finalized media remains after removal while retained partials follow the
  current backend cleanup contract;
- exact new component ownership and test target.

Remove stale claims that the page is a uniform gradient-card list.

- [ ] **Step 2: Assess `CLAUDE.md`**

Search its download sections. Update only claims contradicted by the new
renderer; do not duplicate the detailed architecture doc.

- [ ] **Step 3: Assess the README screenshot**

Check whether the root README currently presents the download manager. Refresh
an affected image only through the repository's mock-backed release capture.
If no capture action/manifest entry exists for this screen, leave published
assets unchanged and record that reason in the final task summary.

- [ ] **Step 4: Add and validate the release note**

Write:

```markdown
---
type: feature
area: downloads
---

Downloads now separate active transfers from a poster-based Ready to watch
library, with movie and series filters, grouped downloaded episodes, clearer
file actions, and honest removal messages about files kept on disk.
```

Run:

```bash
pnpm run release:notes:validate
```

Expected: PASS and body length below 400 characters.

- [ ] **Step 5: Commit docs and note**

```bash
git add docs/architecture/download-manager.md CLAUDE.md \
  .changes/downloads-manager-mvp.md
git commit -m "docs(downloads): describe the redesigned manager"
```

Omit `CLAUDE.md` from `git add` if it required no change.

## Task 9: Visual verification, local P1/P2 review gate, and PR

**Files:** all changed files.

- [ ] **Step 1: Run the full affected validation ladder**

```bash
pnpm nx test services --runInBand --testPathPatterns=downloads.service.spec.ts
pnpm nx test portal-downloads-feature --runInBand
node tools/coverage/run-tier-a-coverage.mjs --projects=portal-downloads-feature
pnpm nx lint services
pnpm nx lint portal-downloads-feature
pnpm run typecheck:web
pnpm nx build web --configuration=production
pnpm run i18n:check
pnpm run release:notes:validate
```

Run the targeted Electron downloads E2E command from Task 7. Every command
must exit zero; warnings are investigated rather than silently accepted.
Run `pnpm run coverage:policy:check`; do not lower the merged coverage ratchet
or exempt a new runtime file to absorb missing tests.

- [ ] **Step 2: Inspect the running UI with agent-browser**

Launch `pnpm run serve:backend`, connect to CDP `127.0.0.1:9222`, and verify:

- global and scoped routes;
- queue, attention, library, filters, search, and dialogs;
- wide and narrow viewport;
- light and dark themes;
- keyboard focus/activation and accessible names;
- no duplicate scroll owners, clipping, console errors, or failed resources.

Save only local temporary screenshots; do not publish real playlist content.

- [ ] **Step 3: Inspect the native window with Computer Use**

Use the Computer Use skill for a final macOS window-level pass: titlebar/drag
region interaction, responsive resizing, native folder dialog return, focus
restoration, and visual polish.

- [ ] **Step 4: Run an independent local review before any push**

Compare the full branch diff to its merge base and dispatch independent
reviewers for:

1. spec compliance;
2. correctness/security/data-loss risks;
3. Angular quality, accessibility, and test coverage.

Classify findings as P0–P3. Any P0/P1/P2 finding blocks publication.

- [ ] **Step 5: Fix every P1/P2 with regression-first TDD**

For each valid issue, first add or adjust a test that fails for the reported
problem, run it to confirm RED, implement the fix, rerun GREEN, and ask the
reviewer to verify the exact finding. Repeat review until no open P1/P2 remains.

- [ ] **Step 6: Re-run the full validation ladder after review fixes**

Repeat Steps 1–3 as appropriate to the touched files. Inspect `git diff
--check`, production TS max-lines, i18n drift, release-note validation, and
working-tree status.

- [ ] **Step 7: Decide PR shape from the final diff**

Prefer one PR because service invariant, derived model, UI, translations,
docs, and E2E form one atomic user-visible workflow. Split only if the final
review identifies an independently shippable, independently tested change
whose temporary absence cannot break the new manager; never split tests from
the behavior they prove.

- [ ] **Step 8: Push and create PR only after the gate is green**

Push `agent/download-manager-mvp`, create a conventional `feat(downloads):`
PR, include validation results, local-review result, screenshots only if
mock-backed, and the release-note summary. Do not create a draft or final PR
while any P1/P2 remains.
