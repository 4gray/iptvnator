import { Location } from '@angular/common';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
    type DownloadItem,
    DownloadsService,
    PlaylistsService,
} from '@iptvnator/services';
import type {
    DownloadMetadataSnapshot,
    Playlist,
} from '@iptvnator/shared/interfaces';
import { BehaviorSubject, type Observable, throwError } from 'rxjs';
import { DownloadLibraryNavigationService } from '../download-library-navigation.service';
import { DownloadManagerActionsService } from '../download-manager-actions.service';
import { DownloadOfflineDetailComponent } from './download-offline-detail.component';
import { DownloadOfflineMetadataResolutionService } from './download-offline-metadata-resolution.service';
import { DownloadOfflineMetadataService } from './download-offline-metadata.service';
import { DownloadOfflineRouteNavigationService } from './download-offline-route-navigation.service';

const TRANSLATIONS = {
    DOWNLOADS: {
        ACTION_FAILED: 'Action failed',
        MORE_ACTIONS: 'More actions',
        REVEAL: 'Show in folder',
        SEASON: 'Season {{season}}',
        OFFLINE_DETAIL: {
            AVAILABLE: 'Available offline',
            PLAY: 'Play offline',
            VIEW_IN_PORTAL: 'View in portal',
            VIEW_IN_PORTAL_UNAVAILABLE: 'The source is unavailable',
            DOWNLOADED_EPISODES: '{{count}} downloaded episodes',
            FILE_SIZE: '{{size}}',
            NOT_FOUND_TITLE: 'Download not found',
            NOT_FOUND_BODY: 'This download is no longer in the manager.',
            BACK: 'Back to Downloads',
        },
    },
    XTREAM: {
        ACTORS: 'Cast',
        DIRECTOR: 'Creators',
    },
    SHOW_LESS: 'Show less',
    SHOW_MORE: 'Show more',
} as const;

interface Deferred<T> {
    readonly promise: Promise<T>;
    readonly resolve: (value: T) => void;
}

interface DownloadsFake {
    readonly downloads: ReturnType<typeof signal<DownloadItem[]>>;
    readonly isLoadingDownloads: ReturnType<typeof signal<boolean>>;
    readonly hasLoadedDownloads: ReturnType<typeof signal<boolean>>;
    readonly loadDownloads: jest.Mock<Promise<void>, []>;
    readonly formatBytes: jest.Mock<string, [number]>;
}

interface ActionsFake {
    readonly pendingIds: ReturnType<typeof signal<ReadonlySet<number>>>;
    readonly run: jest.Mock<Promise<void>, [unknown]>;
    readonly showActionError: jest.Mock<void, []>;
}

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

function snapshot(
    mediaKind: DownloadMetadataSnapshot['mediaKind'],
    title: string,
    overrides: Partial<DownloadMetadataSnapshot> = {}
): DownloadMetadataSnapshot {
    return {
        version: 1,
        language: 'en',
        mediaKind,
        title,
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
        xtreamId: 1_000 + id,
        contentType: 'vod',
        title: `Download ${id}`,
        url: `https://media.example.test/${id}`,
        filePath: `/downloads/${id}.mp4`,
        fileAvailability: 'available',
        status: 'completed',
        totalBytes: 1_024,
        ...overrides,
    };
}

function playlist(id: string): Playlist {
    return { _id: id, title: id } as Playlist;
}

