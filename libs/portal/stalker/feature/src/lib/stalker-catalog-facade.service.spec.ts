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
            limit: signal(14),
            page: signal(0),
            getSelectedCategory: signal(null),
            getPaginatedContent: signal([]),
            selectedItem: signal(null),
            getTotalPages: signal(0),
            isPaginatedContentLoading: signal(false),
            currentPlaylist: signal(playlist),
            getSelectedCategoryName: jest.fn(() => null),
            setSelectedCategory: jest.fn(),
            clearSelectedItem: jest.fn(),
            setSearchPhrase: jest.fn(),
            setPage: jest.fn(),
            setLimit: jest.fn(),
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
});
