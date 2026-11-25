import type { IXtreamDataSource } from '@iptvnator/portal/xtream/data-access';
import {
    mutateFavoritePlaylist,
    type FavoritesPlaylistBridge,
} from '@iptvnator/services/favorites-events';
import {
    setActivePersonalScope,
    ProfileStateUnavailableError,
} from '@iptvnator/services/profiles';
import type { FavoritesSyncClient } from '@iptvnator/services/favorites-sync';
import type { HistorySyncClient } from '@iptvnator/services/history-sync';
import type { Playlist } from '@iptvnator/shared/interfaces';
import type { PersonalScope } from '@iptvnator/shared/interfaces/profiles';
import { FavoritesLocalOrder } from './favorites-local-order';
import { FavoritesPlaylistAdapter } from './favorites-playlist-adapter';
import { FavoritesXtreamAdapter } from './favorites-xtream-adapter';
import { HistoryPlaylistAdapter } from './history-playlist-adapter';
import { HistoryXtreamAdapter } from './history-xtream-adapter';
import { historyContextsKey } from './history-contexts-key';

const KIDS: PersonalScope = 'profile:11111111-1111-4111-8111-111111111111';
const locks = {
    active: () => false,
    withholdsEverything: () => false,
    version: () => 0,
};
const household = {
    _id: 'src',
    title: 'Synthetic',
    favorites: ['http://example.test/household.m3u8'],
    recentlyViewed: [
        { source: 'm3u', url: 'http://example.test/household.m3u8' },
    ],
} as unknown as Playlist;

afterEach(() => setActivePersonalScope('shared'));

describe('favorites never leak between profiles', () => {
    const client = (scope: PersonalScope) =>
        ({
            scope,
            entries: async () => [],
            contexts: new Map([['src', { sourceId: 'src' }]]),
            options: {
                consent: () => 'c',
                profileActive: () => true,
                instanceId: 'nas',
            },
            current: () => undefined,
            generation: () => 'c',
            set: async () => undefined,
            setLocal: async () => undefined,
        }) as unknown as FavoritesSyncClient;

    it('starts a profile from an empty playlist base', async () => {
        const adapter = (scope: PersonalScope) =>
            new FavoritesPlaylistAdapter(client(scope), () => true);
        const order = { read: () => ['k'] } as unknown as FavoritesLocalOrder;
        expect((await adapter('shared').project(household)).favorites).toEqual(
            household.favorites
        );
        const kids = await new FavoritesPlaylistAdapter(
            client(KIDS),
            () => true,
            undefined,
            order
        ).project(household);
        expect(kids.favorites).toEqual([]);
        expect((await adapter(KIDS).project(household)).favorites).toEqual([]);
    });

    it('refuses to store a profile favorite in the household playlist', async () => {
        const persistLocal = jest.fn();
        const adapter = new FavoritesPlaylistAdapter(client(KIDS), () => true);
        await expect(
            adapter.mutate(
                { ...household, macAddress: 'synthetic-mac' } as Playlist,
                (current) => [
                    ...current,
                    {
                        id: '42',
                        favoriteContentType: 'vod',
                        series: 'invalid-series',
                    } as never,
                ],
                persistLocal
            )
        ).rejects.toBeInstanceOf(ProfileStateUnavailableError);
        expect(persistLocal).not.toHaveBeenCalled();
    });

    it('does not fall through to the shared playlist when sync is unavailable', async () => {
        const bridge: FavoritesPlaylistBridge = {
            active: () => false,
            project: async (p) => p,
            mutate: async () => null,
        };
        const persist = jest.fn(async (p: Playlist) => p);
        setActivePersonalScope(KIDS);
        await expect(
            mutateFavoritePlaylist(household, (c) => c, bridge, persist)
        ).rejects.toBeInstanceOf(ProfileStateUnavailableError);
        expect(persist).not.toHaveBeenCalled();
        setActivePersonalScope('shared');
        await mutateFavoritePlaylist(household, (c) => c, bridge, persist);
        expect(persist).toHaveBeenCalledTimes(1);
    });

    it('starts the raw Xtream favorites empty for a profile', async () => {
        const raw = {
            getFavorites: jest.fn(async () => [{ id: 1 }]),
        } as unknown as IXtreamDataSource;
        const project = (scope: PersonalScope) =>
            new FavoritesXtreamAdapter(
                client(scope),
                () => true,
                true,
                locks
            ).project(raw, 'src');
        await expect(project(KIDS)).resolves.toEqual([]);
        expect(raw.getFavorites).not.toHaveBeenCalled();
    });

    it('keeps the display order per scope and the Default key unchanged', () => {
        const store = new Map<string, string>();
        const storage = {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => void store.set(k, v),
        };
        store.set('iptvnator-server:nas:favorites-order:src', '["old"]');
        expect(new FavoritesLocalOrder('nas', storage).read('src')).toEqual([
            'old',
        ]);
        const kids = new FavoritesLocalOrder('nas', storage, KIDS);
        expect(kids.read('src')).toEqual([]);
        kids.write('src', ['kid']);
        expect(new FavoritesLocalOrder('nas', storage).read('src')).toEqual([
            'old',
        ]);
    });
});

describe('history never leaks between profiles', () => {
    const client = (personalScope: PersonalScope, state: unknown = null) =>
        ({
            personalScope,
            contexts: new Map(),
            state: async () => state,
            current: () => undefined,
            options: { consent: () => 'c' },
            scope: async () => {
                throw new Error('unverified');
            },
        }) as unknown as HistorySyncClient;

    it('hides the household archive from a profile', async () => {
        const catalog = async (p: Playlist) => p;
        expect(
            (
                await new HistoryPlaylistAdapter(
                    client('shared'),
                    catalog
                ).project(household)
            ).recentlyViewed
        ).toHaveLength(1);
        const unverified = await new HistoryPlaylistAdapter(
            client(KIDS),
            catalog
        ).project(household);
        expect(unverified.recentlyViewed).toEqual([]);
        const verified = await new HistoryPlaylistAdapter(
            client(KIDS, { items: [], revision: 0, cleared: 0 }),
            catalog
        ).project(household);
        expect(verified.recentlyViewed).toEqual([]);
    });

    it('starts the raw Xtream recents empty and refuses the raw fallback for a profile', async () => {
        const raw = {
            getRecentItems: jest.fn(async () => [{ id: 1 }]),
            addRecentItem: jest.fn(),
            removeRecentItem: jest.fn(),
        } as unknown as IXtreamDataSource;
        const kids = new HistoryXtreamAdapter(client(KIDS), true, locks);
        await expect(kids.project(raw, 'src')).resolves.toEqual([]);
        await expect(
            kids.invoke(raw, 'addRecentItem', [1, 'src'])
        ).rejects.toBeInstanceOf(ProfileStateUnavailableError);
        expect(raw.getRecentItems).not.toHaveBeenCalled();
        expect(raw.addRecentItem).not.toHaveBeenCalled();
    });

    it('keeps saved contexts per scope and the Default key unchanged', () => {
        expect(historyContextsKey('nas', 'shared')).toBe(
            'iptvnator-server:nas:history-contexts-v1'
        );
        expect(historyContextsKey('nas', KIDS)).not.toBe(
            historyContextsKey('nas', 'shared')
        );
    });
});
