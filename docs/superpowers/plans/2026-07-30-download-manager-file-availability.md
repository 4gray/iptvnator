# Download Manager File Availability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep missing finalized files out of `Ready to watch`, make them recoverable from `Needs attention`, and simplify completed cards by moving source provenance into overflow menus.

**Architecture:** Electron derives file availability on every download read without mutating SQLite transfer status. An explicit managed-ID recovery IPC revalidates a missing completed file and requeues it at its retained destination. Angular partitions the decorated rows into active, attention, and ready entities, while shared service helpers prevent missing files from appearing as locally playable in provider details.

**Tech Stack:** Angular 21.2 standalone components and signals, Angular Material, Electron 41 IPC/preload, Drizzle SQLite, Node filesystem APIs, Jest 30, Nx 22.7, Playwright Electron E2E, SCSS Material/system tokens.

---

## File map

- Create `apps/electron-backend/src/app/events/database/download-file-availability.ts` — trusted regular-file inspection and renderer decoration.
- Create `apps/electron-backend/src/app/events/database/download-file-availability.spec.ts` — availability classification regression tests.
- Create `apps/electron-backend/src/app/events/database/download-redownload.ts` — missing completed-file recovery by managed download ID.
- Create `apps/electron-backend/src/app/events/database/download-redownload.spec.ts` — recovery, race, retained-path, and failure tests.
- Modify `apps/electron-backend/src/app/events/database/downloads.events.ts` and its test harness/specs — decorated GET responses, secure file actions, and recovery IPC registration.
- Modify `apps/electron-backend/src/app/api/main.preload.ts` and `libs/shared/interfaces/src/lib/electron-api.interface.ts` — typed preload bridge.
- Modify `libs/services/src/lib/runtime-capabilities.service.ts` and spec — require the complete recovery-capable bridge.
- Modify `libs/services/src/lib/downloads.service.ts` and spec — availability-aware local playback and recovery method.
- Modify `libs/portal/downloads/feature/src/lib/download-manager.viewmodel.ts` and spec — derived missing-file attention rows and available-only grouping.
- Create `libs/portal/downloads/feature/src/lib/download-source-menu-header.component.ts` — shared informational source header for Material menus.
- Modify queue/library components and specs — missing-file row, card cleanup, and source menus.
- Modify `download-actions.ts`, `download-manager-actions.service.ts`, and specs — `redownload` action and refresh after a late file deletion.
- Modify `download-library-navigation.service.spec.ts` — lock both Stalker series shapes to canonical details.
- Modify `apps/web/src/assets/i18n/*.json` — Download again and File missing labels.
- Modify `apps/electron-backend-e2e/src/downloads.e2e.ts` — real missing-file and recovery journey.
- Modify `docs/architecture/download-manager.md` and `.changes/downloads-manager-mvp.md` — canonical behavior and user-facing note.

## Task 1: Derive file availability in the main process

**Files:**

- Create: `apps/electron-backend/src/app/events/database/download-file-availability.ts`
- Create: `apps/electron-backend/src/app/events/database/download-file-availability.spec.ts`
- Modify: `apps/electron-backend/src/app/events/database/downloads.events.ts`
- Modify: `apps/electron-backend/src/app/events/database/downloads-actions.spec.ts`
- Modify: `apps/electron-backend/src/app/events/database/downloads.test-helpers.ts`
- Modify: `libs/shared/interfaces/src/lib/electron-api.interface.ts`

- [ ] **Step 1: Write failing classification and IPC tests**

Add focused cases proving a completed regular file is available, while a
missing path, directory, symlink, or thrown `lstat` is missing:

```ts
it.each([
    ['missing path', undefined, 'missing'],
    [
        'filesystem error',
        () => {
            throw new Error('ENOENT');
        },
        'missing',
    ],
    [
        'directory',
        () => ({ isFile: () => false, isSymbolicLink: () => false }),
        'missing',
    ],
    [
        'symlink',
        () => ({ isFile: () => true, isSymbolicLink: () => true }),
        'missing',
    ],
])('classifies a completed %s as %s', (_label, lstat, expected) => {
    expect(
        getDownloadFileAvailability(COMPLETED_ROW, lstat as DownloadLstat)
    ).toBe(expected);
});
```

In the downloads events specs, make `DOWNLOADS_GET_LIST` and `DOWNLOADS_GET`
return rows with `fileAvailability`, and require Play/Reveal to reject
non-regular targets.

