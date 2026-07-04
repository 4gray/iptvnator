import {
    credentials,
    ElectronXtreamDataSourceHarness,
    setupElectronXtreamDataSource,
} from './electron-xtream-data-source.test-helpers';

/**
 * DB-first strategy tests for ElectronXtreamDataSource:
 * DB hit (no API call), DB miss (API fetch + cache), request deduplication,
 * and error propagation. Delegation-only methods are covered in
 * electron-xtream-data-source.delegation.spec.ts.
 */
describe('ElectronXtreamDataSource (DB-first strategy)', () => {
    let harness: ElectronXtreamDataSourceHarness;

    const playlistId = 'playlist-1';
    const dbCategory = {
        id: 1,
        name: 'News',
        playlist_id: playlistId,
        type: 'live' as const,
        xtream_id: 10,
        hidden: false,
    };
    const dbContentItem = {
        id: 1,
        title: 'News Live',
        xtream_id: 101,
        type: 'live',
    };

    beforeEach(() => {
        harness = setupElectronXtreamDataSource();
    });

    describe('getCategories', () => {
        it('returns cached categories without calling the API when import is completed', async () => {
            harness.dbService.getXtreamImportStatus.mockResolvedValue(
                'completed'
            );
            harness.dbService.getXtreamCategories.mockResolvedValue([
                dbCategory,
            ]);

            const result = await harness.dataSource.getCategories(
                playlistId,
                credentials,
                'live'
            );

            expect(result).toEqual([dbCategory]);
            expect(harness.apiService.getCategories).not.toHaveBeenCalled();
            expect(harness.dbService.getXtreamCategories).toHaveBeenCalledWith(
                playlistId,
                'live'
            );
        });

        it('fetches from the API and caches to DB when the cache is cold', async () => {
            const remoteCategories = [
                { category_id: '10', category_name: 'News' },
            ];
            harness.dbService.getXtreamCategories
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([dbCategory]);
            harness.apiService.getCategories.mockResolvedValue(
                remoteCategories
            );
            const onPhaseChange = jest.fn();

            const result = await harness.dataSource.getCategories(
                playlistId,
                credentials,
                'vod',
                { sessionId: 'session-1', onPhaseChange }
            );

            expect(harness.apiService.getCategories).toHaveBeenCalledWith(
                credentials,
                'vod',
                { sessionId: 'session-1' }
            );
            expect(harness.dbService.saveXtreamCategories).toHaveBeenCalledWith(
                playlistId,
                remoteCategories,
                'movies',
                undefined
            );
            expect(result).toEqual([dbCategory]);
            expect(onPhaseChange.mock.calls).toEqual([
                ['loading-categories'],
                ['saving-categories'],
            ]);
        });

        it('refetches from the API when cached rows exist but the import never completed', async () => {
            harness.dbService.getXtreamImportStatus.mockResolvedValue(
                'importing'
            );
            harness.dbService.getXtreamCategories.mockResolvedValue([
                dbCategory,
            ]);
            harness.apiService.getCategories.mockResolvedValue([]);

            await harness.dataSource.getCategories(
                playlistId,
                credentials,
                'live'
            );

            expect(harness.apiService.getCategories).toHaveBeenCalledTimes(1);
        });

        it('skips caching when the API returns no categories', async () => {
            harness.apiService.getCategories.mockResolvedValue([]);

            const result = await harness.dataSource.getCategories(
                playlistId,
                credentials,
                'live'
            );

            expect(
                harness.dbService.saveXtreamCategories
            ).not.toHaveBeenCalled();
            expect(result).toEqual([]);
        });

        it('restores hidden category visibility from the pending restore state', async () => {
            harness.pendingRestoreService.get.mockReturnValue({
                hiddenCategories: [
                    { categoryType: 'live', xtreamId: 5 },
                    { categoryType: 'movies', xtreamId: 7 },
                ],
                favorites: [],
                recentlyViewed: [],
                playbackPositions: [],
            });
            harness.apiService.getCategories.mockResolvedValue([
                { category_id: '5', category_name: 'Hidden' },
            ]);

            await harness.dataSource.getCategories(
                playlistId,
                credentials,
                'live'
            );

            expect(harness.pendingRestoreService.get).toHaveBeenCalledWith(
                playlistId
            );
            expect(harness.dbService.saveXtreamCategories).toHaveBeenCalledWith(
                playlistId,
                expect.any(Array),
                'live',
                [5]
            );
        });

        it('deduplicates concurrent requests for the same playlist and type', async () => {
            harness.apiService.getCategories.mockResolvedValue([
                { category_id: '10', category_name: 'News' },
            ]);

            const [first, second] = await Promise.all([
                harness.dataSource.getCategories(
                    playlistId,
                    credentials,
                    'live'
                ),
                harness.dataSource.getCategories(
                    playlistId,
                    credentials,
                    'live'
                ),
            ]);

            expect(first).toBe(second);
            expect(harness.apiService.getCategories).toHaveBeenCalledTimes(1);
        });

        it('propagates API errors and allows a retry to reach the API again', async () => {
            const failure = new Error('portal unreachable');
            harness.apiService.getCategories
                .mockRejectedValueOnce(failure)
                .mockResolvedValueOnce([]);

            await expect(
                harness.dataSource.getCategories(playlistId, credentials, 'live')
            ).rejects.toThrow('portal unreachable');

            await harness.dataSource.getCategories(
                playlistId,
                credentials,
                'live'
            );
            expect(harness.apiService.getCategories).toHaveBeenCalledTimes(2);
        });
    });

    describe('getContent', () => {
        it('returns cached content without calling the API when import is completed', async () => {
            harness.dbService.getXtreamImportStatus.mockResolvedValue(
                'completed'
            );
            harness.dbService.getXtreamContent.mockResolvedValue([
                dbContentItem,
            ]);

            const result = await harness.dataSource.getContent(
                playlistId,
                credentials,
                'live'
            );

            expect(result).toEqual([dbContentItem]);
            expect(harness.apiService.getStreams).not.toHaveBeenCalled();
        });

        it('fetches from the API, reports progress, and caches on a cold cache', async () => {
            const remoteStreams = [
                { stream_id: 101, name: 'News Live' },
                { stream_id: 102, name: 'Sports Live' },
            ];
            harness.dbService.getXtreamContent
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([dbContentItem]);
            harness.apiService.getStreams.mockResolvedValue(remoteStreams);
            const onProgress = jest.fn();
            const onTotal = jest.fn();
            const options = { sessionId: 'session-1' };

            const result = await harness.dataSource.getContent(
                playlistId,
                credentials,
                'live',
                onProgress,
                onTotal,
                options
            );

            expect(harness.apiService.getStreams).toHaveBeenCalledWith(
                credentials,
                'live',
                { sessionId: 'session-1' }
            );
            expect(onTotal).toHaveBeenCalledWith(2);
            expect(harness.dbService.saveXtreamContent).toHaveBeenCalledWith(
                playlistId,
                remoteStreams,
                'live',
                onProgress,
                options
            );
            expect(result).toEqual([dbContentItem]);
        });

        it.each([
            ['live', 'loading-live'],
            ['movie', 'loading-movies'],
            ['series', 'loading-series'],
        ] as const)(
            'reports the %s loading phase on a cold cache',
            async (type, phase) => {
                const onPhaseChange = jest.fn();

                await harness.dataSource.getContent(
                    playlistId,
                    credentials,
                    type,
                    undefined,
                    undefined,
                    { onPhaseChange }
                );

                expect(onPhaseChange).toHaveBeenCalledWith(phase);
            }
        );

        it('skips caching and progress reporting when the API returns nothing', async () => {
            harness.apiService.getStreams.mockResolvedValue([]);
            const onTotal = jest.fn();

            const result = await harness.dataSource.getContent(
                playlistId,
                credentials,
                'movie',
                undefined,
                onTotal
            );

            expect(harness.dbService.saveXtreamContent).not.toHaveBeenCalled();
            expect(onTotal).not.toHaveBeenCalled();
            expect(result).toEqual([]);
        });

        it('deduplicates concurrent requests per type but not across types', async () => {
            harness.apiService.getStreams.mockResolvedValue([
                { stream_id: 101, name: 'News Live' },
            ]);

            await Promise.all([
                harness.dataSource.getContent(playlistId, credentials, 'live'),
                harness.dataSource.getContent(playlistId, credentials, 'live'),
                harness.dataSource.getContent(playlistId, credentials, 'movie'),
            ]);

            expect(harness.apiService.getStreams).toHaveBeenCalledTimes(2);
            expect(harness.apiService.getStreams).toHaveBeenCalledWith(
                credentials,
                'live',
                { sessionId: undefined }
            );
            expect(harness.apiService.getStreams).toHaveBeenCalledWith(
                credentials,
                'movie',
                { sessionId: undefined }
            );
        });

        it('propagates API errors and clears the in-flight request for retries', async () => {
            const failure = new Error('stream fetch failed');
            harness.apiService.getStreams
                .mockRejectedValueOnce(failure)
                .mockResolvedValueOnce([]);

            await expect(
                harness.dataSource.getContent(playlistId, credentials, 'series')
            ).rejects.toThrow('stream fetch failed');

            await harness.dataSource.getContent(
                playlistId,
                credentials,
                'series'
            );
            expect(harness.apiService.getStreams).toHaveBeenCalledTimes(2);
        });

        it('propagates DB errors from the import status check', async () => {
            harness.dbService.getXtreamImportStatus.mockRejectedValue(
                new Error('db locked')
            );

            await expect(
                harness.dataSource.getContent(playlistId, credentials, 'live')
            ).rejects.toThrow('db locked');
            expect(harness.apiService.getStreams).not.toHaveBeenCalled();
        });
    });
});
