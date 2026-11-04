import {
    credentials,
    setupElectronXtreamDataSource,
} from './electron-xtream-data-source.test-helpers';

describe('unfinished catalog cache recovery', () => {
    it.each(['importing', 'failed', 'cancelled'])(
        'does not offer partial %s rows as an offline catalog',
        async (status) => {
            const { dataSource, dbService } = setupElectronXtreamDataSource();
            dbService.getXtreamImportStatus.mockResolvedValue(status);
            dbService.hasXtreamContent.mockResolvedValue(true);
            expect(await dataSource.hasContent('p', 'live')).toBe(false);
            expect(dbService.hasXtreamContent).not.toHaveBeenCalled();
        }
    );

    it.each(['failed', 'cancelled', 'importing'])(
        'clears %s cache before importing categories again',
        async (status) => {
            const { dataSource, dbService, apiService } =
                setupElectronXtreamDataSource();
            dbService.getXtreamImportStatus.mockResolvedValue(status);
            apiService.getCategories.mockResolvedValue([
                { category_id: '1', category_name: 'Recovered' },
            ]);
            await dataSource.getCategories('p', credentials, 'vod', {
                sessionId: 'bootstrap',
            });
            expect(dbService.clearXtreamImportCache).toHaveBeenCalledWith(
                'p',
                'movie'
            );
            expect(
                dbService.clearXtreamImportCache.mock.invocationCallOrder[0]
            ).toBeLessThan(
                apiService.getCategories.mock.invocationCallOrder[0]
            );
        }
    );

    it('clears an idle cache left by interrupted deletion when cache recovery is pending', async () => {
        const { dataSource, dbService, pendingRestoreService } =
            setupElectronXtreamDataSource();
        pendingRestoreService.get.mockReturnValue({
            preservePlaybackPositions: true,
        });
        await dataSource.getCategories('p', credentials, 'vod', {
            sessionId: 'bootstrap',
        });
        expect(dbService.clearXtreamImportCache).toHaveBeenCalledWith(
            'p',
            'movie'
        );
    });

    it('blocks retry if partial rows still cannot be removed', async () => {
        const { dataSource, dbService, apiService } =
            setupElectronXtreamDataSource();
        dbService.getXtreamImportStatus.mockResolvedValue('failed');
        dbService.clearXtreamImportCache.mockResolvedValue(false);
        await expect(
            dataSource.getCategories('p', credentials, 'vod', {
                sessionId: 'bootstrap',
            })
        ).rejects.toThrow('incomplete catalog');
        expect(apiService.getCategories).not.toHaveBeenCalled();
        expect(dbService.saveXtreamCategories).not.toHaveBeenCalled();
    });

    it('retains completed caches without a cleanup roundtrip', async () => {
        const { dataSource, dbService, apiService } =
            setupElectronXtreamDataSource();
        const rows = [{ id: 1, xtream_id: 1, name: 'Healthy', type: 'movies' }];
        dbService.getXtreamImportStatus.mockResolvedValue('completed');
        dbService.getXtreamCategories.mockResolvedValue(rows);
        expect(
            await dataSource.getCategories('p', credentials, 'vod', {
                sessionId: 'bootstrap',
            })
        ).toEqual(rows);
        expect(dbService.clearXtreamImportCache).not.toHaveBeenCalled();
        expect(apiService.getCategories).not.toHaveBeenCalled();
    });
});