- [ ] **Step 2: Run the focused tests and verify RED**

```bash
pnpm nx test electron-backend --runInBand \
  --testPathPatterns=download-file-availability.spec.ts \
  --testPathPatterns=downloads-actions.spec.ts
```

Expected: FAIL because the helper and decorated response do not exist and file
actions still use `existsSync`.

- [ ] **Step 3: Add the shared availability type**

In `electron-api.interface.ts`:

```ts
export type ElectronDownloadFileAvailability =
    'available' | 'missing' | 'not-applicable';

export interface ElectronDownloadItem {
    // existing fields
    fileAvailability: ElectronDownloadFileAvailability;
}
```

- [ ] **Step 4: Implement trusted inspection and decoration**

Create the focused helper:

```ts
import { lstatSync, type Stats } from 'node:fs';
import type {
    ElectronBridgeDownloadStatus,
    ElectronDownloadFileAvailability,
} from '@iptvnator/shared/interfaces';

interface DownloadAvailabilityRow {
    readonly filePath?: string | null;
    readonly status: ElectronBridgeDownloadStatus;
}
export type DownloadLstat = (
    path: string
) => Pick<Stats, 'isFile' | 'isSymbolicLink'>;

export function isAvailableDownloadFile(
    filePath: string | null | undefined,
    lstat: DownloadLstat = lstatSync
): boolean {
    if (!filePath) return false;
    try {
        const stat = lstat(filePath);
        return stat.isFile() && !stat.isSymbolicLink();
    } catch {
        return false;
    }
}

export function getDownloadFileAvailability(
    row: Pick<DownloadAvailabilityRow, 'filePath' | 'status'>,
    lstat: DownloadLstat = lstatSync
): ElectronDownloadFileAvailability {
    if (row.status !== 'completed') return 'not-applicable';
    return isAvailableDownloadFile(row.filePath, lstat)
        ? 'available'
        : 'missing';
}

export function decorateDownloadItem<T extends DownloadAvailabilityRow>(
    row: T
): T & { fileAvailability: ElectronDownloadFileAvailability } {
    return {
        ...row,
        fileAvailability: getDownloadFileAvailability(row),
    };
}
```

Await the query before mapping in both GET handlers, and replace
`existsSync(filePath)` in Play/Reveal with `isAvailableDownloadFile(filePath)`.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/electron-backend/src/app/events/database/download-file-availability.* \
  apps/electron-backend/src/app/events/database/downloads.events.ts \
  apps/electron-backend/src/app/events/database/downloads-actions.spec.ts \
  apps/electron-backend/src/app/events/database/downloads.test-helpers.ts \
  libs/shared/interfaces/src/lib/electron-api.interface.ts
git commit -m "feat(downloads): derive completed file availability"
```

## Task 2: Add managed missing-file recovery IPC

**Files:**

- Create: `apps/electron-backend/src/app/events/database/download-redownload.ts`
- Create: `apps/electron-backend/src/app/events/database/download-redownload.spec.ts`
- Modify: `apps/electron-backend/src/app/events/database/download-requests.ts`
- Modify: `apps/electron-backend/src/app/events/database/downloads.events.ts`
- Modify: `apps/electron-backend/src/app/events/database/downloads.test-helpers.ts`
- Modify: `apps/electron-backend/src/app/api/main.preload.ts`
- Modify: `libs/shared/interfaces/src/lib/electron-api.interface.ts`
- Modify: `libs/services/src/lib/runtime-capabilities.service.ts`
- Modify: `libs/services/src/lib/runtime-capabilities.service.spec.ts`

- [ ] **Step 1: Write failing recovery tests**

Cover these exact outcomes in `download-redownload.spec.ts`:

```ts
await expect(redownloadMissingRequest(42)).resolves.toEqual({
    success: true,
});
expect(set).toHaveBeenCalledWith(
    expect.objectContaining({
        bytesDownloaded: 0,
        errorMessage: null,
        resumeValidator: null,
        status: 'queued',
        totalBytes: null,
    })
);
expect(enqueueDownload).toHaveBeenCalledWith(
    expect.objectContaining({
        directory: '/downloads',
        fileName: 'movie.mp4',
        filePath: '/downloads/movie.mp4',
        id: 42,
    })
);
```

Also prove:

- a reappeared regular file returns `{ recovered: true, success: true }` and
  does not update or enqueue;
- non-completed rows are rejected;
- missing `filePath`, unavailable parent directory, unsafe remote URL, locked
  partial cleanup, and a lost conditional update all fail without enqueueing.

- [ ] **Step 2: Run the recovery spec and verify RED**

```bash
pnpm nx test electron-backend --runInBand \
  --testPathPatterns=download-redownload.spec.ts
