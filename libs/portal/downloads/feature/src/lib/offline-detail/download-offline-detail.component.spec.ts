import { Location } from '@angular/common';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
    type DownloadItem,
    DownloadsService,
    SettingsStore,
} from '@iptvnator/services';
import type { DownloadMetadataSnapshot } from '@iptvnator/shared/interfaces';
import type { WorkspaceNavigationTarget } from '@iptvnator/portal/shared/util';
import { BehaviorSubject } from 'rxjs';
import type { DownloadActionResult } from '../download-actions';
import { DownloadLibraryNavigationService } from '../download-library-navigation.service';
import { DownloadManagerActionsService } from '../download-manager-actions.service';
import { DownloadOfflineDetailComponent } from './download-offline-detail.component';
import { DownloadOfflineFileCoordinatorService } from './download-offline-file-coordinator.service';
import { DownloadOfflineMetadataResolutionService } from './download-offline-metadata-resolution.service';
import { DownloadOfflineMetadataService } from './download-offline-metadata.service';
import { DownloadOfflineProviderCoordinatorService } from './download-offline-provider-coordinator.service';
import { DownloadOfflineSeasonSelectionService } from './download-offline-season-selection.service';
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
        FILE_ACTION_ERROR: 'The file action could not be completed.',
        FILE_NOT_FOUND: 'This downloaded file is no longer available on disk.',
        RETRY: 'Retry',
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
    readonly run: jest.Mock<Promise<DownloadActionResult>, [unknown]>;
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

const PROVIDER_TARGET: WorkspaceNavigationTarget = {
    link: ['/workspace', 'xtreams', 'playlist-a', 'vod', '7', '1017'],
};

