import {
    ElectronXtreamDataSourceHarness,
    setupElectronXtreamDataSource,
} from './electron-xtream-data-source.test-helpers';

/**
 * Delegation tests for ElectronXtreamDataSource: playlist, category, and
 * content methods that forward to the DatabaseService over the IPC boundary.
 * User-data delegation (favorites, recently viewed, playback positions,
 * cleanup) is covered in electron-xtream-data-source.user-data.spec.ts and
 * the DB-first fetch/cache strategy in electron-xtream-data-source.spec.ts.
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
});
