import { DatabaseService } from './database-electron.service';
import { XtreamDeferredCatalogRestoreService } from './xtream-deferred-catalog-restore.service';
import { XtreamPendingRestoreState } from '@iptvnator/shared/interfaces';

const state = (): XtreamPendingRestoreState => ({
    favorites: [],
    playbackPositions: [],
    hiddenCategories: [{ categoryType: 'movies', xtreamId: 1 }],
    recentlyViewed: [
        { contentType: 'movie', xtreamId: 20, viewedAt: '2026-01-01' },
    ],
});
const originalElectron = window.electron;
beforeEach(() => localStorage.clear());
afterEach(() => {
    jest.restoreAllMocks();
    localStorage.clear();
    window.electron = originalElectron;
});

it.each(['playlist', 'global'])(
    'clears dormant history through the %s SQLite history action',
    async (scope) => {
        const deferred = new XtreamDeferredCatalogRestoreService();
        deferred.prepare('p', state(), []);
        deferred.prepare('q', state(), []);
        const bridge = {
            dbClearRecentlyViewed: jest
                .fn()
                .mockResolvedValue({ success: true }),
            dbClearPlaylistRecentItems: jest
                .fn()
                .mockResolvedValue({ success: true }),
        };
        Object.defineProperty(window, 'electron', {
            configurable: true,
            writable: true,
            value: bridge,
        });
        const db = new DatabaseService();
        if (scope === 'playlist') await db.clearPlaylistRecentItems('p');
        else await db.clearGlobalRecentlyViewed();
        expect(deferred.forExport('p', state()).hiddenCategories).toEqual(
            state().hiddenCategories
        );
        expect(
            deferred.forExport('p', { ...state(), recentlyViewed: [] })
                .recentlyViewed
        ).toEqual([]);
        expect(
            deferred.forExport('q', { ...state(), recentlyViewed: [] })
                .recentlyViewed
        ).toHaveLength(scope === 'playlist' ? 1 : 0);
        expect(
            scope === 'playlist'
                ? bridge.dbClearPlaylistRecentItems
                : bridge.dbClearRecentlyViewed
        ).toHaveBeenCalled();
    }
);

it('does not clear SQLite history if dormant history cannot be cleared safely', async () => {
    new XtreamDeferredCatalogRestoreService().prepare('p', state(), []);
    const bridge = {
        dbClearPlaylistRecentItems: jest
            .fn()
            .mockResolvedValue({ success: true }),
    };
    Object.defineProperty(window, 'electron', {
        configurable: true,
        writable: true,
        value: bridge,
    });
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('storage unavailable');
    });
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await new DatabaseService().clearPlaylistRecentItems('p')).toBe(
        false
    );
    expect(bridge.dbClearPlaylistRecentItems).not.toHaveBeenCalled();
});
