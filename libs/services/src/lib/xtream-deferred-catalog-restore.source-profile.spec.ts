import { prepareSourceConnection } from './source-sync/source-connection';
import { XtreamDeferredCatalogRestoreService } from './xtream-deferred-catalog-restore.service';
import type { XtreamPendingRestoreState } from '@iptvnator/shared/interfaces';

const empty = (): XtreamPendingRestoreState => ({
    favorites: [],
    playbackPositions: [],
    hiddenCategories: [],
    recentlyViewed: [],
});
const archive = (id: number): XtreamPendingRestoreState => ({
    ...empty(),
    hiddenCategories: [{ categoryType: 'movies', xtreamId: id }],
    recentlyViewed: [
        { contentType: 'movie', xtreamId: id, viewedAt: '2026-01-01' },
    ],
});
const originalElectron = window.electron;
let instanceId: string | null;
async function profile(id: string | null): Promise<void> {
    instanceId = id;
    await prepareSourceConnection();
}
beforeEach(async () => {
    localStorage.clear();
    Object.defineProperty(window, 'electron', {
        configurable: true,
        writable: true,
        value: {
            sourceSyncConnection: () =>
                instanceId
                    ? { apiUrl: 'https://server.test/api', instanceId }
                    : null,
        },
    });
    await profile(null);
});
afterEach(async () => {
    await profile(null);
    window.electron = originalElectron;
    localStorage.clear();
});

it('isolates dormant history and hidden categories for identical IDs across profiles', async () => {
    const service = new XtreamDeferredCatalogRestoreService();
    service.prepare('same', archive(1), []);
    await profile('a');
    expect(service.forExport('same', empty()).recentlyViewed).toEqual([]);
    service.prepare('same', archive(2), []);
    await profile('b');
    expect(service.forExport('same', empty()).hiddenCategories).toEqual([]);
    service.prepare('same', archive(3), []);
    await profile('a');
    expect(service.forExport('same', empty()).recentlyViewed).toEqual(
        archive(2).recentlyViewed
    );
    await profile(null);
    expect(service.forExport('same', empty()).hiddenCategories).toEqual(
        archive(1).hiddenCategories
    );
});

it('limits global history and source clearing to the selected profile', async () => {
    const service = new XtreamDeferredCatalogRestoreService();
    for (const id of [null, 'a', 'b']) {
        await profile(id);
        service.prepare('same', archive(1), []);
    }
    await profile('a');
    service.clearHistory();
    expect(service.forExport('same', empty()).recentlyViewed).toEqual([]);
    expect(service.forExport('same', empty()).hiddenCategories).toEqual(
        archive(1).hiddenCategories
    );
    await profile('b');
    expect(service.forExport('same', empty()).recentlyViewed).toEqual(
        archive(1).recentlyViewed
    );
    service.clearAll();
    await profile(null);
    expect(service.forExport('same', empty()).recentlyViewed).toEqual(
        archive(1).recentlyViewed
    );
});

it('does not consume a matching snapshot owned by another profile', async () => {
    const service = new XtreamDeferredCatalogRestoreService();
    await profile('a');
    const old = service.prepare('same', archive(1), []);
    await profile('b');
    service.prepare('same', archive(1), []);
    service.complete('same', old.snapshot, ['movie']);
    expect(service.forExport('same', empty()).recentlyViewed).toEqual(
        archive(1).recentlyViewed
    );
});
