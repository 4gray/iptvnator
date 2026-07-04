import { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import {
    ElectronXtreamDataSourceHarness,
    setupElectronXtreamDataSource,
} from './electron-xtream-data-source.test-helpers';

/**
 * Delegation tests for ElectronXtreamDataSource: methods that forward to
 * DatabaseService / PlaybackPositionService over the IPC boundary.
 * The DB-first fetch/cache strategy is covered in
 * electron-xtream-data-source.spec.ts.
 */
describe('ElectronXtreamDataSource (delegation)', () => {
    let harness: ElectronXtreamDataSourceHarness;

    const playlistId = 'playlist-1';

    beforeEach(() => {
        harness = setupElectronXtreamDataSource();
    });

    describe('playlist operations', () => {
        it('reads playlists from the DB by id', async () => {
            const playlist = { _id: playlistId, title: 'My Portal' };
            harness.dbService.getPlaylistById.mockResolvedValue(playlist);

            await expect(
                harness.dataSource.getPlaylist(playlistId)
            ).resolves.toEqual(playlist);
            expect(harness.dbService.getPlaylistById).toHaveBeenCalledWith(
                playlistId
            );
        });

        it('maps playlist fields to DB shape on create', async () => {
            await harness.dataSource.createPlaylist({
                id: playlistId,
                name: 'My Portal',
                serverUrl: 'http://portal.example',
                username: 'demo',
                password: 'secret',
                type: 'xtream',
            });

            expect(harness.dbService.createPlaylist).toHaveBeenCalledWith({
                _id: playlistId,
                title: 'My Portal',
                serverUrl: 'http://portal.example',
                username: 'demo',
                password: 'secret',
            });
        });

        it('maps update fields to the Xtream playlist details payload', async () => {
            await harness.dataSource.updatePlaylist(playlistId, {
                name: 'Renamed Portal',
                username: 'new-user',
                password: 'new-pass',
                serverUrl: 'http://new.example',
            });

            expect(
                harness.dbService.updateXtreamPlaylistDetails
            ).toHaveBeenCalledWith({
                id: playlistId,
                title: 'Renamed Portal',
                username: 'new-user',
                password: 'new-pass',
                serverUrl: 'http://new.example',
            });
        });

        it('deletes playlists via the DB and propagates failures', async () => {
            await harness.dataSource.deletePlaylist(playlistId);
            expect(harness.dbService.deletePlaylist).toHaveBeenCalledWith(
                playlistId
            );

            harness.dbService.deletePlaylist.mockRejectedValue(
                new Error('delete failed')
            );
            await expect(
                harness.dataSource.deletePlaylist(playlistId)
            ).rejects.toThrow('delete failed');
        });
    });

    describe('category and content pass-throughs', () => {
        it('delegates category reads and writes to the DB', async () => {
            harness.dbService.hasXtreamCategories.mockResolvedValue(true);
            const categories = [{ id: 1, name: 'News' }];
            harness.dbService.getAllXtreamCategories.mockResolvedValue(
                categories
            );
            harness.dbService.getXtreamCategories.mockResolvedValue(categories);

            await expect(
                harness.dataSource.hasCategories(playlistId, 'live')
            ).resolves.toBe(true);
            await expect(
                harness.dataSource.getAllCategories(playlistId, 'series')
            ).resolves.toEqual(categories);
            // getCachedCategories maps API type 'vod' to DB type 'movies'
            await expect(
                harness.dataSource.getCachedCategories(playlistId, 'vod')
            ).resolves.toEqual(categories);
            expect(harness.dbService.getXtreamCategories).toHaveBeenCalledWith(
                playlistId,
                'movies'
            );

            await harness.dataSource.saveCategories(
                playlistId,
                categories as never,
                'live'
            );
            expect(harness.dbService.saveXtreamCategories).toHaveBeenCalledWith(
                playlistId,
                categories,
                'live'
            );

            await harness.dataSource.updateCategoryVisibility([1, 2], true);
            expect(
                harness.dbService.updateCategoryVisibility
            ).toHaveBeenCalledWith([1, 2], true);
        });

        it('delegates content reads, writes, and search to the DB', async () => {
            const items = [{ id: 1, title: 'Movie One', xtream_id: 202 }];
            harness.dbService.hasXtreamContent.mockResolvedValue(true);
            harness.dbService.getXtreamContent.mockResolvedValue(items);
            harness.dbService.saveXtreamContent.mockResolvedValue(1);
            harness.dbService.searchXtreamContent.mockResolvedValue(items);
            const onProgress = jest.fn();
            const options = { operationId: 'op-1' };

            await expect(
                harness.dataSource.hasContent(playlistId, 'movie')
            ).resolves.toBe(true);
            await expect(
                harness.dataSource.getCachedContent(playlistId, 'movie')
            ).resolves.toEqual(items);
            await expect(
                harness.dataSource.saveContent(
                    playlistId,
                    items as never,
                    'movie',
                    onProgress,
                    options
                )
            ).resolves.toBe(1);
            expect(harness.dbService.saveXtreamContent).toHaveBeenCalledWith(
                playlistId,
                items,
                'movie',
                onProgress,
                options
            );

            await expect(
                harness.dataSource.searchContent(
                    playlistId,
                    'movie one',
                    ['movie', 'series'],
                    true
                )
            ).resolves.toEqual(items);
            expect(harness.dbService.searchXtreamContent).toHaveBeenCalledWith(
                playlistId,
                'movie one',
                ['movie', 'series'],
                true
            );
        });
    });

    describe('favorites and recently viewed', () => {
        it('delegates favorites operations to the DB', async () => {
            harness.dbService.isFavorite.mockResolvedValue(true);

            await harness.dataSource.addFavorite(
                202,
                playlistId,
                'https://example.com/backdrop.png'
            );
            expect(harness.dbService.addToFavorites).toHaveBeenCalledWith(
                202,
                playlistId,
                'https://example.com/backdrop.png'
            );

            await harness.dataSource.removeFavorite(202, playlistId);
            expect(harness.dbService.removeFromFavorites).toHaveBeenCalledWith(
                202,
                playlistId
            );

            await expect(
                harness.dataSource.isFavorite(202, playlistId)
            ).resolves.toBe(true);
            await harness.dataSource.getFavorites(playlistId);
            expect(harness.dbService.getFavorites).toHaveBeenCalledWith(
                playlistId
            );
        });

        it('delegates recently viewed operations to the DB', async () => {
            await harness.dataSource.addRecentItem(202, playlistId);
            expect(harness.dbService.addRecentItem).toHaveBeenCalledWith(
                202,
                playlistId,
                undefined
            );

            await harness.dataSource.removeRecentItem(202, playlistId);
            expect(harness.dbService.removeRecentItem).toHaveBeenCalledWith(
                202,
                playlistId
            );

            await harness.dataSource.getRecentItems(playlistId);
            expect(harness.dbService.getRecentItems).toHaveBeenCalledWith(
                playlistId
            );

            await harness.dataSource.clearRecentItems(playlistId);
            expect(
                harness.dbService.clearPlaylistRecentItems
            ).toHaveBeenCalledWith(playlistId);
        });

        it('delegates content lookup and backdrop backfill to the DB', async () => {
            const item = { id: 1, title: 'Movie One', xtream_id: 202 };
            harness.dbService.getContentByXtreamId.mockResolvedValue(item);

            await expect(
                harness.dataSource.getContentByXtreamId(
                    202,
                    playlistId,
                    'movie'
                )
            ).resolves.toEqual(item);
            expect(harness.dbService.getContentByXtreamId).toHaveBeenCalledWith(
                202,
                playlistId,
                'movie'
            );

            await harness.dataSource.setContentBackdropIfMissing(
                1,
                playlistId,
                'https://example.com/backdrop.png'
            );
            // playlistId is intentionally not forwarded for the Electron DB call
            expect(
                harness.dbService.setContentBackdropIfMissing
            ).toHaveBeenCalledWith(1, 'https://example.com/backdrop.png');
        });
    });

    describe('playback positions', () => {
        const position = {
            contentXtreamId: 202,
            contentType: 'vod',
            position: 120,
            duration: 3600,
        } as unknown as PlaybackPositionData;

        it('delegates playback position operations to the playback service', async () => {
            harness.playbackService.getPlaybackPosition.mockResolvedValue(
                position
            );
            harness.playbackService.getSeriesPlaybackPositions.mockResolvedValue(
                [position]
            );
            harness.playbackService.getRecentPlaybackPositions.mockResolvedValue(
                [position]
            );
            harness.playbackService.getAllPlaybackPositions.mockResolvedValue([
                position,
            ]);

            await harness.dataSource.savePlaybackPosition(playlistId, position);
            expect(
                harness.playbackService.savePlaybackPosition
            ).toHaveBeenCalledWith(playlistId, position);

            await expect(
                harness.dataSource.getPlaybackPosition(playlistId, 202, 'vod')
            ).resolves.toEqual(position);
            await expect(
                harness.dataSource.getSeriesPlaybackPositions(playlistId, 303)
            ).resolves.toEqual([position]);
            expect(
                harness.playbackService.getSeriesPlaybackPositions
            ).toHaveBeenCalledWith(playlistId, 303);

            await expect(
                harness.dataSource.getRecentPlaybackPositions(playlistId, 5)
            ).resolves.toEqual([position]);
            expect(
                harness.playbackService.getRecentPlaybackPositions
            ).toHaveBeenCalledWith(playlistId, 5);

            await expect(
                harness.dataSource.getAllPlaybackPositions(playlistId)
            ).resolves.toEqual([position]);

            await harness.dataSource.clearPlaybackPosition(
                playlistId,
                202,
                'vod'
            );
            expect(
                harness.playbackService.clearPlaybackPosition
            ).toHaveBeenCalledWith(playlistId, 202, 'vod');
        });
    });

    describe('cleanup operations', () => {
        it('clearSessionCache is a no-op that touches no services', () => {
            expect(
                harness.dataSource.clearSessionCache(playlistId)
            ).toBeUndefined();
            expect(
                harness.dbService.deleteXtreamPlaylistContent
            ).not.toHaveBeenCalled();
        });

        it('combines DB restore data with playback positions on clearPlaylistContent', async () => {
            const hidden = [{ categoryType: 'live', xtreamId: 5 }];
            const favorites = [{ xtreamId: 202, type: 'movie' }];
            const recentlyViewed = [{ xtreamId: 101, type: 'live' }];
            const position = { contentXtreamId: 202 } as never;
            harness.dbService.deleteXtreamPlaylistContent.mockResolvedValue({
                hiddenCategories: hidden,
                favorites,
                recentlyViewed,
            });
            harness.playbackService.getAllPlaybackPositions.mockResolvedValue([
                position,
            ]);

            await expect(
                harness.dataSource.clearPlaylistContent(playlistId)
            ).resolves.toEqual({
                hiddenCategories: hidden,
                favorites,
                recentlyViewed,
                playbackPositions: [position],
            });
        });

        it('restores user data, then resets and replays playback positions', async () => {
            const positionA = { contentXtreamId: 1 } as never;
            const positionB = { contentXtreamId: 2 } as never;
            const restoreState = {
                hiddenCategories: [],
                favorites: [{ xtreamId: 202, type: 'movie' }],
                recentlyViewed: [{ xtreamId: 101, type: 'live' }],
                playbackPositions: [positionA, positionB],
            } as never;
            const options = { operationId: 'op-1' };

            await harness.dataSource.restoreUserData(
                playlistId,
                restoreState,
                options
            );

            expect(
                harness.dbService.restoreXtreamUserData
            ).toHaveBeenCalledWith(
                playlistId,
                [{ xtreamId: 202, type: 'movie' }],
                [{ xtreamId: 101, type: 'live' }],
                options
            );
            expect(
                harness.playbackService.clearAllPlaybackPositions
            ).toHaveBeenCalledWith(playlistId);
            expect(
                harness.playbackService.savePlaybackPosition.mock.calls
            ).toEqual([
                [playlistId, positionA],
                [playlistId, positionB],
            ]);
        });
    });
});
