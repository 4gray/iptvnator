import {
    clearExplicitCatalogVisibility,
    readExplicitCatalogVisibility,
    reconcileExplicitCatalogVisibilityForExport,
} from './xtream-explicit-category-visibility';
import {
    captureCatalogCacheRecoveryState,
    readCatalogRecoveryVisibility,
} from './xtream-catalog-history-recovery';
import { XtreamDeferredCatalogRestoreService } from './xtream-deferred-catalog-restore.service';

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

it('reconciles combined export flags by typed identity without changing history or the original state', () => {
    const state = {
        hiddenCategories: [
            { categoryType: 'movies' as const, xtreamId: 2 },
            { categoryType: 'movies' as const, xtreamId: 9 },
            { categoryType: 'live' as const, xtreamId: 2 },
        ],
        recentlyViewed: [
            {
                contentType: 'movie' as const,
                xtreamId: 2,
                viewedAt: 'synthetic',
            },
        ],
    };
    const exported = reconcileExplicitCatalogVisibilityForExport(state, [
        { categoryType: 'movies', xtreamId: 2, hidden: false },
        { categoryType: 'movies', xtreamId: 4, hidden: true },
        { categoryType: 'series', xtreamId: 2, hidden: true },
    ]);
    expect(exported.hiddenCategories).toEqual([
        { categoryType: 'movies', xtreamId: 9 },
        { categoryType: 'live', xtreamId: 2 },
        { categoryType: 'movies', xtreamId: 4 },
        { categoryType: 'series', xtreamId: 2 },
    ]);
    expect(exported.recentlyViewed).toBe(state.recentlyViewed);
    expect(state.hiddenCategories).toHaveLength(3);
});

it('reads explicit visibility strictly and keeps rejected reset failures visible', async () => {
    const db = {
        readAppState: jest
            .fn<Promise<{ value: string | null } | null>, [string]>()
            .mockResolvedValue({ value: null }),
        setAppState: jest.fn().mockResolvedValue(false),
    };
    await expect(readExplicitCatalogVisibility(db, 'p')).resolves.toEqual([]);
    expect(db.readAppState).toHaveBeenCalledWith(
        'xtream-category-visibility:p'
    );
    db.readAppState.mockResolvedValue(null);
    await expect(readExplicitCatalogVisibility(db, 'p')).rejects.toThrow(
        'Could not read'
    );
    db.readAppState.mockResolvedValue({ value: '{bad' });
    await expect(readExplicitCatalogVisibility(db, 'p')).rejects.toThrow();
    await expect(clearExplicitCatalogVisibility(db, 'p')).rejects.toThrow(
        'Could not reset'
    );
});

it('lets explicit partial-category choices win without trusting other partial defaults or dropping absent choices', async () => {
    const db = {
        getXtreamImportStatus: jest.fn().mockResolvedValue('idle'),
        getAllXtreamCategories: jest.fn(async (_id: string, type: string) =>
            type === 'movies'
                ? [
                      {
                          id: 22,
                          name: 'Synthetic retained category',
                          playlist_id: 'p',
                          type: 'movies' as const,
                          xtream_id: 2,
                          hidden: false,
                          locked: false,
                      },
                      {
                          id: 23,
                          name: 'Synthetic partial category',
                          playlist_id: 'p',
                          type: 'movies' as const,
                          xtream_id: 3,
                          hidden: false,
                          locked: false,
                      },
                  ]
                : []
        ),
        readAppState: jest.fn(async () => ({
            value: JSON.stringify({
                version: 1,
                categories: [
                    { categoryType: 'movies', xtreamId: 2, hidden: false },
                    { categoryType: 'movies', xtreamId: 4, hidden: true },
                ],
            }),
        })),
    };
    const archived = [2, 3, 9].map((xtreamId) => ({
        categoryType: 'movies' as const,
        xtreamId,
    }));
    const visibility = await readCatalogRecoveryVisibility(db, 'p', archived);
    expect(visibility.hiddenCategories).toEqual([
        { categoryType: 'movies', xtreamId: 3 },
        { categoryType: 'movies', xtreamId: 9 },
        { categoryType: 'movies', xtreamId: 4 },
    ]);
    expect(visibility.currentCategories).toEqual([
        { categoryType: 'movies', xtreamId: 2, hidden: false },
        { categoryType: 'movies', xtreamId: 4, hidden: true },
    ]);
    const deferred = new XtreamDeferredCatalogRestoreService();
    deferred.prepare(
        'p',
        {
            favorites: [],
            playbackPositions: [],
            recentlyViewed: [],
            hiddenCategories: archived,
        },
        []
    );
    const captured = await captureCatalogCacheRecoveryState(db, deferred, 'p', [
        'movie',
    ]);
    expect(captured.state.hiddenCategories).toEqual([
        { categoryType: 'movies', xtreamId: 3 },
        { categoryType: 'movies', xtreamId: 9 },
        { categoryType: 'movies', xtreamId: 4 },
    ]);
});
