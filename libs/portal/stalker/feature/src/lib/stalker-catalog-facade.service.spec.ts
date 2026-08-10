import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';
import { PORTAL_PLAYBACK_POSITIONS } from '@iptvnator/portal/shared/util';
import { PlaybackPositionRuntimeBridgeService } from '@iptvnator/services';
import { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import { StalkerCatalogFacadeService } from './stalker-catalog-facade.service';

describe('StalkerCatalogFacadeService', () => {
    const playlist = {
        _id: 'playlist-1',
        title: 'Demo Stalker',
        portalUrl: 'http://demo.example/stalker_portal/server/load.php',
        macAddress: '00:1A:79:00:00:01',
        userAgent: 'DemoAgent',
        referrer: 'http://demo.example',
        origin: 'http://demo.example',
    };
    const unsubscribe = jest.fn();
    let playbackUpdateHandler:
        ((data: PlaybackPositionData) => void) | undefined;
    let playbackPositionBridge: {
        onPlaybackPositionUpdate: jest.Mock<
            (() => void) | undefined,
            [(data: PlaybackPositionData) => void]
        >;
    };
    let playbackPositions: {
        savePlaybackPosition: jest.Mock<
            Promise<void>,
            [string, PlaybackPositionData]
        >;
        getPlaybackPosition: jest.Mock<
            Promise<PlaybackPositionData | null>,
            [string, number, 'vod' | 'episode']
        >;
        getSeriesPlaybackPositions: jest.Mock<
            Promise<PlaybackPositionData[]>,
            [string, number]
        >;
        getRecentPlaybackPositions?: jest.Mock;
        getAllPlaybackPositions: jest.Mock<
            Promise<PlaybackPositionData[]>,
            [string]
        >;
        clearPlaybackPosition: jest.Mock<
            Promise<void>,
            [string, number, 'vod' | 'episode']
        >;
    };
    let stalkerStoreMock: Record<string, unknown> & {
        setSearchPhrase: jest.Mock;
        setSelectedItem: jest.Mock;
    };

    beforeEach(() => {
        playbackUpdateHandler = undefined;
        unsubscribe.mockReset();
        playbackPositions = {
            savePlaybackPosition: jest.fn().mockResolvedValue(undefined),
            getPlaybackPosition: jest.fn().mockResolvedValue(null),
            getSeriesPlaybackPositions: jest.fn().mockResolvedValue([]),
            getAllPlaybackPositions: jest.fn().mockResolvedValue([]),
            clearPlaybackPosition: jest.fn().mockResolvedValue(undefined),
        };
        playbackPositionBridge = {
            onPlaybackPositionUpdate: jest.fn(
                (handler: (data: PlaybackPositionData) => void) => {
                    playbackUpdateHandler = handler;
                    return unsubscribe;
                }
            ),
        };
        stalkerStoreMock = {
            selectedContentType: signal<'vod' | 'series' | 'itv'>('vod'),
            page: signal(0),
            selectedCategoryId: signal<string | null>('5'),
            searchPhrase: signal(''),
            getSelectedCategory: signal(null),
            getPaginatedContent: signal([]),
            selectedItem: signal(null),
            hasMoreContent: signal(false),
            hasContentAppendError: signal(false),
            isPaginatedContentLoading: signal(false),
            currentPlaylist: signal(playlist),
            getSelectedCategoryName: jest.fn(() => null),
            setSelectedCategory: jest.fn(),
            clearSelectedItem: jest.fn(),
            setSearchPhrase: jest.fn(),
            nextPage: jest.fn(),
            retryContentPage: jest.fn(),
            setSelectedItem: jest.fn(),
            createLinkToPlayVod: jest.fn(),
            addToFavorites: jest.fn(),
            removeFromFavorites: jest.fn(),
            fetchMovieFileId: jest.fn(),
            fetchLinkToPlay: jest.fn(),
            resolveVodPlayback: jest.fn(),
        };

        TestBed.configureTestingModule({
            providers: [
                StalkerCatalogFacadeService,
                {
                    provide: StalkerStore,
                    useValue: stalkerStoreMock,
                },
                {
                    provide: PORTAL_PLAYBACK_POSITIONS,
                    useValue: playbackPositions,
                },
                {
                    provide: PlaybackPositionRuntimeBridgeService,
                    useValue: playbackPositionBridge,
                },
            ],
        });
    });

    it('delegates category search query updates to the Stalker store', () => {
        const service = TestBed.inject(StalkerCatalogFacadeService);

        service.setSearchQuery('matrix');

        expect(stalkerStoreMock.setSearchPhrase).toHaveBeenCalledWith('matrix');
    });

    it.each([true, 1, '1'] as const)(
        'normalizes supported is_series flag %p when selecting an item',
        (isSeries) => {
            const service = TestBed.inject(StalkerCatalogFacadeService);

            service.selectItem({ id: '42', is_series: isSeries });

            expect(stalkerStoreMock.setSelectedItem).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: '42',
                    is_series: true,
                })
            );
        }
    );

    it.each([true, 1, '1'] as const)(
        'returns empty series progress for supported is_series flag %p',
        (isSeries) => {
            const service = TestBed.inject(StalkerCatalogFacadeService);

            expect(
                service.getItemProgress({ id: '42', is_series: isSeries })
            ).toEqual({ hasSeriesProgress: false });
        }
    );

    it.each([false, 0] as const)(
        'keeps non-series flag %p on the ordinary VOD path',
        (isSeries) => {
            const service = TestBed.inject(StalkerCatalogFacadeService);
            const item = { id: '42', is_series: isSeries };

            service.selectItem(item);

            expect(stalkerStoreMock.setSelectedItem).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: '42',
                    is_series: undefined,
                })
            );
            expect(service.getItemProgress(item)).toEqual({
                progress: 0,
                isWatched: false,
            });
        }
    );

    it('persists matching external playback updates for the current playlist', async () => {
        TestBed.inject(StalkerCatalogFacadeService);
        await Promise.resolve();

        expect(playbackUpdateHandler).toBeDefined();

        playbackUpdateHandler?.({
            playlistId: playlist._id,
            contentXtreamId: 17359,
            contentType: 'vod',
            positionSeconds: 42,
            durationSeconds: 5400,
        });
        await Promise.resolve();

        expect(playbackPositions.savePlaybackPosition).toHaveBeenCalledWith(
            playlist._id,
            expect.objectContaining({
                playlistId: playlist._id,
                contentXtreamId: 17359,
                contentType: 'vod',
                positionSeconds: 42,
                durationSeconds: 5400,
            })
        );
    });

    it('ignores external playback updates for other playlists', async () => {
        TestBed.inject(StalkerCatalogFacadeService);
        await Promise.resolve();

        playbackUpdateHandler?.({
            playlistId: 'playlist-2',
            contentXtreamId: 17359,
            contentType: 'vod',
            positionSeconds: 42,
            durationSeconds: 5400,
        });
        await Promise.resolve();

        expect(playbackPositions.savePlaybackPosition).not.toHaveBeenCalled();
    });

    it('splits loading into the initial skeleton and the append tail by portal page', () => {
        const service = TestBed.inject(StalkerCatalogFacadeService);
        const loading = stalkerStoreMock['isPaginatedContentLoading'] as ReturnType<
            typeof signal<boolean>
        >;
        const page = stalkerStoreMock['page'] as ReturnType<
            typeof signal<number>
        >;

        loading.set(true);
        page.set(0);
        expect(service.isPaginatedContentLoading()).toBe(true);
        expect(service.isAppending()).toBe(false);

        page.set(1);
        expect(service.isPaginatedContentLoading()).toBe(false);
        expect(service.isAppending()).toBe(true);
    });

    it('guards loadMore behind loading, append errors, and hasMore', () => {
        const service = TestBed.inject(StalkerCatalogFacadeService);
        const loading = stalkerStoreMock['isPaginatedContentLoading'] as ReturnType<
            typeof signal<boolean>
        >;
        const hasMore = stalkerStoreMock['hasMoreContent'] as ReturnType<
            typeof signal<boolean>
        >;
        const appendError = stalkerStoreMock[
            'hasContentAppendError'
        ] as ReturnType<typeof signal<boolean>>;
        const nextPage = stalkerStoreMock['nextPage'] as jest.Mock;

        service.loadMore();
        expect(nextPage).not.toHaveBeenCalled();

        hasMore.set(true);
        loading.set(true);
        service.loadMore();
        expect(nextPage).not.toHaveBeenCalled();

        loading.set(false);
        appendError.set(true);
        service.loadMore();
        expect(nextPage).not.toHaveBeenCalled();

        appendError.set(false);
        service.loadMore();
        expect(nextPage).toHaveBeenCalledTimes(1);

        service.retryAppend();
        expect(stalkerStoreMock['retryContentPage']).toHaveBeenCalledTimes(1);
    });

    it('keeps scroll positions per list identity across detours', () => {
        const service = TestBed.inject(StalkerCatalogFacadeService);
        const categoryId = stalkerStoreMock['selectedCategoryId'] as ReturnType<
            typeof signal<string | null>
        >;

        categoryId.set('5');
        service.saveScrollPosition(420);

        // A detour through another category saves its own spot without
        // destroying the first one.
        categoryId.set('7');
        service.saveScrollPosition(50);
        expect(service.consumeSavedScrollPosition()).toBe(50);

        categoryId.set('5');
        expect(service.consumeSavedScrollPosition()).toBe(420);
        // One-shot: consumed positions do not restore twice.
        expect(service.consumeSavedScrollPosition()).toBeNull();
    });

    it('never restores a saved offset onto another portal', () => {
        // The route provider (and this facade) survives a same-config portal
        // switch — the identity must include the playlist.
        const service = TestBed.inject(StalkerCatalogFacadeService);
        const currentPlaylist = stalkerStoreMock['currentPlaylist'] as ReturnType<
            typeof signal<{ _id: string } | undefined>
        >;

        service.saveScrollPosition(420);

        currentPlaylist.set({ _id: 'portal-b' });
        expect(service.consumeSavedScrollPosition()).toBeNull();

        currentPlaylist.set(playlist as { _id: string });
        expect(service.consumeSavedScrollPosition()).toBe(420);
    });
});
