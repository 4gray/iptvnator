import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import {
    ActivatedRoute,
    convertToParamMap,
    type ParamMap,
    Router,
} from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
    type DownloadItem,
    DownloadsService,
    PlaylistsService,
    type RecordingItem,
    RecordingsService,
} from '@iptvnator/services';
import {
    PORTAL_SHELL_ACTIONS,
    PortalCollectionContextService,
} from '@iptvnator/portal/shared/util';
import type { Playlist } from '@iptvnator/shared/interfaces';
import { DialogService } from '@iptvnator/ui/components';
import { BehaviorSubject, type Observable, Subject } from 'rxjs';
import { DownloadLibraryNavigationService } from './download-library-navigation.service';
import type { DownloadActionResult } from './download-actions';
import { DownloadManagerActionsService } from './download-manager-actions.service';
import { RecordingManagerActionsService } from './recording-manager-actions.service';
import type { DownloadSeriesCardViewModel } from './download-manager.viewmodel';
import { DownloadsComponent } from './downloads.component';

interface Deferred<T> {
    readonly promise: Promise<T>;
    resolve(value: T): void;
}

interface ConfirmConfig {
    readonly title: string;
    readonly message: string;
    readonly onConfirm: () => Promise<void> | void;
}

interface ExpectedDownloadsComponent {
    readonly model: () => {
        readonly active: readonly { readonly item: DownloadItem }[];
        readonly activeCount: number;
        readonly trackedBytes: number;
    };
    readonly pendingIds: () => ReadonlySet<number>;
    clearFinished(): void;
    openDownloadedSeries(group: DownloadSeriesCardViewModel): void;
    openOfflineDetail(item: DownloadItem): void;
    openInLibrary(item: DownloadItem): Promise<void>;
    runAction(action: {
        readonly type: string;
        readonly item: DownloadItem;
    }): Promise<DownloadActionResult> | void;
    setFilter(filter: string): void;
}

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((settle) => {
        resolve = settle;
    });
    return { promise, resolve };
}

function recording(
    id: number,
    overrides: Partial<RecordingItem> = {}
): RecordingItem {
    return {
        id,
        status: 'completed',
        filePath: `/recordings/${id}.ts`,
        channelName: `Channel ${id}`,
        startedAt: '2026-08-15T21:00:00Z',
        endedAt: '2026-08-15T21:58:00Z',
        fileAvailability: 'available',
        playlistId: 'playlist-a',
        ...overrides,
    };
}

function download(
    id: number,
    overrides: Partial<DownloadItem> = {}
): DownloadItem {
    return {
        id,
        playlistId: 'playlist-a',
        xtreamId: 1000 + id,
        contentType: 'vod',
        title: `Download ${id}`,
        url: `https://example.com/${id}.mp4`,
        status: 'completed',
        fileAvailability: 'available',
        bytesDownloaded: id * 10,
        filePath: `/downloads/${id}.mp4`,
        createdAt: `2026-07-${String(id).padStart(2, '0')}T12:00:00Z`,
        ...overrides,
    };
}

function playlist(id: string, title: string): Playlist {
    return { _id: id, title } as Playlist;
}