describe('DownloadOfflineDetailComponent', () => {
    let fixture: ComponentFixture<DownloadOfflineDetailComponent>;
    let routeParams: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
    let playlistItems: BehaviorSubject<Playlist[]>;
    let playlistsObservable: Observable<Playlist[]>;
    let downloads: DownloadsFake;
    let actions: ActionsFake;
    let navigation: {
        canOpen: jest.Mock<boolean, [DownloadItem, ReadonlySet<string>]>;
        open: jest.Mock<Promise<boolean>, [DownloadItem]>;
    };
    let metadata: {
        resolve: jest.Mock<Promise<DownloadMetadataSnapshot>, [unknown]>;
    };
    let router: {
        url: string;
        navigate: jest.Mock;
        navigateByUrl: jest.Mock;
    };
    let historyState: Record<string, unknown>;
    let location: { back: jest.Mock; getState: jest.Mock };

    beforeEach(async () => {
        routeParams = new BehaviorSubject(
            convertToParamMap({ downloadId: '17' })
        );
        playlistItems = new BehaviorSubject([playlist('playlist-a')]);
        playlistsObservable = playlistItems.asObservable();
        downloads = {
            downloads: signal<DownloadItem[]>([]),
            isLoadingDownloads: signal(false),
            hasLoadedDownloads: signal(true),
            loadDownloads: jest.fn().mockResolvedValue(undefined),
            formatBytes: jest.fn((bytes: number) => `${bytes / 1_024} KB`),
        };
        actions = {
            pendingIds: signal<ReadonlySet<number>>(new Set()),
            run: jest.fn().mockResolvedValue(undefined),
            showActionError: jest.fn(),
        };
        navigation = {
            canOpen: jest.fn((item, availableIds) =>
                availableIds.has(item.playlistId)
            ),
            open: jest.fn().mockResolvedValue(true),
        };
        metadata = {
            resolve: jest.fn(async (detail: unknown) => {
                const value = detail as {
                    kind: 'movie' | 'series';
                    item?: DownloadItem;
                    representative?: DownloadItem;
                    snapshot?: DownloadMetadataSnapshot;
                };
                const item = value.item ?? value.representative;
                return (
                    value.snapshot ??
                    snapshot(value.kind, item?.title ?? 'Offline download')
                );
            }),
        };
        router = {
            url: '/workspace/downloads/17',
            navigate: jest.fn().mockResolvedValue(true),
            navigateByUrl: jest.fn().mockResolvedValue(true),
        };
        historyState = {};
        location = {
            back: jest.fn(),
            getState: jest.fn(() => historyState),
        };

        const activatedRoute = {
            paramMap: routeParams.asObservable(),
            snapshot: {
                paramMap: routeParams.value,
                params: { downloadId: '17' },
            },
        };

        await TestBed.configureTestingModule({
            imports: [
                DownloadOfflineDetailComponent,
                NoopAnimationsModule,
                TranslateModule.forRoot(),
            ],
            providers: [
                { provide: ActivatedRoute, useValue: activatedRoute },
                { provide: Router, useValue: router },
                { provide: Location, useValue: location },
                {
                    provide: DownloadsService,
                    useValue: downloads,
                },
                {
                    provide: PlaylistsService,
                    useValue: {
                        getAllPlaylists: () => playlistsObservable,
                    },
                },
            ],
        })
            .overrideComponent(DownloadOfflineDetailComponent, {
                set: {
                    providers: [
                        {
                            provide: DownloadManagerActionsService,
                            useValue: actions,
                        },
                        {
                            provide: DownloadLibraryNavigationService,
                            useValue: navigation,
                        },
                        {
                            provide: DownloadOfflineMetadataService,
                            useValue: metadata,
                        },
                        DownloadOfflineMetadataResolutionService,
                        DownloadOfflineRouteNavigationService,
                    ],
                },
            })
            .compileComponents();

        const translate = TestBed.inject(TranslateService);
        translate.setTranslation('en', TRANSLATIONS);
        translate.use('en');
    });

    afterEach(() => fixture?.destroy());

    async function render(items: DownloadItem[] = []): Promise<void> {
        downloads.downloads.set(items);
        fixture = TestBed.createComponent(DownloadOfflineDetailComponent);
        await fixture.whenStable();
    }

    function text(): string {
        return (fixture.nativeElement as HTMLElement).textContent ?? '';
    }

    function button(testId: string): HTMLButtonElement {
        const selector = `[data-testid="${testId}"]`;
        const element =
            (fixture.nativeElement as HTMLElement).querySelector(selector) ??
            document.body.querySelector(selector);
        expect(element).toBeTruthy();
        return element as HTMLButtonElement;
    }

    it('loads downloads on entry and renders the focused loading state', async () => {
        downloads.hasLoadedDownloads.set(false);
        downloads.isLoadingDownloads.set(true);

        await render();

        expect(downloads.loadDownloads).toHaveBeenCalledTimes(1);
        expect(
            (fixture.nativeElement as HTMLElement).querySelector(
                'ngx-skeleton-loader'
            )
        ).toBeTruthy();
        expect(text()).not.toContain('Download not found');
    });

    it('renders persisted movie metadata immediately with row artwork fallback and local-only actions', async () => {
        const movie = download(17, {
            posterUrl: 'https://images.example.test/fallback.jpg',
            totalBytes: 2_048,
            metadataSnapshot: snapshot('movie', 'Signal', {
                plot: 'A local-first mystery.',
                year: 2026,
                durationMinutes: 112,
                genres: ['Drama', 'Mystery'],
                rating: 8.4,
                status: 'Released',
                cast: [{ name: 'Ada Actor', role: 'Mara' }],
                creators: [{ name: 'Cora Creator' }],
            }),
        });

        await render([movie]);

        expect(text()).toContain('Signal');
        expect(text()).toContain('A local-first mystery.');
        expect(text()).toContain('Available offline');
        expect(text()).toContain('2026');
        expect(text()).toContain('112 min');
        expect(text()).toContain('Drama');
        expect(text()).toContain('8.4');
        expect(text()).toContain('Released');
        expect(text()).toContain('Ada Actor');
        expect(text()).toContain('Cora Creator');
        expect(text()).toContain('2 KB');
        expect(text()).not.toContain('{{size}}');
        expect(downloads.formatBytes).toHaveBeenCalledWith(2_048);
        expect(
            (fixture.nativeElement as HTMLElement).querySelector(
                'img[src="https://images.example.test/fallback.jpg"]'
            )
        ).toBeTruthy();
        expect(button('offline-play').textContent).toContain('Play offline');
        expect(button('view-in-portal').textContent).toContain(
            'View in portal'
        );
        expect(button('movie-overflow')).toBeTruthy();
        expect(text()).not.toContain('Play from source');
    });

    it('omits sparse facts and does not format non-positive or non-finite file sizes', async () => {
        await render([
            download(17, {
                title: 'Sparse movie',
                totalBytes: Number.NaN,
                bytesDownloaded: 0,
                metadataSnapshot: snapshot('movie', 'Sparse movie', {
                    durationMinutes: -1,
                    genres: ['  '],
                    rating: Number.POSITIVE_INFINITY,
                    status: '  ',
                    year: Number.NaN,
                }),
            }),
        ]);

        expect(text()).toContain('Sparse movie');
        expect(text()).not.toContain('File size');
        expect(text()).not.toContain('Infinity');
        expect(downloads.formatBytes).not.toHaveBeenCalled();
    });

    it('renders only available series seasons and episodes in natural order with explicit local actions', async () => {
        const seriesMetadata = snapshot('series', 'Northwind', {
            plot: 'Signals travel north.',
        });
        const episode = (
            id: number,
            seasonNumber: number,
            episodeNumber: number,
            title: string,
            overrides: Partial<DownloadItem> = {}
        ) =>
            download(id, {
                contentType: 'episode',
                seriesXtreamId: 77,
                seasonNumber,
                episodeNumber,
                title,
                metadataSnapshot: {
                    ...seriesMetadata,
                    episode: { seasonNumber, episodeNumber, title },
                },
                ...overrides,
            });

        await render([
            episode(17, 2, 1, 'Second season'),
            episode(18, 1, 2, 'The Signal'),
            episode(19, 1, 1, 'Arrival'),
            episode(20, 1, 3, 'Missing', {
                fileAvailability: 'missing',
            }),
        ]);

        expect(text()).toContain('Northwind');
        expect(button('view-in-portal')).toBeTruthy();
        expect(
            (fixture.nativeElement as HTMLElement).querySelector(
                '[data-testid="offline-play"]'
            )
        ).toBeNull();
        const seasons = Array.from(
            (fixture.nativeElement as HTMLElement).querySelectorAll(
                '[data-testid^="offline-season-"]'
            )
        ) as HTMLButtonElement[];
        expect(seasons).toHaveLength(2);
        expect(seasons[0].getAttribute('aria-selected')).toBe('true');
        expect(seasons[0].textContent).toContain('2 downloaded episodes');
        const firstSeasonEpisodes = Array.from(
            (fixture.nativeElement as HTMLElement).querySelectorAll(
                '[data-testid^="offline-episode-"]'
            )
        ) as HTMLElement[];
        expect(
            firstSeasonEpisodes.map(({ dataset }) => dataset['testid'])
        ).toEqual(['offline-episode-19', 'offline-episode-18']);
        expect(firstSeasonEpisodes[0].textContent).toContain('S01E01');
        expect(firstSeasonEpisodes[0].textContent).toContain('Arrival');
        expect(firstSeasonEpisodes[0].textContent).toContain(
            'Available offline'
        );
        expect(button('episode-play-19')).toBeTruthy();
        expect(button('episode-overflow-19')).toBeTruthy();

        seasons[1].click();
        await fixture.whenStable();

        expect(seasons[1].getAttribute('aria-selected')).toBe('true');
        expect(text()).toContain('S02E01');
        expect(text()).not.toContain('Missing');
    });

    it('shows a focused not-found state when the row is absent after the initial load', async () => {
        await render();

        expect(text()).toContain('Download not found');
        expect(text()).toContain('This download is no longer in the manager.');
        expect(button('not-found-back').textContent).toContain(
            'Back to Downloads'
        );
        expect(router.navigate).not.toHaveBeenCalled();
        expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('keeps View in portal visible but disabled and described when its source playlist is missing', async () => {
        playlistItems.next([]);
        navigation.canOpen.mockReturnValue(false);

        await render([download(17, { title: 'Orphaned movie' })]);

        const viewButton = button('view-in-portal');
        expect(viewButton.disabled).toBe(true);
        expect(viewButton.getAttribute('aria-describedby')).toBe(
            'offline-view-in-portal-unavailable'
        );
        expect(text()).toContain('The source is unavailable');
        expect(navigation.canOpen).toHaveBeenCalledWith(
            expect.objectContaining({ id: 17 }),
            new Set()
        );
    });

    it('keeps local playback available when loading source playlists fails', async () => {
        playlistsObservable = throwError(
            () => new Error('playlist storage unavailable')
        );

        await render([download(17, { title: 'Offline survivor' })]);

        expect(text()).toContain('Offline survivor');
        expect(button('offline-play').disabled).toBe(false);
        expect(button('view-in-portal').disabled).toBe(true);
    });

    it('replace-navigates to the validated manager return URL when a completed file is initially missing', async () => {
        historyState = {
            navigationId: 4,
            returnUrl: '/workspace/downloads?q=signal&filter=movie',
        };

        await render([
            download(17, {
                fileAvailability: 'missing',
            }),
        ]);

        expect(router.navigateByUrl).toHaveBeenCalledWith(
            '/workspace/downloads?q=signal&filter=movie',
            { replaceUrl: true }
        );
        expect(router.navigate).not.toHaveBeenCalled();
    });

    it.each(['play', 'reveal'] as const)(
        'returns to the manager when a local %s race reloads the current file as missing',
        async (actionType) => {
            const operation = deferred<void>();
            actions.run.mockReturnValueOnce(operation.promise);
            await render([download(17), download(18, { title: 'Other' })]);

            button(
                actionType === 'play' ? 'offline-play' : 'movie-overflow'
            ).click();
            if (actionType === 'reveal') {
                await fixture.whenStable();
                button('movie-reveal').click();
            }
            actions.pendingIds.set(new Set([17]));
            await fixture.whenStable();

            expect(button('offline-play').disabled).toBe(true);
            expect(button('view-in-portal').disabled).toBe(false);
            downloads.downloads.set([
                download(17, { fileAvailability: 'missing' }),
                download(18, { title: 'Other' }),
            ]);
            operation.resolve(undefined);
            await fixture.whenStable();

            expect(actions.run).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: actionType,
                    item: expect.objectContaining({ id: 17 }),
                })
            );
            expect(router.navigate).toHaveBeenCalledWith(['..'], {
                relativeTo: expect.anything(),
                queryParamsHandling: 'preserve',
                replaceUrl: true,
            });
        }
    );

    it('reacts to route reuse and displays the new row before metadata resolution completes', async () => {
        const secondResolution = deferred<DownloadMetadataSnapshot>();
        metadata.resolve
            .mockResolvedValueOnce(snapshot('movie', 'Resolved first'))
            .mockReturnValueOnce(secondResolution.promise);
        await render([
            download(17, { title: 'Local first' }),
            download(18, { title: 'Local second' }),
        ]);

        routeParams.next(convertToParamMap({ downloadId: '18' }));
        router.url = '/workspace/downloads/18';
        await fixture.whenStable();

        expect(text()).toContain('Local second');
        expect(text()).not.toContain('Resolved first');
        expect(metadata.resolve).toHaveBeenCalledTimes(2);
    });

    it('discards an older asynchronous metadata result after a route-id change', async () => {
        const firstResolution = deferred<DownloadMetadataSnapshot>();
        const secondResolution = deferred<DownloadMetadataSnapshot>();
        metadata.resolve
            .mockReturnValueOnce(firstResolution.promise)
            .mockReturnValueOnce(secondResolution.promise);
        await render([
            download(17, { title: 'Local first' }),
            download(18, { title: 'Local second' }),
        ]);

        routeParams.next(convertToParamMap({ downloadId: '18' }));
        router.url = '/workspace/downloads/18';
        await fixture.whenStable();
        secondResolution.resolve(snapshot('movie', 'Resolved second'));
        await fixture.whenStable();
        firstResolution.resolve(snapshot('movie', 'Stale first'));
        await fixture.whenStable();

        expect(text()).toContain('Resolved second');
        expect(text()).not.toContain('Stale first');
    });

    it('opens the current provider target and reports a navigation failure without blocking local playback', async () => {
        navigation.open.mockResolvedValueOnce(false);
        await render([download(17)]);

        button('view-in-portal').click();
        await fixture.whenStable();

        expect(navigation.open).toHaveBeenCalledWith(
            expect.objectContaining({ id: 17 })
        );
        expect(actions.showActionError).toHaveBeenCalledTimes(1);
        expect(button('offline-play').disabled).toBe(false);
    });

    it('uses browser Back only for a validated manager return URL', async () => {
        historyState = {
            navigationId: 9,
            returnUrl: '/workspace/downloads?q=signal',
        };
        await render([download(17)]);

        (
            (fixture.nativeElement as HTMLElement).querySelector(
                '.hero__back-button'
            ) as HTMLButtonElement
        ).click();
        await fixture.whenStable();

        expect(location.back).toHaveBeenCalledTimes(1);
        expect(router.navigate).not.toHaveBeenCalled();
    });

    it('rejects an external return URL and falls back to the scoped parent safely', async () => {
        historyState = {
            navigationId: 9,
            returnUrl: 'https://evil.example.test/workspace/downloads',
        };
        router.url = '/workspace/stalker/playlist-a/downloads/17';
        await render([download(17)]);

        (
            (fixture.nativeElement as HTMLElement).querySelector(
                '.hero__back-button'
            ) as HTMLButtonElement
        ).click();
        await fixture.whenStable();

        expect(location.back).not.toHaveBeenCalled();
        expect(router.navigate).toHaveBeenCalledWith(['..'], {
            relativeTo: expect.anything(),
            queryParamsHandling: 'preserve',
        });
        expect(router.navigateByUrl).not.toHaveBeenCalled();
    });
});