```

Expected: FAIL because `redownloadMissingRequest` does not exist.

- [ ] **Step 3: Export stored-header parsing**

Change the existing declaration without duplicating its allowlist:

```ts
export function parseStoredHeaders(
    value: string | null
): Record<string, string> | undefined {
    if (!value) return undefined;
    try {
        const parsed = JSON.parse(value) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return undefined;
        }
        const entries = parsed as Record<string, unknown>;
        const headers = STORED_HEADER_ALLOWLIST.reduce<Record<string, string>>(
            (acc, key) => {
                const headerValue = entries[key];
                if (typeof headerValue === 'string') {
                    acc[key] = headerValue;
                }
                return acc;
            },
            {}
        );
        return Object.keys(headers).length > 0 ? headers : undefined;
    } catch {
        return undefined;
    }
}
```

- [ ] **Step 4: Implement the explicit recovery request**

The new module must:

```ts
export async function redownloadMissingRequest(
    downloadId: number
): Promise<{ success: boolean; recovered?: boolean; error?: string }> {
    const item = await loadDownload(downloadId);
    if (!item) return { error: 'Download not found', success: false };
    if (item.status !== 'completed') {
        return {
            error: 'Can only re-download missing completed files',
            success: false,
        };
    }
    if (isAvailableDownloadFile(item.filePath)) {
        return { recovered: true, success: true };
    }
    if (!item.filePath || !isWritableDirectory(dirname(item.filePath))) {
        return { error: 'Download folder is unavailable', success: false };
    }

    await assertRemoteUrlAllowed(item.url, { allowPrivateNetworks: true });
    removePartialDownloadFile(item.filePath);
    const claim = await updateCompletedRowToQueued(item.id);
    if (hasNoChanges(claim)) {
        return { error: 'Download is no longer recoverable', success: false };
    }
    enqueueDownload({
        directory: dirname(item.filePath),
        fileName: basename(item.filePath),
        filePath: item.filePath,
        headers: parseStoredHeaders(item.requestHeaders),
        id: item.id,
        resumeValidator: null,
        totalBytes: null,
        url: item.url,
    });
    return { success: true };
}
```

Use `lstatSync` plus `accessSync(directory, W_OK)` for the retained directory,
and a conditional `id + status='completed'` update.

- [ ] **Step 5: Register and type the bridge**

Add:

```ts
export interface ElectronBridgeDownloadRedownloadResult extends ElectronBridgeErrorResult {
    recovered?: boolean;
}

// ElectronBridgeApi
downloadsRedownloadMissing: (downloadId: number) =>
    Promise<ElectronBridgeDownloadRedownloadResult>;

// preload
downloadsRedownloadMissing: ((downloadId: number) =>
    ipcRenderer.invoke('DOWNLOADS_REDOWNLOAD_MISSING', downloadId),
    // main events
    ipcMain.handle(
        'DOWNLOADS_REDOWNLOAD_MISSING',
        async (_event, downloadId: number) =>
            redownloadMissingRequest(downloadId)
    ));
```

Register the main handler, add the method to `ElectronBridgeApi`, and require it
in `RuntimeCapabilitiesService.supportsDownloads`. Update the capability spec
fixture to prove an older partial bridge returns false.

- [ ] **Step 6: Run Electron and capability tests**

```bash
pnpm nx test electron-backend --runInBand \
  --testPathPatterns=download-redownload.spec.ts \
  --testPathPatterns=downloads-actions.spec.ts
pnpm nx test services --runInBand \
  --testPathPatterns=runtime-capabilities.service.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/electron-backend/src/app/events/database/download-redownload.* \
  apps/electron-backend/src/app/events/database/download-requests.ts \
  apps/electron-backend/src/app/events/database/downloads.events.ts \
  apps/electron-backend/src/app/events/database/downloads.test-helpers.ts \
  apps/electron-backend/src/app/api/main.preload.ts \
  libs/shared/interfaces/src/lib/electron-api.interface.ts \
  libs/services/src/lib/runtime-capabilities.service.*
