import { DashboardDataService } from './dashboard-data.service';
import type { PortalRecentItem } from '@iptvnator/shared/interfaces';

it('removes shared native Dashboard history through its typed data source', async () => {
    const removeRecentItem = jest.fn().mockResolvedValue(undefined);
    const nativeRemove = jest.fn();
    const service = Object.assign(
        Object.create(DashboardDataService.prototype),
        {
            history: { active: () => true },
            runtime: { supportsPortalActivityStorage: true },
            xtreamDataSource: { removeRecentItem },
            dbService: { removeRecentItem: nativeRemove },
            reloadGlobalRecentItems: jest.fn().mockResolvedValue(undefined),
        }
    ) as DashboardDataService;
    const item = {
        id: 91,
        xtream_id: 7001,
        type: 'movie',
        source: 'xtream',
        playlist_id: 'synthetic-source',
    } as PortalRecentItem;
    await service.removeGlobalRecentItem(item);
    expect(removeRecentItem).toHaveBeenCalledWith(
        { id: 91, type: 'movie', providerId: 7001 },
        'synthetic-source'
    );
    expect(nativeRemove).not.toHaveBeenCalled();
});

it('retains catalog identity in native history projected for Dashboard', () => {
    const service = Object.create(DashboardDataService.prototype) as {
        mapPwaXtreamRecentItem: (item: unknown, playlist: unknown) => unknown;
    };
    const projected = service.mapPwaXtreamRecentItem(
        {
            id: 1,
            xtream_id: 42,
            type: 'movie',
            title: 'Synthetic title',
            tmdb_id: 100,
            release_year: 2024,
            original_title: '  Synthetic original  ',
        },
        { _id: 'source', title: 'Synthetic source' }
    );
    expect(projected).toEqual(
        expect.objectContaining({
            tmdb_id: 100,
            release_year: 2024,
            original_title: 'Synthetic original',
        })
    );
});
