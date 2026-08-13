import { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import {
    ElectronXtreamDataSourceHarness,
    setupElectronXtreamDataSource,
} from './electron-xtream-data-source.test-helpers';

/**
 * Delegation tests for ElectronXtreamDataSource user data: favorites,
 * recently viewed, playback positions, and cleanup/restore flows.
 * Playlist/category/content delegation is covered in
 * electron-xtream-data-source.delegation.spec.ts and the DB-first
 * fetch/cache strategy in electron-xtream-data-source.spec.ts.
 */
describe('ElectronXtreamDataSource (user data delegation)', () => {
    let harness: ElectronXtreamDataSourceHarness;

    const playlistId = 'playlist-1';

    beforeEach(() => {
        harness = setupElectronXtreamDataSource();
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

            const patch = { backdropUrl: 'https://example.com/backdrop.png' };
            await harness.dataSource.setContentMetadataIfMissing(
                1,
                playlistId,
                patch
            );
            // playlistId is intentionally not forwarded for the Electron DB call
            expect(
                harness.dbService.setContentMetadataIfMissing
            ).toHaveBeenCalledWith(1, patch);
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
                sourcePins: [],
            });
        });

        it('atomically applies all parked source pins and rejects a failed replacement', async () => {
            // The fresh-import path: a new playlist has no content when the
            // archive is read, so its user state is parked and replayed here.
            // Without this the backup's pins are dropped for every new import.
            const restoreState = {
                hiddenCategories: [],
                favorites: [],
                recentlyViewed: [],
                playbackPositions: [],
                sourcePins: [
                    {
                        matchKey: 'tmdb:603',
                        contentId: 501,
                        updatedAt: '2026-07-06T09:00:00.000Z',
                    },
                    {
                        matchKey: 'title:the-matrix:1999',
                        contentId: 502,
                    },
                ],
            } as never;

            await harness.dataSource.restoreUserData(playlistId, restoreState);

            expect(
                harness.vodSourcePinService.replaceForPlaylist
            ).toHaveBeenCalledTimes(1);
            expect(
                harness.vodSourcePinService.replaceForPlaylist
            ).toHaveBeenCalledWith(playlistId, [
                {
                    matchKey: 'tmdb:603',
                    playlistId,
                    contentId: 501,
                    portalType: 'xtream',
                    updatedAt: '2026-07-06T09:00:00.000Z',
                },
                {
                    matchKey: 'title:the-matrix:1999',
                    playlistId,
                    contentId: 502,
                    portalType: 'xtream',
                },
            ]);
            expect(harness.vodSourcePinService.set).not.toHaveBeenCalled();

            // The caller clears the parked state only when this resolves, so
            // resolving here would drop the retry on a transient DB failure.
            harness.vodSourcePinService.replaceForPlaylist.mockResolvedValue(
                false
            );
            await expect(
                harness.dataSource.restoreUserData(playlistId, restoreState)
            ).rejects.toThrow(playlistId);
        });

        it('restores user data, then resets and replays playback positions', async () => {
            const positionA = { contentXtreamId: 1 } as never;
            const positionB = { contentXtreamId: 2 } as never;
            const restoreState = {
                hiddenCategories: [{ categoryType: 'live', xtreamId: 101 }],
                favorites: [{ xtreamId: 202, type: 'movie' }],
                recentlyViewed: [{ xtreamId: 101, type: 'live' }],
                playbackPositions: [positionA, positionB],
            } as never;
            const options = { operationId: 'op-1' };
            harness.dbService.getAllXtreamCategories.mockImplementation(
                (_playlistId: string, type: string) =>
                    Promise.resolve(
                        type === 'live'
                            ? [
                                  {
                                      id: 11,
                                      type: 'live',
                                      xtream_id: 101,
                                  },
                                  {
                                      id: 12,
                                      type: 'live',
                                      xtream_id: 102,
                                  },
                              ]
                            : []
                    )
            );

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
                harness.dbService.updateCategoryVisibility.mock.calls
            ).toEqual([
                [[11, 12], false],
                [[11], true],
            ]);
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