git commit -m "feat(downloads): recover missing completed files"
```

## Task 3: Make the renderer service availability-aware

**Files:**

- Modify: `libs/services/src/lib/downloads.service.ts`
- Modify: `libs/services/src/lib/downloads.service.spec.ts`
- Modify: `libs/portal/downloads/feature/src/lib/download-manager-actions.service.ts`
- Modify: `libs/portal/downloads/feature/src/lib/download-manager-actions.service.spec.ts`
- Modify: `libs/portal/downloads/feature/src/lib/download-actions.ts`
- Modify: `libs/portal/xtream/feature/src/lib/vod-details/vod-details-route.actions.spec.ts`
- Modify: `libs/ui/playback/src/lib/vod-details/vod-details.component.spec.ts`

- [ ] **Step 1: Write failing service and action tests**

Add service assertions:

```ts
expect(service.isDownloaded(id, playlistId, 'vod')).toBe(false);
expect(service.getDownloadedFilePath(id, playlistId, 'vod')).toBeUndefined();
```

for a `completed` item with `fileAvailability: 'missing'`, and positive
assertions for `available`.

Add:

```ts
await expect(service.redownloadMissing(42)).resolves.toEqual({
    success: true,
});
expect(window.electron.downloadsRedownloadMissing).toHaveBeenCalledWith(42);
```

In the action-service spec, prove `redownload` uses the managed ID and that a
Play/Reveal `{ error: 'File not found', success: false }` awaits
`loadDownloads()` before clearing pending state.

In the Xtream and shared Stalker detail specs, supply a completed item with
`fileAvailability: 'missing'` and assert that neither the Offline tag nor the
local-primary action renders. Keep the corresponding
`fileAvailability: 'available'` assertions green.

- [ ] **Step 2: Run the focused tests and verify RED**

```bash
pnpm nx test services --runInBand \
  --testPathPatterns=downloads.service.spec.ts
pnpm nx test portal-downloads-feature --runInBand \
  --testPathPatterns=download-manager-actions.service.spec.ts
pnpm nx test portal-xtream-feature --runInBand \
  --testPathPatterns=vod-details-route.actions.spec.ts
pnpm nx test ui-playback --runInBand \
  --testPathPatterns=vod-details.component.spec.ts
```

Expected: FAIL because missing rows still count as downloaded and the
`redownload` action is unknown.

- [ ] **Step 3: Implement minimal renderer behavior**

Add the optional compatibility field to the local service model:

```ts
fileAvailability?: ElectronDownloadFileAvailability;
```

Use:

```ts
private hasAvailableCompletedFile(item: DownloadItem | undefined): boolean {
    return (
        item?.status === 'completed' &&
        !!item.filePath &&
        item.fileAvailability !== 'missing'
    );
}
```

from both `isDownloaded()` and `getDownloadedFilePath()`. Add
`redownloadMissing(downloadId)` that calls the new bridge.

Extend `DownloadItemActionType` with `'redownload'`, map it to the service in
`DownloadManagerActionsService`, and allow `withPending` failure callbacks to
return a promise:

```ts
onFailure: (error?: string) => void | Promise<void>
```

On `File not found`, await `downloads.loadDownloads()` and then show the
existing snackbar.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the commands from Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/services/src/lib/downloads.service.* \
  libs/portal/downloads/feature/src/lib/download-actions.ts \
  libs/portal/downloads/feature/src/lib/download-manager-actions.service.* \
  libs/portal/xtream/feature/src/lib/vod-details/vod-details-route.actions.spec.ts \
  libs/ui/playback/src/lib/vod-details/vod-details.component.spec.ts
git commit -m "feat(downloads): refresh missing local files"
```

## Task 4: Partition missing completed rows from the ready library

**Files:**

- Modify: `libs/portal/downloads/feature/src/lib/download-manager.viewmodel.ts`
- Modify: `libs/portal/downloads/feature/src/lib/download-manager.viewmodel.spec.ts`

- [ ] **Step 1: Write failing pure view-model tests**

Add tests proving:

```ts
const result = build([
    download(1, { fileAvailability: 'available' }),
    download(2, { fileAvailability: 'missing' }),
]);
expect(rowIds(result.attention)).toEqual([2]);
expect(result.attention[0].attentionReason).toBe('file-missing');
expect(libraryItemIds(result.library)).toEqual([1]);
```

For one series with two available and one missing episode, assert the library
group contains only the two available member IDs and the missing member is one
attention row. Add fully missing series, Movies/Series filters, stable counts,
search by hidden source name, and input immutability cases.

