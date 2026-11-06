import { PwaXtreamRestoreProgress } from '../pwa-xtream-restore-progress';
import { XTREAM_RESTORE_RECEIPTS } from '../xtream-user-data-keys';
import { ServerUserDataStorage } from './server-user-data-storage';
import { fakeServer, memoryStorage } from './server-user-data.test-helpers';

it('keeps atomic restore receipts local across server reads, edits and reload', async () => {
    const server = fakeServer();
    const local = memoryStorage();
    const storage = new ServerUserDataStorage(
        server.api as never,
        local,
        jest.fn()
    );
    await storage.hydrate();
    const state = {
        favoritesRestoreId: 'backup',
        favorites: [{ xtreamId: 5, contentType: 'movie' as const }],
        recentlyViewed: [],
        playbackPositions: [],
        hiddenCategories: [],
    };
    new PwaXtreamRestoreProgress(storage, 'p1', state).writeList('favorites', [
        'movie:5',
    ]);
    const remaining = new PwaXtreamRestoreProgress(storage, 'p1', state);
    remaining.writeList('recentItems', []);
    remaining.writeList('playbackPositions', []);
    await storage.flush();
    await new PwaXtreamRestoreProgress(storage, 'p1', state).confirmServer();
    expect(Object.keys(server.state['xtream-favorites'])).toEqual(['p1']);
    await storage.hydrate();
    expect(
        new PwaXtreamRestoreProgress(storage, 'p1', state).hasApplied(
            'favorites'
        )
    ).toBe(true);
    // Another device removes the imported item. The receipt must not reclaim it on retry.
    server.state['xtream-favorites']['p1'] = [];
    await storage.hydrate();
    const map = JSON.parse(storage.getItem('xtream-favorites') ?? '{}');
    expect(map[XTREAM_RESTORE_RECEIPTS].p1.keys).toEqual([]);
    storage.close();
    const reloaded = new ServerUserDataStorage(
        server.api as never,
        local,
        jest.fn()
    );
    await reloaded.hydrate();
    const progress = new PwaXtreamRestoreProgress(reloaded, 'p1', state);
    expect(progress.hasApplied('favorites')).toBe(true);
    progress.writeList('favorites', ['movie:5']);
    expect(JSON.parse(reloaded.getItem('xtream-favorites') ?? '{}').p1).toEqual(
        []
    );
    await reloaded.deleting('p1', async () => undefined);
    expect(
        JSON.parse(reloaded.getItem('xtream-favorites') ?? '{}')[
            XTREAM_RESTORE_RECEIPTS
        ]?.p1
    ).toBeUndefined();
    reloaded.close();
});

it('does not acknowledge restore progress only in memory when browser quota rejects its receipt', async () => {
    const server = fakeServer();
    const local = memoryStorage();
    const storage = new ServerUserDataStorage(
        server.api as never,
        local,
        jest.fn()
    );
    await storage.hydrate();
    const set = local.setItem;
    local.setItem = (key, value) => {
        if (key.endsWith(':xtream-favorites'))
            throw new DOMException('full', 'QuotaExceededError');
        set(key, value);
    };
    const state = {
        favoritesRestoreId: 'backup',
        favorites: [{ xtreamId: 5, contentType: 'movie' as const }],
        recentlyViewed: [],
        playbackPositions: [],
        hiddenCategories: [],
    };
    expect(() =>
        new PwaXtreamRestoreProgress(storage, 'p1', state).writeList(
            'favorites',
            ['movie:5']
        )
    ).toThrow('full');
    expect(
        new PwaXtreamRestoreProgress(storage, 'p1', state).hasApplied(
            'favorites'
        )
    ).toBe(false);
    await storage.flush();
    expect(server.state['xtream-favorites']).toEqual({});
    storage.close();
});
