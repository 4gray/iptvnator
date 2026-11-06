import { applyExplicitRestoreListEdits } from '../pwa-xtream-restore-edits';
import type {
    XtreamPendingRestoreState,
    XtreamPlaylistBackupEntry,
} from '@iptvnator/shared/interfaces';
import { PwaXtreamBackupStorage } from '../pwa-xtream-backup-storage';
import {
    XTREAM_USER_DATA_KEYS as KEYS,
    writeXtreamUserDataMap,
} from '../xtream-user-data-keys';
import { ServerUserDataStorage } from './server-user-data-storage';
import { fakeServer, memoryStorage } from './server-user-data.test-helpers';

it.each(['none', 'remove', 'readd', 'add'] as const)(
    'replays an unconfirmed server replacement after reload while preserving explicit %s edits',
    async (edit) => {
        const server = fakeServer({ 'xtream-favorites': { p1: ['live:1'] } });
        const send = server.api.sendJson;
        let conflict = true;
        server.api.sendJson = jest.fn(
            async (...args: Parameters<typeof send>) => {
                if (conflict && args[1].includes('/xtream-favorites/p1')) {
                    conflict = false;
                    server.state['xtream-favorites']['p1'] = [
                        'live:1',
                        'live:99',
                    ];
                }
                return send(...args);
            }
        );
        const local = memoryStorage();
        let storage = new ServerUserDataStorage(
            server.api as never,
            local,
            jest.fn()
        );
        const state: XtreamPendingRestoreState = {
            favoritesRestoreId: 'restore',
            hiddenCategories: [],
            favorites: [
                {
                    xtreamId: 42,
                    contentType: 'movie',
                    snapshot: { title: 'Archived original', tmdbId: 100 },
                },
            ],
            recentlyViewed: [
                { xtreamId: 42, contentType: 'movie', viewedAt: '2020-01-01' },
            ],
            playbackPositions: [
                {
                    contentXtreamId: 42,
                    contentType: 'vod',
                    positionSeconds: 12,
                },
            ],
        };
        const entry: XtreamPlaylistBackupEntry = {
            exportedId: 'p1',
            portalType: 'xtream',
            title: 'Source',
            autoRefresh: false,
            connection: {
                serverUrl: 'https://synthetic.invalid',
                username: 'demo',
            },
            userState: state,
        };
        await expect(
            new PwaXtreamBackupStorage(storage).restore('p1', state)
        ).rejects.toThrow('changed elsewhere');
        const read = (key: string) => JSON.parse(storage.getItem(key) ?? '{}');
        expect(server.state['xtream-favorites']['p1']).toEqual([
            'live:99',
            'movie:42',
        ]);
        if (edit === 'remove' || edit === 'readd') {
            writeXtreamUserDataMap(storage, KEYS.favorites, {
                p1: ['live:99'],
            });
        }
        if (edit === 'readd') {
            writeXtreamUserDataMap(storage, KEYS.collectionItems, {
                p1: {
                    'movie:42': {
                        id: 42,
                        xtream_id: 42,
                        type: 'movie',
                        title: 'Explicit replacement',
                        tmdb_id: 200,
                    },
                },
            });
            writeXtreamUserDataMap(storage, KEYS.favorites, {
                p1: ['live:99', 'movie:42'],
            });
        }
        if (edit === 'add')
            writeXtreamUserDataMap(storage, KEYS.favorites, {
                p1: ['live:99', 'movie:42', 'live:50'],
            });
        // An explicit playback/history edit must also survive retry.
        writeXtreamUserDataMap(storage, KEYS.recentItems, {
            p1: [{ id: 'movie:42', viewedAt: '2026-01-01' }],
        });
        writeXtreamUserDataMap(storage, KEYS.playbackPositions, {
            p1: [
                {
                    contentXtreamId: 42,
                    contentType: 'vod',
                    positionSeconds: 55,
                },
            ],
        });
        await storage.flush();
        const before = new PwaXtreamBackupStorage(storage).exportInto(
            entry,
            state
        );
        storage.close();
        storage = new ServerUserDataStorage(
            server.api as never,
            local,
            jest.fn()
        );
        await new PwaXtreamBackupStorage(storage).restore('p1', state);
        expect(server.state['xtream-favorites']['p1']).toEqual(
            edit === 'remove'
                ? []
                : edit === 'add'
                  ? ['movie:42', 'live:50']
                  : ['movie:42']
        );
        expect(read(KEYS.recentItems)['p1'][0].viewedAt).toBe('2026-01-01');
        expect(read(KEYS.playbackPositions)['p1'][0].positionSeconds).toBe(55);
        if (edit !== 'remove')
            expect(
                new PwaXtreamBackupStorage(storage).exportInto(entry).userState
                    .favorites[0].snapshot?.tmdbId
            ).toBe(edit === 'readd' ? 200 : 100);
        expect(
            before.userState.favorites.some((item) => item.xtreamId === 99)
        ).toBe(false);
        storage.close();
    }
);

it('keeps a failed receipt compaction pending and preserves a later explicit removal', async () => {
    const server = fakeServer();
    const local = memoryStorage();
    const set = local.setItem;
    let denied = true;
    local.setItem = (key, value) => {
        if (key.endsWith(':xtream-favorites')) {
            const parsed = JSON.parse(value);
            const receipt =
                parsed?.['__iptvnator_xtream_restore_receipts__']?.p1;
            if (denied && receipt && receipt.serverList === undefined)
                throw new DOMException('ack full', 'QuotaExceededError');
        }
        set(key, value);
    };
    const storage = new ServerUserDataStorage(
        server.api as never,
        local,
        jest.fn()
    );
    const state: XtreamPendingRestoreState = {
        favoritesRestoreId: 'ack',
        hiddenCategories: [],
        favorites: [{ contentType: 'movie', xtreamId: 42 }],
        recentlyViewed: [],
        playbackPositions: [],
    };
    await expect(
        new PwaXtreamBackupStorage(storage).restore('p1', state)
    ).rejects.toThrow('ack full');
    writeXtreamUserDataMap(storage, KEYS.favorites, { p1: [] });
    denied = false;
    await new PwaXtreamBackupStorage(storage).restore('p1', state);
    expect(server.state[KEYS.favorites]['p1']).toEqual([]);
    storage.close();
});

it('preserves archive order on an untouched remote list, while honoring an explicit reorder', () => {
    const target = ['movie:42', 'movie:43'];
    const remote = ['movie:43', 'live:99', 'movie:42'];
    expect(
        applyExplicitRestoreListEdits(target, remote, [...remote], 'value')
    ).toEqual(target);
    expect(
        applyExplicitRestoreListEdits(
            target,
            ['movie:42', 'live:99', 'movie:43'],
            remote,
            'value'
        )
    ).toEqual(['movie:43', 'movie:42']);
});