- [ ] **Step 2: Run the view-model spec and verify RED**

```bash
pnpm nx test portal-downloads-feature --runInBand \
  --testPathPatterns=download-manager.viewmodel.spec.ts
```

Expected: FAIL because every completed row enters the library.

- [ ] **Step 3: Add a presentation reason and availability predicates**

```ts
export type DownloadAttentionReason = 'file-missing' | 'transfer';

export interface DownloadListItemViewModel extends DownloadLibraryRow {
    readonly attentionReason: DownloadAttentionReason;
    readonly seriesTitle: string;
}

function isMissingCompletedFile(item: DownloadItem): boolean {
    return item.status === 'completed' && item.fileAvailability === 'missing';
}

function isReady(item: DownloadItem): boolean {
    return item.status === 'completed' && item.fileAvailability !== 'missing';
}
```

Use `needsAttention(item) || isMissingCompletedFile(item)` for attention and
`isReady(item)` for library construction in both searched and count models.
Set `attentionReason` deterministically while mapping rows.

- [ ] **Step 4: Run the view-model spec and verify GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/portal/downloads/feature/src/lib/download-manager.viewmodel.*
git commit -m "feat(downloads): separate missing files from ready media"
```

## Task 5: Render the missing-file queue row and reusable source header

**Files:**

- Create: `libs/portal/downloads/feature/src/lib/download-source-menu-header.component.ts`
- Modify: `libs/portal/downloads/feature/src/lib/download-queue.component.ts`
- Modify: `libs/portal/downloads/feature/src/lib/download-queue.component.html`
- Modify: `libs/portal/downloads/feature/src/lib/download-queue.component.scss`
- Modify: `libs/portal/downloads/feature/src/lib/download-queue.component.spec.ts`

- [ ] **Step 1: Write failing queue component tests**

Create a `completed + missing` attention row and assert:

```ts
expect(status.textContent).toContain('File missing');
expect(status.querySelector('mat-icon')?.textContent?.trim()).toBe('file_off');
expect(renderedActions).toEqual(['redownload']);
expect(row.querySelector('[data-test-action="play"]')).toBeNull();
expect(row.querySelector('[data-test-action="reveal"]')).toBeNull();
expect(row.querySelector('.download-queue__source')).toBeNull();
```

Open the Material menu and assert an informational `Source / Alpha Source`
header appears before Copy URL and Remove. Verify empty source headers are
omitted, full text is accessible, pending state disables Download again, and
the action emits `{ type: 'redownload', item }`.

- [ ] **Step 2: Run the queue spec and verify RED**

```bash
pnpm nx test portal-downloads-feature --runInBand \
  --testPathPatterns=download-queue.component.spec.ts
```

Expected: FAIL because the missing presentation and source header do not exist.

- [ ] **Step 3: Implement the reusable menu header**

Create one standalone OnPush component with signal input:

```ts
@Component({
    selector: 'app-download-source-menu-header',
    standalone: true,
    imports: [MatTooltip, TranslatePipe],
    template: `
        @if (sourceName().trim(); as source) {
            <div class="download-source-menu-header">
                <span>{{ 'PORTALS.MULTI_SOURCE.SOURCE' | translate }}</span>
                <strong [matTooltip]="source">{{ source }}</strong>
            </div>
        }
    `,
    // component-scoped token-only styles
})
export class DownloadSourceMenuHeaderComponent {
    readonly sourceName = input('');
}
```

- [ ] **Step 4: Implement queue presentation**

Add helpers:

```ts
isMissingFile(row: DownloadListItemViewModel): boolean {
    return row.attentionReason === 'file-missing';
}

statusKey(row: DownloadListItemViewModel): string {
    return this.isMissingFile(row)
        ? 'DOWNLOADS.STATUS.FILE_MISSING'
        : `DOWNLOADS.STATUS.${row.item.status.toUpperCase()}`;
}
```

Render `file_off`, the amber/muted modifier class, only Download again as the
primary action, and move Remove into the overflow menu for this variant.
Remove the permanent queue source span and insert the shared source header at
the top of every queue overflow menu.

- [ ] **Step 5: Run the queue spec and verify GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add libs/portal/downloads/feature/src/lib/download-source-menu-header.component.ts \
  libs/portal/downloads/feature/src/lib/download-queue.component.*
git commit -m "feat(downloads): surface missing files for recovery"
```

