import { webcrypto } from 'node:crypto';
import type { Playlist } from '@iptvnator/shared/interfaces';
import type { FavoritesSyncClient } from '@iptvnator/services/favorites-sync';
import {
    m3uFavoriteReference,
    type FavoriteEntry,
} from '@iptvnator/shared/interfaces/favorites-sync';
import { FavoritesPlaylistAdapter } from './favorites-playlist-adapter';

beforeAll(() =>
    Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: webcrypto,
    })
);
afterEach(() => jest.restoreAllMocks());

describe('M3U favorite URL index', () => {
    it('shares unchanged and overlapping reads, invalidates versions and incarnations, and resolves changed URLs', async () => {
        const items = Array.from({ length: 20 }, (_, n) => ({
            url: `https://fixture.invalid/${n}`,
            name: `Synthetic ${n}`,
        }));
        const source = {
            _id: 'source',
            title: 'Synthetic source',
            favorites: [],
            items,
            count: items.length,
            sourceSyncRevision: '1',
        } as unknown as Playlist;
        const ref = await m3uFavoriteReference(items[0].url);
        const entry = {
            address: { sourceIncarnation: 'first', content: ref },
            record: { state: { member: true } },
        } as FavoriteEntry;
        const client = {
            entries: async () => [entry],
        } as unknown as FavoritesSyncClient;
        const adapter = new FavoritesPlaylistAdapter(client, () => true);
        const digest = jest.spyOn(webcrypto.subtle, 'digest');
        expect((await adapter.project(source)).favorites).toEqual([
            items[0].url,
        ]);
        expect(digest).toHaveBeenCalledTimes(20);
        digest.mockClear();
        await Promise.all([
            adapter.project({
                ...source,
                items: items.map((item) => ({ ...item })),
            }),
            adapter.project({
                ...source,
                items: items.map((item) => ({ ...item })),
            }),
        ]);
        expect(digest).not.toHaveBeenCalled();
        source.sourceSyncRevision = '2';
        await Promise.all([adapter.project(source), adapter.project(source)]);
        expect(digest).toHaveBeenCalledTimes(20);
        digest.mockClear();
        entry.address.sourceIncarnation = 'second';
        await adapter.project(source);
        expect(digest).toHaveBeenCalledTimes(20);
        digest.mockClear();
        source.updateDate = 1;
        await adapter.project(source);
        expect(digest).toHaveBeenCalledTimes(20);
        digest.mockClear();
        source.count = 21;
        await adapter.project(source);
        expect(digest).toHaveBeenCalledTimes(20);
        digest.mockClear();
        const changed = {
            ...source,
            updateDate: 2,
            items: [{ ...items[0], url: 'https://fixture.invalid/changed' }],
        };
        expect((await adapter.project(changed)).favorites).toEqual([]);
        expect(digest).toHaveBeenCalledTimes(1);
    });

    it('retries a failed index build instead of caching a rejected promise', async () => {
        const url = 'https://fixture.invalid/one';
        const source = {
            _id: 'source',
            items: [{ url }],
            favorites: [],
        } as unknown as Playlist;
        const content = await m3uFavoriteReference(url);
        const client = {
            entries: async () => [
                {
                    address: { sourceIncarnation: 'first', content },
                    record: { state: { member: true } },
                },
            ],
        } as unknown as FavoritesSyncClient;
        const adapter = new FavoritesPlaylistAdapter(client, () => true);
        const digest = jest
            .spyOn(webcrypto.subtle, 'digest')
            .mockRejectedValueOnce(new Error('Synthetic digest failure'));
        await expect(adapter.project(source)).rejects.toThrow(
            'Synthetic digest failure'
        );
        expect((await adapter.project(source)).favorites).toEqual([url]);
        expect(digest).toHaveBeenCalledTimes(2);
        expect(
            (
                await adapter.project({
                    ...source,
                    items: [{ url: 'https://fixture.invalid/replacement' }],
                })
            ).favorites
        ).toEqual([]);
        expect(digest).toHaveBeenCalledTimes(3);
    });
});
