import { setupElectronXtreamDataSource } from './electron-xtream-data-source.test-helpers';

it('reads complete history for projection without changing ordinary browsing reads', async () => {
    const { dataSource, dbService } = setupElectronXtreamDataSource();
    const rows = Array.from({ length: 105 }, (_, index) => ({
        id: index + 1,
        xtream_id: index + 1,
        type: 'movie',
        title: 'Synthetic archived item',
        category_id: index % 2 ? 7 : 8,
    }));
    dbService.getRecentItemsOrThrow.mockResolvedValue(rows);
    expect(
        await dataSource.getRecentItems('source', { all: true })
    ).toHaveLength(105);
    expect(dbService.getRecentItemsOrThrow).toHaveBeenCalledWith('source');
    dbService.getRecentItems.mockResolvedValue(rows.slice(0, 100));
    expect(await dataSource.getRecentItems('source')).toHaveLength(100);
});