## Task 6: Simplify ready cards and move source into menus

**Files:**

- Modify: `libs/portal/downloads/feature/src/lib/download-library.component.ts`
- Modify: `libs/portal/downloads/feature/src/lib/download-library.component.html`
- Modify: `libs/portal/downloads/feature/src/lib/download-library.component.scss`
- Modify: `libs/portal/downloads/feature/src/lib/download-library.component.spec.ts`

- [ ] **Step 1: Write failing library tests**

Assert all three card shapes contain neither visible Offline nor visible source
text before a menu opens, while size remains:

```ts
expect(section.textContent).not.toContain('Offline');
expect(movieCard.textContent).not.toContain('Cinema');
expect(movieCard.textContent).toContain('2.4 MB');
```

Open the movie menu and assert `Source / Cinema` precedes Copy and Remove.
Open the new series menu and assert `Source / Living room` plus Open downloaded
episodes. Verify the series menu emits `episodesOpened` and no file action.

- [ ] **Step 2: Run the library spec and verify RED**

```bash
pnpm nx test portal-downloads-feature --runInBand \
  --testPathPatterns=download-library.component.spec.ts
```

Expected: FAIL because Offline and source are visible and series has no menu.

- [ ] **Step 3: Implement the clean card contract**

Import `DownloadSourceMenuHeaderComponent`, delete both
`.download-library__offline` spans and their SCSS, and render only tracked bytes
in `.download-library__metadata`.

At the top of movie/episode menus add:

```html
<app-download-source-menu-header [sourceName]="entity.sourceName" />
```

Add a three-dot series action and Material menu containing the source header
and:

```html
<button mat-menu-item type="button" (click)="openEpisodes(entity)">
    <mat-icon aria-hidden="true">video_library</mat-icon>
    <span>{{ 'DOWNLOADS.OPEN_EPISODES' | translate }}</span>
</button>
```

Keep card sizing, Play, Reveal, detail navigation, and the existing episodes
count control unchanged.

- [ ] **Step 4: Run the library spec and verify GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/portal/downloads/feature/src/lib/download-library.component.*
git commit -m "refactor(downloads): simplify ready cards"
```

## Task 7: Wire recovery and lock canonical series navigation

**Files:**

- Modify: `libs/portal/downloads/feature/src/lib/downloads.component.spec.ts`
- Modify: `libs/portal/downloads/feature/src/lib/download-library-navigation.service.spec.ts`
- Modify: `libs/portal/downloads/feature/src/lib/download-manager-actions.service.spec.ts`

- [ ] **Step 1: Add failing integration regressions**

Render a missing item through `DownloadsComponent`, click Download again, and
assert `downloadsRedownloadMissing(id)` receives the managed ID and no path.
Resolve the command and drive the service signal to queued, then assert the row
moves from `Needs attention` to `Downloading now`.

Strengthen Stalker tests with:

```ts
expect(router.navigate).toHaveBeenCalledWith(
    ['/workspace', 'stalker', PLAYLIST_ID, 'vod', 'vod'],
    expect.anything()
);
expect(router.navigate).not.toHaveBeenCalledWith(
    expect.arrayContaining(['recent']),
    expect.anything()
);
```

Repeat for the ordinary `series/series` route.

- [ ] **Step 2: Run the focused specs**

```bash
pnpm nx test portal-downloads-feature --runInBand \
  --testPathPatterns=downloads.component.spec.ts \
  --testPathPatterns=download-library-navigation.service.spec.ts \
  --testPathPatterns=download-manager-actions.service.spec.ts
```

Expected: the container test is RED until all wiring is present; route tests
must already be GREEN on the current fixed implementation.

- [ ] **Step 3: Update integration fixtures without changing route code**

Keep the existing `(itemAction)="runAction($event)"` binding; it already
carries the typed action. Update completed fixture factories and the
`DownloadsService` fake explicitly:

```ts
function download(
    id: number,
    overrides: Partial<DownloadItem> = {}
): DownloadItem {
    return {
        // existing required fields
        fileAvailability: 'available',
        status: 'completed',
        ...overrides,
    };
}