describe('DownloadsComponent', () => {
    let fixture: ComponentFixture<DownloadsComponent>;
    let component: ExpectedDownloadsComponent;
    let downloads: ReturnType<typeof signal<DownloadItem[]>>;
    let routeParams: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
    let queryParams: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
    let activatedRoute: {
        readonly paramMap: Observable<ParamMap>;
        readonly queryParamMap: Observable<ParamMap>;
        readonly snapshot: {
            readonly params: Record<string, string>;
            readonly paramMap: ReturnType<typeof convertToParamMap>;
            readonly queryParamMap: ReturnType<typeof convertToParamMap>;
        };
    };
    let router: { url: string; navigate: jest.Mock };
    let playlistItems: BehaviorSubject<Playlist[]>;
    let collectionContext: PortalCollectionContextService;
    let dialogConfigs: ConfirmConfig[];
    let dialogActionListener:
        ((action: { type: string; item: DownloadItem }) => void) | undefined;
    let dialogClosed: Subject<void>;
    let dialogActionUnsubscribe: jest.Mock;
    let dialogSetInput: jest.Mock;
    let downloadsService: {
        readonly downloads: typeof downloads;
        readonly downloadFolder: ReturnType<typeof signal<string>>;
        readonly isAvailable: ReturnType<typeof signal<boolean>>;
        readonly isLoadingDownloads: ReturnType<typeof signal<boolean>>;
        readonly hasLoadedDownloads: ReturnType<typeof signal<boolean>>;
        readonly activeCount: ReturnType<typeof computed<number>>;
        loadDownloads: jest.Mock;
        cancelDownload: jest.Mock;
        pauseDownload: jest.Mock;
        redownloadMissing: jest.Mock;
        resumeDownload: jest.Mock;
        retryDownload: jest.Mock;
        removeDownload: jest.Mock;
        playDownload: jest.Mock;
        revealFile: jest.Mock;
        selectFolder: jest.Mock;
        clearCompleted: jest.Mock;
        formatBytes: jest.Mock;
    };
    let navigation: {
        canOpen: jest.Mock;
        open: jest.Mock;
    };
    let snackBar: { open: jest.Mock };
    let matDialog: { open: jest.Mock };
    let recordings: ReturnType<typeof signal<RecordingItem[]>>;
    let recordingsService: {
        readonly recordings: typeof recordings;
        readonly isAvailable: ReturnType<typeof signal<boolean>>;
        readonly hasLoadedRecordings: ReturnType<typeof signal<boolean>>;
        readonly hasAuthoritativeRecordingList: ReturnType<
            typeof signal<boolean>
        >;
        readonly isLoadingRecordings: ReturnType<typeof signal<boolean>>;
        loadRecordings: jest.Mock;
        stopRecording: jest.Mock;
        removeRecording: jest.Mock;
        playFile: jest.Mock;
        revealFile: jest.Mock;
    };

    const success = async () => ({ success: true });

    beforeEach(async () => {
        downloads = signal<DownloadItem[]>([]);
        recordings = signal<RecordingItem[]>([]);
        recordingsService = {
            recordings,
            isAvailable: signal(false),
            hasLoadedRecordings: signal(true),
            hasAuthoritativeRecordingList: signal(true),
            isLoadingRecordings: signal(false),
            loadRecordings: jest.fn(async () => undefined),
            stopRecording: jest.fn(success),
            removeRecording: jest.fn(success),
            playFile: jest.fn(success),
            revealFile: jest.fn(success),
        };
        routeParams = new BehaviorSubject(convertToParamMap({}));
        queryParams = new BehaviorSubject(convertToParamMap({}));
        activatedRoute = {
            paramMap: routeParams.asObservable(),
            queryParamMap: queryParams.asObservable(),
            snapshot: {
                params: {},
                paramMap: convertToParamMap({}),
                queryParamMap: convertToParamMap({}),
            },
        };
        router = {
            url: '/workspace/downloads?q=signal',
            navigate: jest.fn(async () => true),
        };
        playlistItems = new BehaviorSubject([
            playlist('playlist-a', 'Alpha source'),
            playlist('playlist-b', 'Beta source'),
        ]);
        dialogConfigs = [];
        dialogClosed = new Subject<void>();
        dialogActionUnsubscribe = jest.fn();
        dialogSetInput = jest.fn();
        dialogActionListener = undefined;
        snackBar = { open: jest.fn() };
        navigation = {
            canOpen: jest.fn(() => true),
            open: jest.fn(async () => true),
        };
        matDialog = {
            open: jest.fn(() => ({
                componentRef: { setInput: dialogSetInput },
                componentInstance: {
                    itemAction: {
                        subscribe: jest.fn(
                            (
                                listener: (action: {
                                    type: string;
                                    item: DownloadItem;
                                }) => void
                            ) => {
                                dialogActionListener = listener;
                                return {
                                    unsubscribe: dialogActionUnsubscribe,
                                };
                            }
                        ),
                    },
                },
                afterClosed: () => dialogClosed.asObservable(),
            })),
        };
        downloadsService = {
            downloads,
            downloadFolder: signal('/downloads'),
            isAvailable: signal(true),
            isLoadingDownloads: signal(false),
            hasLoadedDownloads: signal(true),
            activeCount: computed(
                () =>
                    downloads().filter(
                        ({ status }) =>
                            status === 'queued' || status === 'downloading'
                    ).length
            ),
            loadDownloads: jest.fn(async () => undefined),
            cancelDownload: jest.fn(success),
            pauseDownload: jest.fn(success),
            redownloadMissing: jest.fn(success),
            resumeDownload: jest.fn(success),
            retryDownload: jest.fn(success),
            removeDownload: jest.fn(success),
            playDownload: jest.fn(success),
            revealFile: jest.fn(success),
            selectFolder: jest.fn(async () => '/downloads'),
            clearCompleted: jest.fn(success),
            formatBytes: jest.fn((bytes: number) => `${bytes} B`),
        };

        await TestBed.configureTestingModule({
            imports: [
                DownloadsComponent,
                NoopAnimationsModule,
                TranslateModule.forRoot(),
            ],
            providers: [
                {
                    provide: ActivatedRoute,
                    useValue: activatedRoute,
                },
                {
                    provide: Router,
                    useValue: router,
                },
                {
                    provide: DownloadsService,
                    useValue: downloadsService,
                },
                {
                    provide: RecordingsService,
                    useValue: recordingsService,
                },
                {
                    provide: PlaylistsService,
                    useValue: {
                        getAllPlaylists: () => playlistItems.asObservable(),
                    },
                },
                {
                    provide: DialogService,
                    useValue: {
                        openConfirmDialog: (config: ConfirmConfig) =>
                            dialogConfigs.push(config),
                    },
                },
                { provide: MatDialog, useValue: matDialog },
                { provide: MatSnackBar, useValue: snackBar },
                {
                    provide: PORTAL_SHELL_ACTIONS,
                    useValue: { openAddPlaylistDialog: jest.fn() },
                },
                PortalCollectionContextService,
            ],
        })
            .overrideComponent(DownloadsComponent, {
                set: {
                    providers: [
                        {
                            provide: DownloadLibraryNavigationService,
                            useValue: navigation,
                        },
                        { provide: MatDialog, useValue: matDialog },
                        DownloadManagerActionsService,
                        RecordingManagerActionsService,
                    ],
                },
            })
            .compileComponents();

        const translate = TestBed.inject(TranslateService);
        translate.setTranslation('en', {
            DOWNLOADS: {
                TITLE: 'Downloads',
                ACTIVE_COUNT: '{{count}} active',
                TRACKED_DOWNLOADS: 'Tracked downloads',
                CHANGE_FOLDER: 'Change folder',
                CLEAR_FINISHED: 'Clear finished',
                FILTER: {
                    LABEL: 'Filter downloads',
                    ALL: 'All',
                    MOVIES: 'Movies',
                    SERIES: 'Series',
                    IN_PROGRESS: 'In progress',
                },
                REMOVE_COMPLETED_DIALOG: {
                    TITLE: 'Remove from manager?',
                    MESSAGE: 'The downloaded media file remains on disk.',
                },
                REMOVE_PARTIAL_DIALOG: {
                    TITLE: 'Remove partial download?',
                    MESSAGE: 'Retained partial download data will be deleted.',
                },
                CLEAR_FINISHED_DIALOG: {
                    TITLE: 'Clear finished downloads?',
                    MESSAGE:
                        'Completed files remain; retained partial data is deleted.',
                },
                ACTION_FAILED: 'Action failed',
                FILE_NOT_FOUND: 'File not found',
                FILE_ACTION_ERROR: 'File action failed',
                DOWNLOAD_AGAIN: 'Download again',
                STATUS: {
                    FILE_MISSING: 'File missing',
                },
                ARIA: {
                    DOWNLOAD_AGAIN: 'Download {{title}} again',
                },
                SOURCE_PLAYLIST_MISSING: 'Source playlist missing',
                URL_COPIED: 'URL copied',
                URL_COPY_FAILED: 'URL copy failed',
                REMOVE_FROM_MANAGER: 'Remove from manager',
                PLAY: 'Play',
            },
            CHANNELS: { LOADING: 'Loading' },
            WORKSPACE: {
                SHELL: {
                    GO_TO_SOURCES: 'Go to sources',
                    GO_TO_DASHBOARD: 'Go to dashboard',
                },
            },
            HOME: { PLAYLISTS: { ADD_YOUR_FIRST: 'Add playlist' } },
        });
        translate.use('en');

        collectionContext = TestBed.inject(PortalCollectionContextService);
        fixture = TestBed.createComponent(DownloadsComponent);
        component =
            fixture.componentInstance as unknown as ExpectedDownloadsComponent;
        fixture.detectChanges();
        TestBed.flushEffects();
    });

    afterEach(() => {
        fixture?.destroy();
        dialogClosed.complete();
    });

    it('loads the authoritative global list without a playlist argument', () => {
        expect(downloadsService.loadDownloads).toHaveBeenCalledTimes(1);
        expect(downloadsService.loadDownloads).toHaveBeenCalledWith();
    });

    it('keeps the folder tail visible while exposing the complete path', () => {
        const folder = '/Users/viewer/Media/Very Long Folder/Downloads';
        downloadsService.downloadFolder.set(folder);
        fixture.detectChanges();

        const path = fixture.nativeElement.querySelector(
            '.downloads__folder-path'
        ) as HTMLElement;
        expect(path.getAttribute('aria-label')).toBe(folder);
        expect(
            path.querySelector('.downloads__folder-prefix')?.textContent?.trim()
        ).toBe('/Users/viewer/Media/Very Long Folder');
        expect(
            path.querySelector('.downloads__folder-tail')?.textContent?.trim()
        ).toBe('/Downloads');
        expect(
            fixture.nativeElement
                .querySelector('[data-test-id="downloads-folder"]')
                ?.getAttribute('title')
        ).toBe(folder);
    });

    it('shapes the loading state as both queue rows and poster cards', () => {
        downloadsService.hasLoadedDownloads.set(false);
        downloadsService.isLoadingDownloads.set(true);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelectorAll('.downloads__skeleton-row')
        ).toHaveLength(6);
        expect(
            fixture.nativeElement.querySelectorAll('.downloads__skeleton-card')
        ).toHaveLength(5);
        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="downloads-library-skeleton"]'
            )
        ).not.toBeNull();
    });

    it('uses the shared cover-grid sizing contract for skeleton cards', () => {
        const styles = readFileSync(
            join(__dirname, 'downloads.component.scss'),
            'utf8'
        );
        const skeletonCardsRule =
            styles.match(/\.downloads__skeleton-cards\s*\{([^}]*)\}/)?.[1] ??
            '';

        expect(skeletonCardsRule).toContain(
            'var(--cover-grid-min-width, 148px)'
        );
        expect(skeletonCardsRule).toContain('var(--cover-gap, 16px)');
        expect(skeletonCardsRule).not.toContain('150px');
    });

    it('derives route scope without mutating the global service signal', () => {
        const globalItems = [
            download(1, { status: 'downloading' }),
            download(2, {
                playlistId: 'playlist-b',
                status: 'downloading',
            }),
        ];
        downloads.set(globalItems);
        routeParams.next(convertToParamMap({ id: 'playlist-a' }));
        fixture.detectChanges();

        expect(component.model().active.map(({ item }) => item.id)).toEqual([
            1,
        ]);
        expect(component.model().activeCount).toBe(1);
        expect(downloadsService.activeCount()).toBe(2);
        expect(downloads()).toBe(globalItems);
    });

    it('counts recordings in the All chip and the active badge', () => {
        // A manager listing only recordings must not read "All 0", and an
        // active recording belongs in the header badge.
        recordingsService.isAvailable.set(true);
        recordings.set([
            recording(1),
            recording(2, { status: 'recording', endedAt: undefined }),
        ]);
        fixture.detectChanges();

        const all = component
            .categories()
            .find(({ category_id }) => category_id === 'all');
        const inProgress = component
            .categories()
            .find(({ category_id }) => category_id === 'in-progress');
        const recordingsChip = component
            .categories()
            .find(({ category_id }) => category_id === 'recording');

        expect(all?.count).toBe(2);
        expect(inProgress?.count).toBe(1);
        expect(recordingsChip?.count).toBe(2);
        expect(component.activeCount()).toBe(1);
    });

    it('keeps retained offline downloads visible after the last source is removed', () => {
        playlistItems.next([]);
        downloads.set([
            download(4, {
                playlistId: 'removed-playlist',
                title: 'Retained offline movie',
            }),
        ]);
        fixture.detectChanges();

        const root = fixture.nativeElement as HTMLElement;
        expect(root.querySelector('app-download-library')).not.toBeNull();
        expect(root.querySelector('app-empty-state')).toBeNull();
        expect(
            root.querySelector('[data-test-id="downloads-filters"]')
        ).not.toBeNull();
    });

    it('combines the shared category and q search in the pure model', () => {
        downloads.set([
            download(1, {
                title: 'Needle movie',
                status: 'downloading',
            }),
            download(2, {
                contentType: 'episode',
                title: 'Needle series - S01E01 - Pilot',
                seriesXtreamId: 20,
                seasonNumber: 1,
                episodeNumber: 1,
                status: 'downloading',
            }),
            download(3, { title: 'Other movie', status: 'downloading' }),
        ]);
        collectionContext.setCategoryId('series');
        queryParams.next(convertToParamMap({ q: 'needle' }));
        fixture.detectChanges();

        expect(component.model().active.map(({ item }) => item.id)).toEqual([
            2,
        ]);
    });

    it('keeps inline filters synchronized with the shell context', () => {
        component.setFilter('in-progress');

        expect(collectionContext.selectedCategoryId()).toBe('in-progress');
    });

    it('restores the selected filter from the manager query parameters', () => {
        queryParams.next(
            convertToParamMap({
                q: 'northwind',
                filter: 'series',
            })
        );
        TestBed.flushEffects();

        expect(collectionContext.selectedCategoryId()).toBe('series');
        expect(component.model().active).toEqual([]);
    });

    it('stores filter changes in the current history entry for focused-detail Back', () => {
        component.setFilter('movie');
        TestBed.flushEffects();

        expect(router.navigate).toHaveBeenCalledWith([], {
            relativeTo: activatedRoute,
            queryParams: { filter: 'movie' },
            queryParamsHandling: 'merge',
            replaceUrl: true,
        });
    });

    it('keeps tracked bytes scoped but independent from search and filter', () => {
        downloads.set([
            download(1, { bytesDownloaded: 10 }),
            download(2, {
                playlistId: 'playlist-b',
                bytesDownloaded: 100,
            }),
            download(3, { bytesDownloaded: 20 }),
        ]);
        routeParams.next(convertToParamMap({ id: 'playlist-a' }));
        collectionContext.setCategoryId('series');
        queryParams.next(convertToParamMap({ q: 'missing' }));
        fixture.detectChanges();

        expect(component.model().trackedBytes).toBe(30);
        expect(component.model().active).toEqual([]);
    });

    it.each([
        [
            'completed',
            'Remove from manager?',
            'downloaded media file remains on disk',
        ],
        [
            'paused',
            'Remove partial download?',
            'Retained partial download data will be deleted',
        ],
        [
            'failed',
            'Remove partial download?',
            'Retained partial download data will be deleted',
        ],
        [
            'canceled',
            'Remove partial download?',
            'Retained partial download data will be deleted',
        ],
    ] as const)(
        'uses truthful %s removal confirmation copy',
        async (status, title, message) => {
            const item = download(7, { status });

            component.runAction({ type: 'remove', item });

            expect(dialogConfigs).toHaveLength(1);
            expect(dialogConfigs[0]).toEqual(
                expect.objectContaining({ title })
            );
            expect(dialogConfigs[0].message).toContain(message);
            expect(downloadsService.removeDownload).not.toHaveBeenCalled();

            await dialogConfigs[0].onConfirm();
            expect(downloadsService.removeDownload).toHaveBeenCalledWith(7);
        }
    );

    it('describes both finalized and retained-partial outcomes when clearing', async () => {
        component.clearFinished();

        expect(dialogConfigs[0]).toEqual(
            expect.objectContaining({
                title: 'Clear finished downloads?',
                message:
                    'Completed files remain; retained partial data is deleted.',
            })
        );

        await dialogConfigs[0].onConfirm();
        expect(downloadsService.clearCompleted).toHaveBeenCalledWith(undefined);
    });

    it('passes playlist scope when clearing a scoped route', async () => {
        routeParams.next(convertToParamMap({ id: 'playlist-a' }));
        fixture.detectChanges();

        component.clearFinished();
        await dialogConfigs[0].onConfirm();

        expect(downloadsService.clearCompleted).toHaveBeenCalledWith(
            'playlist-a'
        );
    });

    it('holds an item pending until the authoritative operation settles', async () => {
        const operation = deferred<{ success: boolean }>();
        downloadsService.pauseDownload.mockReturnValueOnce(operation.promise);
        const item = download(8, { status: 'downloading' });

        const action = component.runAction({ type: 'pause', item });

        expect(component.pendingIds().has(8)).toBe(true);
        operation.resolve({ success: true });
        await expect(action).resolves.toBe('success');
        expect(component.pendingIds().has(8)).toBe(false);
    });

    it('does not dispatch the same pending item twice', async () => {
        const operation = deferred<{ success: boolean }>();
        downloadsService.pauseDownload.mockReturnValue(operation.promise);
        const item = download(9, { status: 'downloading' });

        const first = component.runAction({ type: 'pause', item });
        const second = component.runAction({ type: 'pause', item });

        expect(downloadsService.pauseDownload).toHaveBeenCalledTimes(1);
        await expect(second).resolves.toBe('ignored');
        operation.resolve({ success: true });
        await expect(first).resolves.toBe('success');
    });

    it('reports operation failures through the existing snackbar path', async () => {
        downloadsService.retryDownload.mockResolvedValueOnce({
            success: false,
            error: 'network offline',
        });

        await expect(
            component.runAction({
                type: 'retry',
                item: download(10, { status: 'failed' }),
            })
        ).resolves.toBe('failed');

        expect(snackBar.open).toHaveBeenCalledWith(
            'Action failed: network offline',
            undefined,
            expect.objectContaining({ duration: 4000 })
        );
    });

    it('moves a recovered missing file from attention into the active queue', async () => {
        const recovery = deferred<{ success: boolean }>();
        const item = download(16, {
            fileAvailability: 'missing',
            title: 'Missing movie',
        });
        downloadsService.redownloadMissing.mockReturnValueOnce(
            recovery.promise
        );
        downloads.set([item]);
        fixture.detectChanges();

        const attention = fixture.nativeElement.querySelector<HTMLElement>(
            '[data-test-id="downloads-attention-section"]'
        );
        const recover = attention?.querySelector<HTMLButtonElement>(
            '[data-test-action="redownload"]'
        );
        expect(attention?.textContent).toContain('File missing');
        expect(recover).not.toBeNull();

        recover?.click();
        fixture.detectChanges();
        expect(downloadsService.redownloadMissing).toHaveBeenCalledWith(16);
        expect(downloadsService.redownloadMissing.mock.calls[0]).toHaveLength(
            1
        );
        expect(component.pendingIds().has(16)).toBe(true);

        recovery.resolve({ success: true });
        await fixture.whenStable();
        downloads.set([
            {
                ...item,
                fileAvailability: 'not-applicable',
                status: 'queued',
            },
        ]);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="downloads-attention-section"]'
            )
        ).toBeNull();
        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="downloads-active-section"]'
            )?.textContent
        ).toContain('Missing movie');
        expect(component.pendingIds().has(16)).toBe(false);
    });

    it('refreshes a newly missing file before clearing pending state', async () => {
        const reload = deferred<void>();
        downloadsService.playDownload.mockResolvedValueOnce({
            error: 'File not found',
            success: false,
        });
        downloadsService.loadDownloads.mockReturnValueOnce(reload.promise);
        const item = download(17);

        const action = component.runAction({ type: 'play', item });
        await Promise.resolve();
        await Promise.resolve();

        expect(downloadsService.loadDownloads).toHaveBeenCalled();
        expect(component.pendingIds().has(17)).toBe(true);
        expect(snackBar.open).not.toHaveBeenCalled();

        reload.resolve();
        await expect(action).resolves.toBe('file-missing');

        expect(component.pendingIds().has(17)).toBe(false);
        expect(snackBar.open).toHaveBeenCalledWith(
            'File not found',
            undefined,
            expect.objectContaining({ duration: 3000 })
        );
    });

    it('reports a missing file path as a typed file-missing result', async () => {
        await expect(
            component.runAction({
                type: 'reveal',
                item: download(18, { filePath: undefined }),
            })
        ).resolves.toBe('file-missing');

        expect(downloadsService.revealFile).not.toHaveBeenCalled();
        expect(snackBar.open).toHaveBeenCalledWith(
            'File not found',
            undefined,
            expect.objectContaining({ duration: 3000 })
        );
    });

    it('routes dialog episode actions through the shared dispatcher and cleans up', async () => {
        const item = download(11, {
            contentType: 'episode',
            episodeNumber: 1,
            seasonNumber: 1,
            seriesXtreamId: 44,
            title: 'Series - S01E01 - Pilot',
        });
        const group = {
            kind: 'series',
            key: 'series:playlist-a:44',
            newestTimestamp: 1,
            sourceName: 'Alpha source',
            trackedBytes: 10,
            representative: item,
            members: [item],
            seriesXtreamId: 44,
            title: 'Series',
        } satisfies DownloadSeriesCardViewModel;
        downloads.set([item]);

        component.openDownloadedSeries(group);
        dialogActionListener?.({ type: 'play', item });
        await fixture.whenStable();

        expect(matDialog.open).toHaveBeenCalledWith(
            expect.any(Function),
            expect.objectContaining({
                data: group,
                maxWidth: 'min(720px, calc(100vw - 32px))',
                width: 'min(720px, calc(100vw - 32px))',
            })
        );
        expect(dialogSetInput).toHaveBeenCalledWith(
            'pendingIds',
            component.pendingIds
        );
        const membersInput = dialogSetInput.mock.calls.find(
            ([name]) => name === 'members'
        )?.[1] as (() => readonly DownloadItem[]) | undefined;
        expect(membersInput?.()).toEqual([item]);
        expect(downloadsService.playDownload).toHaveBeenCalledWith(
            item.filePath
        );

        downloads.set([]);
        expect(membersInput?.()).toEqual([]);

        dialogClosed.next();
        expect(dialogActionUnsubscribe).toHaveBeenCalledTimes(1);
    });

    it('uses the isolated navigation seam and reports a rejected route', async () => {
        const item = download(12);
        navigation.open.mockResolvedValueOnce(false);

        await component.openInLibrary(item);

        expect(navigation.canOpen).toHaveBeenCalledWith(
            item,
            new Set(['playlist-a', 'playlist-b'])
        );
        expect(navigation.open).toHaveBeenCalledWith(item);
        expect(snackBar.open).toHaveBeenCalledWith(
            'Action failed',
            undefined,
            expect.objectContaining({ duration: 4000 })
        );
    });

    it('opens removed-source movie artwork in its offline detail while explicit Play stays local', async () => {
        const item = download(17, {
            playlistId: 'removed-playlist',
            title: 'Signal',
            filePath: '/downloads/signal.mp4',
        });
        downloads.set([item]);
        await fixture.whenStable();

        const artworkButton = fixture.nativeElement.querySelector(
            '.download-library__artwork-button'
        ) as HTMLButtonElement;
        expect(artworkButton).toBeTruthy();

        artworkButton.click();
        await fixture.whenStable();

        expect(router.navigate).toHaveBeenCalledWith(['17'], {
            relativeTo: activatedRoute,
            state: { returnUrl: '/workspace/downloads?q=signal' },
        });
        expect(navigation.canOpen).not.toHaveBeenCalled();
        expect(navigation.open).not.toHaveBeenCalled();
        expect(downloadsService.playDownload).not.toHaveBeenCalled();

        jest.clearAllMocks();
        const menuTrigger = fixture.nativeElement.querySelector(
            '.download-library__more'
        ) as HTMLButtonElement;
        expect(menuTrigger).toBeTruthy();
        menuTrigger.click();
        await fixture.whenStable();

        const playButton = document.querySelector(
            'button[aria-label="Play: Signal"]'
        ) as HTMLButtonElement;
        expect(playButton).toBeTruthy();

        playButton.click();
        await fixture.whenStable();

        expect(downloadsService.playDownload).toHaveBeenCalledWith(
            item.filePath
        );
        expect(router.navigate).not.toHaveBeenCalled();
        expect(navigation.open).not.toHaveBeenCalled();

        document
            .querySelectorAll('.cdk-overlay-container')
            .forEach((element) => element.remove());
    });

    it('opens a grouped-series representative relative to the Xtream downloads route', async () => {
        const older = download(18, {
            contentType: 'episode',
            createdAt: '2026-07-18T12:00:00Z',
            episodeNumber: 1,
            seasonNumber: 1,
            seriesXtreamId: 77,
            title: 'Northwind - S01E01 - Arrival',
        });
        const representative = download(19, {
            contentType: 'episode',
            createdAt: '2026-07-19T12:00:00Z',
            episodeNumber: 2,
            seasonNumber: 1,
            seriesXtreamId: 77,
            title: 'Northwind - S01E02 - Signal',
        });
        routeParams.next(convertToParamMap({ id: 'playlist-a' }));
        router.url =
            '/workspace/xtreams/playlist-a/downloads?q=northwind&filter=series';
        downloads.set([older, representative]);
        await fixture.whenStable();

        const seriesArtwork = fixture.nativeElement.querySelector(
            '[data-test-id="download-library-series-open"].download-library__artwork-button'
        ) as HTMLButtonElement;
        expect(seriesArtwork).toBeTruthy();

        seriesArtwork.click();
        await fixture.whenStable();

        expect(router.navigate).toHaveBeenCalledWith(['19'], {
            relativeTo: activatedRoute,
            state: {
                returnUrl:
                    '/workspace/xtreams/playlist-a/downloads?q=northwind&filter=series',
            },
        });
        expect(navigation.open).not.toHaveBeenCalled();
    });

    it('keeps offline detail navigation relative to the Stalker downloads route', () => {
        routeParams.next(convertToParamMap({ id: 'playlist-a' }));
        router.url = '/workspace/stalker/playlist-a/downloads?q=signal';

        component.openOfflineDetail(download(22));

        expect(router.navigate).toHaveBeenCalledWith(['22'], {
            relativeTo: activatedRoute,
            state: {
                returnUrl: '/workspace/stalker/playlist-a/downloads?q=signal',
            },
        });
    });

    it('blocks only the exact pending download from opening offline detail', async () => {
        const operation = deferred<{ success: boolean }>();
        const pending = download(20, { status: 'downloading' });
        const ready = download(21);
        downloadsService.pauseDownload.mockReturnValueOnce(operation.promise);

        const action = component.runAction({ type: 'pause', item: pending });
        component.openOfflineDetail(pending);
        component.openOfflineDetail(ready);

        expect(router.navigate).toHaveBeenCalledTimes(1);
        expect(router.navigate).toHaveBeenCalledWith(['21'], {
            relativeTo: activatedRoute,
            state: { returnUrl: '/workspace/downloads?q=signal' },
        });

        operation.resolve({ success: true });
        await action;
    });

    it('does not navigate an item whose source playlist is missing', async () => {
        const item = download(13, { playlistId: 'removed-playlist' });
        navigation.canOpen.mockReturnValueOnce(false);

        await component.openInLibrary(item);

        expect(navigation.open).not.toHaveBeenCalled();
        expect(snackBar.open).toHaveBeenCalledWith(
            'Source playlist missing',
            undefined,
            expect.objectContaining({ duration: 3000 })
        );
    });

    it('renders one scroll owner with fixed controls and both child surfaces', () => {
        downloads.set([download(14, { status: 'downloading' }), download(15)]);
        fixture.detectChanges();

        const root = fixture.nativeElement as HTMLElement;
        expect(root.querySelectorAll('.downloads__content')).toHaveLength(1);
        expect(
            root.querySelector('[data-test-id="downloads-filters"]')
        ).toBeTruthy();
        expect(root.querySelector('app-download-queue')).toBeTruthy();
        expect(root.querySelector('app-download-library')).toBeTruthy();
    });
});