describe('DownloadOfflineDetailComponent', () => {
    let fixture: ComponentFixture<DownloadOfflineDetailComponent>;
    let routeParams: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
    let downloads: DownloadsFake;
    let actions: ActionsFake;
    let navigation: {
        resolveProviderTarget: jest.Mock<
            Promise<WorkspaceNavigationTarget | null>,
            [DownloadItem]
        >;
        navigateResolvedTarget: jest.Mock<
            Promise<boolean>,
            [WorkspaceNavigationTarget]
        >;
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
        downloads = {
            downloads: signal<DownloadItem[]>([]),
            isLoadingDownloads: signal(false),
            hasLoadedDownloads: signal(true),
            loadDownloads: jest.fn().mockResolvedValue(undefined),
            formatBytes: jest.fn((bytes: number) => `${bytes / 1_024} KB`),
        };
        actions = {
            pendingIds: signal<ReadonlySet<number>>(new Set()),
            run: jest.fn().mockResolvedValue('success'),
            showActionError: jest.fn(),
        };
        navigation = {
            resolveProviderTarget: jest.fn().mockResolvedValue(PROVIDER_TARGET),
            navigateResolvedTarget: jest.fn().mockResolvedValue(true),
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
                    provide: SettingsStore,
                    useValue: { language: signal('en') },
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
                        DownloadOfflineFileCoordinatorService,
                        DownloadOfflineMetadataResolutionService,
                        DownloadOfflineProviderCoordinatorService,
                        DownloadOfflineRouteNavigationService,
                        DownloadOfflineSeasonSelectionService,
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
        expect(
            (fixture.nativeElement as HTMLElement)
                .querySelector('.offline-detail__portal-action')
                ?.hasAttribute('tabindex')
        ).toBe(false);
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
        expect(seasons[0].tabIndex).toBe(0);
        expect(seasons[1].tabIndex).toBe(-1);
        expect(seasons[0].id).toBe('offline-season-1-tab');
        expect(seasons[0].getAttribute('aria-controls')).toBe(
            'offline-season-1-panel'
        );
        expect(
            (fixture.nativeElement as HTMLElement)
                .querySelector('[role="tablist"]')
                ?.getAttribute('aria-label')
        ).toBe('2 downloaded episodes');
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
        expect(button('episode-play-19').getAttribute('aria-label')).toBe(
            'Play offline: S01E01 Arrival'
        );
        expect(button('episode-overflow-19')).toBeTruthy();
        button('episode-overflow-19').click();
        await fixture.whenStable();
        expect(button('episode-reveal-19').getAttribute('aria-label')).toBe(
            'Show in folder: S01E01 Arrival'
        );

        seasons[1].click();
        await fixture.whenStable();

        expect(seasons[1].getAttribute('aria-selected')).toBe('true');
        expect(text()).toContain('S02E01');
        expect(text()).not.toContain('Missing');
        const panel = (fixture.nativeElement as HTMLElement).querySelector(
            '[role="tabpanel"]'
        );
        expect(panel?.getAttribute('aria-labelledby')).toBe(
            'offline-season-2-tab'
        );
    });

    it('resolves the provider target with parent metadata merged from an older series member', async () => {
        routeParams.next(convertToParamMap({ downloadId: '18' }));
        router.url = '/workspace/downloads/18';
        const older = download(17, {
            contentType: 'episode',
            seriesXtreamId: 77,
            seasonNumber: 1,
            episodeNumber: 1,
            metadataSnapshot: snapshot('series', 'Northwind', {
                enrichedAt: '2026-01-01T00:00:00.000Z',
                providerCategoryId: '18',
            }),
        });
        const newest = download(18, {
            contentType: 'episode',
            seriesXtreamId: 77,
            seasonNumber: 1,
            episodeNumber: 2,
            metadataSnapshot: snapshot('series', 'Northwind', {
                enrichedAt: '2026-02-01T00:00:00.000Z',
            }),
        });

        await render([older, newest]);
        await Promise.resolve();
        fixture.detectChanges();

        expect(navigation.resolveProviderTarget).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 18,
                metadataSnapshot: expect.objectContaining({
                    providerCategoryId: '18',
                }),
            })
        );
    });

    it('moves season selection and focus with tablist keyboard controls', async () => {
        const episode = (id: number, seasonNumber: number) =>
            download(id, {
                contentType: 'episode',
                episodeNumber: 1,
                seasonNumber,
                seriesXtreamId: 77,
                title: `Northwind season ${seasonNumber}`,
            });
        await render([episode(17, 1), episode(18, 2)]);
        const tabs = () =>
            Array.from(
                (fixture.nativeElement as HTMLElement).querySelectorAll(
                    '[role="tab"]'
                )
            ) as HTMLButtonElement[];

        for (const [key, expected] of [
            ['ArrowRight', 1],
            ['ArrowLeft', 0],
            ['ArrowDown', 1],
            ['ArrowUp', 0],
            ['End', 1],
            ['Home', 0],
        ] as const) {
            const active = tabs().find(
                (tab) => tab.getAttribute('aria-selected') === 'true'
            );
            if (!active) throw new Error('Expected one selected season tab');
            const event = new KeyboardEvent('keydown', {
                key,
                bubbles: true,
                cancelable: true,
            });
            active.dispatchEvent(event);
            await fixture.whenStable();

            expect(event.defaultPrevented).toBe(true);
            expect(tabs()[expected].getAttribute('aria-selected')).toBe('true');
            expect(tabs()[expected].tabIndex).toBe(0);
            expect(document.activeElement).toBe(tabs()[expected]);
        }
    });

    it('persists the first-season fallback when a selected season disappears and later returns', async () => {
        const episode = (id: number, seasonNumber: number) =>
            download(id, {
                contentType: 'episode',
                episodeNumber: 1,
                seasonNumber,
                seriesXtreamId: 77,
                title: `Northwind season ${seasonNumber}`,
            });
        const first = episode(17, 1);
        const second = episode(18, 2);
        await render([first, second]);
        button('offline-season-2').click();
        await fixture.whenStable();
        button('offline-season-2').focus();
        expect(document.activeElement).toBe(button('offline-season-2'));

        downloads.downloads.set([first]);
        await fixture.whenStable();
        expect(button('offline-season-1').getAttribute('aria-selected')).toBe(
            'true'
        );
        expect(document.activeElement).toBe(button('offline-season-1'));

        downloads.downloads.set([first, second]);
        await fixture.whenStable();
        expect(button('offline-season-1').getAttribute('aria-selected')).toBe(
            'true'
        );
        expect(button('offline-season-2').getAttribute('aria-selected')).toBe(
            'false'
        );
    });

    it('normalizes season selection when the route is reused within one series', async () => {
        const episode = (id: number, seasonNumber: number) =>
            download(id, {
                contentType: 'episode',
                episodeNumber: 1,
                seasonNumber,
                seriesXtreamId: 77,
                title: `Northwind season ${seasonNumber}`,
            });
        await render([episode(17, 1), episode(18, 2)]);
        button('offline-season-2').click();
        await fixture.whenStable();

        routeParams.next(convertToParamMap({ downloadId: '18' }));
        router.url = '/workspace/downloads/18';
        await fixture.whenStable();

        expect(button('offline-season-1').getAttribute('aria-selected')).toBe(
            'true'
        );
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
        navigation.resolveProviderTarget.mockResolvedValueOnce(null);

        await render([download(17, { title: 'Orphaned movie' })]);
        await Promise.resolve();
        fixture.detectChanges();

        const viewButton = button('view-in-portal');
        expect(viewButton.disabled).toBe(true);
        expect(viewButton.getAttribute('aria-describedby')).toBe(
            'offline-view-in-portal-unavailable'
        );
        expect(text()).toContain('The source is unavailable');
        const wrapper = (fixture.nativeElement as HTMLElement).querySelector(
            '.offline-detail__portal-action'
        ) as HTMLElement;
        expect(wrapper.getAttribute('tabindex')).toBe('0');
        expect(wrapper.getAttribute('aria-describedby')?.split(' ')).toContain(
            'offline-view-in-portal-unavailable'
        );
        expect(wrapper.querySelector('button:not([disabled])')).toBeNull();
        expect(navigation.resolveProviderTarget).toHaveBeenCalledWith(
            expect.objectContaining({ id: 17 })
        );
    });

    it('keeps local playback available when provider resolution fails', async () => {
        navigation.resolveProviderTarget.mockRejectedValueOnce(
            new Error('playlist storage unavailable')
        );

        await render([download(17, { title: 'Offline survivor' })]);
        await Promise.resolve();
        fixture.detectChanges();

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
            const operation = deferred<DownloadActionResult>();
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
            expect(router.navigate).not.toHaveBeenCalled();
            operation.resolve('file-missing');
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
            downloads.downloads.set([
                download(17, { fileAvailability: 'missing' }),
            ]);
            await fixture.whenStable();
            expect(router.navigate).toHaveBeenCalledTimes(1);
        }
    );

    it('runs different episode file actions independently while deduplicating the same item', async () => {
        const first = deferred<DownloadActionResult>();
        const second = deferred<DownloadActionResult>();
        actions.run
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);
        const episode = (id: number, episodeNumber: number) =>
            download(id, {
                contentType: 'episode',
                episodeNumber,
                seasonNumber: 1,
                seriesXtreamId: 77,
                title: `Northwind - S01E0${episodeNumber}`,
            });
        await render([episode(17, 1), episode(18, 2)]);

        button('episode-play-17').click();
        button('episode-play-17').click();
        button('episode-play-18').click();

        expect(actions.run).toHaveBeenCalledTimes(2);
        expect(
            actions.run.mock.calls.map(([action]) => action.item.id)
        ).toEqual([17, 18]);

        second.resolve('success');
        first.resolve('success');
        await fixture.whenStable();
    });

    it.each(['failed', 'success'] as const)(
        'shows the missing-file transition when an action ends with %s after its row disappears',
        async (result) => {
            const operation = deferred<DownloadActionResult>();
            actions.run.mockReturnValueOnce(operation.promise);
            router.navigate.mockResolvedValueOnce(false);
            await render([download(17)]);

            button('offline-play').click();
            downloads.downloads.set([
                download(17, { fileAvailability: 'missing' }),
            ]);
            await fixture.whenStable();
            expect(router.navigate).not.toHaveBeenCalled();

            operation.resolve(result);
            await fixture.whenStable();
            fixture.detectChanges();
            await Promise.resolve();
            await fixture.whenStable();
            fixture.detectChanges();

            expect(router.navigate).toHaveBeenCalledWith(['..'], {
                relativeTo: expect.anything(),
                queryParamsHandling: 'preserve',
                replaceUrl: true,
            });
            expect(text()).toContain(
                'This downloaded file is no longer available on disk.'
            );
            expect(button('redirect-retry')).toBeTruthy();
        }
    );

    it('does not let an older episode action redirect a reused route in the same series', async () => {
        const operation = deferred<DownloadActionResult>();
        actions.run.mockReturnValueOnce(operation.promise);
        const episode = (id: number, episodeNumber: number) =>
            download(id, {
                contentType: 'episode',
                episodeNumber,
                seasonNumber: 1,
                seriesXtreamId: 77,
                title: `Northwind - S01E0${episodeNumber}`,
            });
        await render([episode(17, 1), episode(18, 2)]);

        button('episode-play-17').click();
        routeParams.next(convertToParamMap({ downloadId: '18' }));
        router.url = '/workspace/downloads/18';
        await fixture.whenStable();
        operation.resolve('file-missing');
        await fixture.whenStable();

        expect(text()).toContain('Northwind');
        expect(router.navigate).not.toHaveBeenCalled();
        expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('renders a retryable missing-file error when the redirect returns false', async () => {
        router.navigate
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true);

        await render([download(17, { fileAvailability: 'missing' })]);
        await Promise.resolve();
        fixture.detectChanges();

        expect(text()).toContain(
            'This downloaded file is no longer available on disk.'
        );
        expect(button('redirect-back').textContent).toContain(
            'Back to Downloads'
        );
        button('redirect-retry').click();
        await fixture.whenStable();
        expect(router.navigate).toHaveBeenCalledTimes(2);
    });

    it('renders the retryable missing-file error when redirect navigation rejects', async () => {
        router.navigate.mockRejectedValueOnce(new Error('router unavailable'));

        await render([download(17, { fileAvailability: 'missing' })]);
        await Promise.resolve();
        fixture.detectChanges();

        expect(text()).toContain(
            'This downloaded file is no longer available on disk.'
        );
        expect(button('redirect-retry').textContent).toContain('Retry');
    });

    it('ignores an older redirect failure after route reuse', async () => {
        const redirect = deferred<boolean>();
        router.navigate.mockReturnValueOnce(redirect.promise);
        await render([download(17, { fileAvailability: 'missing' })]);

        routeParams.next(convertToParamMap({ downloadId: '18' }));
        router.url = '/workspace/downloads/18';
        downloads.downloads.set([download(18, { title: 'Current route' })]);
        await fixture.whenStable();
        redirect.resolve(false);
        await fixture.whenStable();

        expect(text()).toContain('Current route');
        expect(text()).not.toContain(
            'This downloaded file is no longer available on disk.'
        );
    });

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

    it('does not restart metadata resolution for unrelated download emissions', async () => {
        const resolution = deferred<DownloadMetadataSnapshot>();
        const current = download(17, { title: 'Stable local title' });
        const unrelated = download(18, { title: 'Other download' });
        metadata.resolve.mockReturnValueOnce(resolution.promise);
        await render([current, unrelated]);

        downloads.downloads.set([
            { ...current, bytesDownloaded: 512 },
            { ...unrelated, bytesDownloaded: 256 },
        ]);
        await fixture.whenStable();
        downloads.downloads.set([
            { ...current, bytesDownloaded: 768 },
            { ...unrelated, bytesDownloaded: 512 },
        ]);
        await fixture.whenStable();

        expect(metadata.resolve).toHaveBeenCalledTimes(1);
        resolution.resolve(snapshot('movie', 'Stable resolved title'));
        await fixture.whenStable();
    });

    it('restarts metadata resolution when the current persisted snapshot changes', async () => {
        const firstResolution = deferred<DownloadMetadataSnapshot>();
        const secondResolution = deferred<DownloadMetadataSnapshot>();
        const current = download(17, { title: 'Local title' });
        metadata.resolve
            .mockReturnValueOnce(firstResolution.promise)
            .mockReturnValueOnce(secondResolution.promise);
        await render([current]);

        downloads.downloads.set([
            {
                ...current,
                metadataSnapshot: snapshot('movie', 'Persisted replacement'),
            },
        ]);
        await fixture.whenStable();

        expect(metadata.resolve).toHaveBeenCalledTimes(2);
        secondResolution.resolve(snapshot('movie', 'Fresh replacement'));
        await fixture.whenStable();
        firstResolution.resolve(snapshot('movie', 'Stale result'));
        await fixture.whenStable();
        expect(text()).toContain('Fresh replacement');
        expect(text()).not.toContain('Stale result');
    });

    it('opens the current provider target and reports a navigation failure without blocking local playback', async () => {
        navigation.navigateResolvedTarget.mockResolvedValueOnce(false);
        await render([download(17)]);

        button('view-in-portal').click();
        await fixture.whenStable();

        expect(navigation.navigateResolvedTarget).toHaveBeenCalledWith(
            PROVIDER_TARGET
        );
        expect(actions.showActionError).toHaveBeenCalledTimes(1);
        expect(button('offline-play').disabled).toBe(false);
    });

    it('keeps the provider action disabled while its exact target is resolving', async () => {
        const resolution = deferred<WorkspaceNavigationTarget | null>();
        navigation.resolveProviderTarget.mockReturnValueOnce(
            resolution.promise
        );
        await render([download(17)]);

        expect(button('view-in-portal').disabled).toBe(true);
        expect(button('view-in-portal').getAttribute('aria-busy')).toBe('true');
        expect(text()).not.toContain('The source is unavailable');

        resolution.resolve(PROVIDER_TARGET);
        await fixture.whenStable();
        fixture.detectChanges();
        expect(button('view-in-portal').disabled).toBe(false);
        expect(button('view-in-portal').getAttribute('aria-busy')).toBeNull();
    });

    it('uses one cached provider target and ignores duplicate open requests', async () => {
        const opening = deferred<boolean>();
        navigation.navigateResolvedTarget.mockReturnValueOnce(opening.promise);
        await render([download(17)]);

        const first = fixture.componentInstance.viewInPortal();
        const duplicate = fixture.componentInstance.viewInPortal();

        expect(navigation.resolveProviderTarget).toHaveBeenCalledTimes(1);
        expect(navigation.navigateResolvedTarget).toHaveBeenCalledTimes(1);
        await duplicate;
        opening.resolve(true);
        await first;
    });

    it('ignores a failed provider navigation after the route is reused while opening', async () => {
        const opening = deferred<boolean>();
        navigation.navigateResolvedTarget.mockReturnValueOnce(opening.promise);
        await render([download(17), download(18, { title: 'Current route' })]);

        const oldRouteAction = fixture.componentInstance.viewInPortal();
        routeParams.next(convertToParamMap({ downloadId: '18' }));
        router.url = '/workspace/downloads/18';
        await fixture.whenStable();
        opening.resolve(false);
        await oldRouteAction;

        expect(text()).toContain('Current route');
        expect(actions.showActionError).not.toHaveBeenCalled();
    });

    it('does not enable or navigate a stale provider target after route reuse', async () => {
        const first = deferred<WorkspaceNavigationTarget | null>();
        const second = deferred<WorkspaceNavigationTarget | null>();
        navigation.resolveProviderTarget
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);
        await render([download(17), download(18, { title: 'Current route' })]);

        routeParams.next(convertToParamMap({ downloadId: '18' }));
        router.url = '/workspace/downloads/18';
        await fixture.whenStable();
        first.resolve(PROVIDER_TARGET);
        await fixture.whenStable();
        fixture.detectChanges();

        expect(button('view-in-portal').disabled).toBe(true);
        button('view-in-portal').click();
        expect(navigation.navigateResolvedTarget).not.toHaveBeenCalled();
        second.resolve(null);
        await fixture.whenStable();
    });

    it.each(['false', 'reject'] as const)(
        'clears provider pending state when navigation returns %s',
        async (outcome) => {
            if (outcome === 'false') {
                navigation.navigateResolvedTarget.mockResolvedValueOnce(false);
            } else {
                navigation.navigateResolvedTarget.mockRejectedValueOnce(
                    new Error('router rejected')
                );
            }
            await render([download(17)]);

            button('view-in-portal').click();
            await fixture.whenStable();
            fixture.detectChanges();

            expect(button('view-in-portal').disabled).toBe(false);
            expect(
                button('view-in-portal').getAttribute('aria-busy')
            ).toBeNull();
            expect(actions.showActionError).toHaveBeenCalledTimes(1);
        }
    );

    it.each([
        [
            'global',
            '/workspace/downloads?q=signal&filter=movie',
            '/workspace/downloads/17',
        ],
        [
            'Xtream-scoped',
            '/workspace/xtreams/playlist-a/downloads?q=signal&filter=series',
            '/workspace/xtreams/playlist-a/downloads/17',
        ],
        [
            'Stalker-scoped',
            '/workspace/stalker/playlist-a/downloads?q=signal&filter=in-progress',
            '/workspace/stalker/playlist-a/downloads/17',
        ],
    ])(
        'uses browser Back for a validated %s manager return URL',
        async (_scope, returnUrl, detailUrl) => {
            historyState = {
                navigationId: 9,
                returnUrl,
            };
            router.url = detailUrl;
            await render([download(17)]);

            (
                (fixture.nativeElement as HTMLElement).querySelector(
                    '.hero__back-button'
                ) as HTMLButtonElement
            ).click();
            await fixture.whenStable();

            expect(location.back).toHaveBeenCalledTimes(1);
            expect(router.navigate).not.toHaveBeenCalled();
        }
    );

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
