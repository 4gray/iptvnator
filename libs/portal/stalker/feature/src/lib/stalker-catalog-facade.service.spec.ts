import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';
import { PORTAL_PLAYBACK_POSITIONS } from '@iptvnator/portal/shared/util';
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
        | ((data: PlaybackPositionData) => void)
        | undefined;
    let playbackPositions: {
        savePlaybackPosition: jest.Mock<Promise<void>, [string, PlaybackPositionData]>;
        getPlaybackPosition: jest.Mock<Promise<PlaybackPositionData | null>, [string, number, 'vod' | 'episode']>;
        getSeriesPlaybackPositions: jest.Mock<Promise<PlaybackPositionData[]>, [string, number]>;
        getRecentPlaybackPositions?: jest.Mock;
        getAllPlaybackPositions: jest.Mock<Promise<PlaybackPositionData[]>, [string]>;
        clearPlaybackPosition: jest.Mock<Promise<void>, [string, number, 'vod' | 'episode']>;
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

        (window as Window & { electron?: typeof window.electron }).electron = {
            ...(window.electron ?? {}),
            onPlaybackPositionUpdate: jest.fn(
                (handler: (data: PlaybackPositionData) => void) => {
                    playbackUpdateHandler = handler;
                    return unsubscribe;
                }
            ),
        };

        TestBed.configureTestingModule({
            providers: [
                StalkerCatalogFacadeService,
                {
                    provide: StalkerStore,
                    useValue: {
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
                    },
                },
                {
                    provide: PORTAL_PLAYBACK_POSITIONS,
                    useValue: playbackPositions,
                },
            ],
        });
    });

    it('delegates category search query updates to the Stalker store', () => {
        const service = TestBed.inject(StalkerCatalogFacadeService);
        const store = TestBed.inject(StalkerStore) as unknown as {
            setSearchPhrase: jest.Mock;
        };

        service.setSearchQuery('matrix');

        expect(store.setSearchPhrase).toHaveBeenCalledWith('matrix');
    });

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
