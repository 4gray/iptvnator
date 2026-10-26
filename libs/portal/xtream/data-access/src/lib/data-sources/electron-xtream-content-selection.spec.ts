import { XTREAM_CONTENT_TYPES } from '@iptvnator/shared/interfaces';
import {
    credentials,
    setupElectronXtreamDataSource,
} from './electron-xtream-data-source.test-helpers';

describe('Electron Xtream catalog selection', () => {
    it.each(Array.from({ length: 8 }, (_, mask) => mask))(
        'requests only enabled catalogs for selection mask %i',
        async (mask) => {
            const { dataSource, dbService, apiService } =
                setupElectronXtreamDataSource();
            const selected = XTREAM_CONTENT_TYPES.filter(
                (_, index) => mask & (1 << index)
            );
            dbService.getPlaylistById.mockResolvedValue({
                id: 'p',
                xtreamContentTypes: selected,
            });
            dbService.getXtreamImportStatus.mockResolvedValue('idle');
            dbService.getXtreamCategories.mockResolvedValue([]);
            dbService.getXtreamContent.mockResolvedValue([]);
            apiService.getCategories.mockResolvedValue([]);
            apiService.getStreams.mockResolvedValue([]);
            for (const type of XTREAM_CONTENT_TYPES) {
                const categoryType = type === 'movie' ? 'vod' : type;
                await dataSource.getCategories('p', credentials, categoryType);
                await dataSource.getContent('p', credentials, type);
                await dataSource.getCachedCategories('p', categoryType);
                await dataSource.getCachedContent('p', type);
            }
            expect(
                apiService.getCategories.mock.calls.map((call) => call[1])
            ).toEqual(
                selected.map((type) => (type === 'movie' ? 'vod' : type))
            );
            expect(
                apiService.getStreams.mock.calls.map((call) => call[1])
            ).toEqual(selected);
        }
    );

    it('filters disabled search types but leaves collection/identity lookups available', async () => {
        const { dataSource, dbService } = setupElectronXtreamDataSource();
        dbService.getPlaylistById.mockResolvedValue({
            id: 'p',
            xtreamContentTypes: [],
        });
        expect(await dataSource.searchContent('p', 'movie', ['movie'])).toEqual(
            []
        );
        expect(dbService.searchXtreamContent).not.toHaveBeenCalled();
        await dataSource.getFavorites('p');
        await dataSource.getRecentItems('p');
        await dataSource.getContentByXtreamId(42, 'p', 'movie');
        expect(dbService.getFavorites).toHaveBeenCalledWith('p');
        expect(dbService.getRecentItems).toHaveBeenCalledWith('p');
        expect(dbService.getContentByXtreamId).toHaveBeenCalledWith(
            42,
            'p',
            'movie'
        );
    });
});