downloadsService = {
    // existing methods/signals
    redownloadMissing: jest.fn(success),
};
```

The missing-row integration case overrides
`fileAvailability: 'missing'`. Do not change routing production code: both
exact canonical-route tests are expected to pass against the current
implementation.

- [ ] **Step 4: Re-run and verify GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/portal/downloads/feature/src/lib/downloads.component.spec.ts \
  libs/portal/downloads/feature/src/lib/download-library-navigation.service.spec.ts \
  libs/portal/downloads/feature/src/lib/download-manager-actions.service.spec.ts
git commit -m "test(downloads): cover missing-file and series journeys"
```

## Task 8: Translate, document, and verify end to end

**Files:**

- Modify: `apps/web/src/assets/i18n/*.json`
- Modify: `apps/electron-backend-e2e/src/downloads.e2e.ts`
- Modify: `docs/architecture/download-manager.md`
- Modify: `.changes/downloads-manager-mvp.md`

- [ ] **Step 1: Add translation keys**

Add to every locale so runtime keys never leak:

```json
"DOWNLOAD_AGAIN": "Download again",
"STATUS": {
  "FILE_MISSING": "File missing"
},
"ARIA": {
  "DOWNLOAD_AGAIN": "Download {{title}} again"
}
```

Use Russian equivalents in `ru.json`:

```json
"DOWNLOAD_AGAIN": "Скачать заново",
"FILE_MISSING": "Файл отсутствует",
"DOWNLOAD_AGAIN": "Скачать {{title}} заново"
```

Reuse `PORTALS.MULTI_SOURCE.SOURCE` for Source rather than adding a duplicate
token.

- [ ] **Step 2: Extend the Electron E2E journey**

After the existing real completion assertion:

```ts
await expect(card.getByText('Offline')).toHaveCount(0);
await card.getByRole('button', { name: 'More actions: E2E Movie' }).click();
await expect(page.getByText('Download Portal', { exact: true })).toBeVisible();

unlinkSync(finalPath);
await page.reload();
await expect(
    page.getByTestId(`download-queue-item-${downloadId}`)
).toContainText('File missing');
await expect(card).toHaveCount(0);

await page
    .getByRole('button', {
        name: 'Download E2E Movie again',
    })
    .click();
await expect(card).toBeVisible({ timeout: 20000 });
expect(readFileSync(finalPath, 'utf8')).toBe('e2e download payload');
```

Also assert Play/Reveal are absent while missing and the item leaves Needs
attention after recovery.

- [ ] **Step 3: Update canonical documentation and release note**

Document:

- filesystem-derived readiness and no SQLite availability column;
- missing rows in Needs attention and per-episode series partitioning;
- Download again retained-path behavior;
- Source overflow placement and manager-only Offline removal;
- availability-aware detail playback.

Rewrite the existing release-note body to remain under 400 characters while
mentioning missing-file recovery and cleaner cards.

- [ ] **Step 4: Run complete affected validation**

```bash
pnpm nx test electron-backend --runInBand
pnpm nx test services --runInBand
pnpm nx test portal-downloads-feature --runInBand
pnpm nx test portal-xtream-feature --runInBand
pnpm nx test ui-playback --runInBand
pnpm nx lint electron-backend
pnpm nx lint services
pnpm nx lint portal-downloads-feature
pnpm nx run web:build:electron-e2e --skipNxCache --outputStyle=static
pnpm nx run electron-backend-e2e:e2e-ci--src/downloads.e2e.ts
pnpm run release:notes:validate
```

Expected: all commands exit 0; the downloads E2E reports no unexpected
retries or flaky tests.

- [ ] **Step 5: Manually inspect Electron**

Launch with CDP, then verify in light and dark themes:

1. Ready cards follow Small/Medium/Large and have no Offline badge.
2. Source appears only after opening `…`.
3. Missing files are muted attention rows with no Play/Reveal.
4. Download again restores the file and ready card.
5. Stalker ordinary series and VOD-series cards open details, never Recent.

- [ ] **Step 6: Final diff checks and commit**

```bash
pnpm exec prettier --check \
  apps/electron-backend/src/app/events/database \
  libs/services/src/lib/downloads.service.ts \
  libs/portal/downloads/feature/src/lib \
  apps/web/src/assets/i18n \
  apps/electron-backend-e2e/src/downloads.e2e.ts \
  docs/architecture/download-manager.md \
  .changes/downloads-manager-mvp.md
git diff --check
git add apps/web/src/assets/i18n \
  apps/electron-backend-e2e/src/downloads.e2e.ts \
  docs/architecture/download-manager.md \
  .changes/downloads-manager-mvp.md
git commit -m "feat(downloads): recover missing offline files"
```
