import { FavoritesXtreamAdapter } from './favorites-xtream-adapter';
import type { FavoritesSyncClient } from '@iptvnator/services/favorites-sync';
import type { IXtreamDataSource } from '@iptvnator/portal/xtream/data-access';
import type { FavoriteEntry } from '@iptvnator/shared/interfaces/favorites-sync';

const unlocked = {
    active: () => false,
    withholdsEverything: () => false,
    version: () => 0,
};
const candidate = {
    id: 77,
    xtream_id: 42,
    type: 'movie',
    category_id: 3,
    title: 'Synthetic received movie',
    tmdb_id: 100,
    release_year: 2024,
    rating: '',
    added: '',
    poster_url: '',
};
function fixture() {
    const entries: FavoriteEntry[] = [
        {
            address: {
                instanceId: 'nas',
                scope: 'shared',
                sourceId: 'source',
                sourceIncarnation: 'first',
                content: { provider: 'xtream', kind: 'movie', id: '42' },
            },
            record: {
                base: { revision: 1, member: true },
                state: {
                    revision: 1,
                    member: true,
                    snapshot: {
                        title: candidate.title,
                        tmdbId: '100',
                        releaseYear: '2024',
                    },
                },
                pending: [],
            },
        },
    ];
    const set = jest.fn();
    const client = {
        contexts: new Map([
            [
                'source',
                {
                    sourceId: 'source',
                    sourceIncarnation: 'first',
                    provider: 'xtream' as const,
                },
            ],
        ]),
        entries: async () => entries,
        set,
    } as unknown as FavoritesSyncClient;
    return { entries, set, client };
}
it('forwards saved identity when projecting a received SQLite favorite', async () => {
    const f = fixture();
    const lookup = jest.fn(async (_id, _source, _kind, identity) =>
        identity?.tmdbId === 100 ? candidate : { ...candidate, tmdb_id: 200 }
    );
    const raw = {
        getFavorites: async () => [],
        getContentByXtreamId: lookup,
    } as unknown as IXtreamDataSource;
    const rows = await new FavoritesXtreamAdapter(
        f.client,
        () => true,
        true,
        unlocked
    ).project(raw, 'source');
    expect(lookup).toHaveBeenCalledWith(
        42,
        'source',
        'movie',
        {
            tmdbId: 100,
            releaseYear: 2024,
        },
        undefined,
        true
    );
    expect(rows[0]).toMatchObject({ id: 77, catalog_status: 'present' });
});
it('forwards selected identity when adding a compatible duplicate SQLite row', async () => {
    const f = fixture();
    f.entries.length = 0;
    const lookup = jest.fn(async (_id, _source, _kind, identity) =>
        identity?.tmdbId === 100 ? candidate : { ...candidate, tmdb_id: 200 }
    );
    const raw = {
        getFavorites: async () => [],
        getContentByXtreamId: lookup,
    } as unknown as IXtreamDataSource;
    await new FavoritesXtreamAdapter(
        f.client,
        () => true,
        true,
        unlocked
    ).invoke(raw, 'addFavorite', [
        {
            id: 77,
            providerId: 42,
            type: 'movie',
            identity: { tmdbId: 100, releaseYear: 2024 },
        },
        'source',
    ]);
    expect(f.set).toHaveBeenCalledWith(
        'source',
        { provider: 'xtream', kind: 'movie', id: '42' },
        true,
        expect.objectContaining({ tmdbId: '100' })
    );
});
it('hydrates a cold PWA receiver once per type across concurrent reads', async () => {
    const f = fixture();
    let loaded = false;
    const load = jest.fn(async () => {
        loaded = true;
        return [
            { ...candidate, id: 88, category_id: 4, tmdb_id: 200 },
            candidate,
        ];
    });
    const raw = {
        getFavorites: async () => [],
        hasContent: async () => loaded,
        getPlaylist: async () => ({
            serverUrl: 'https://synthetic.invalid',
            username: 'synthetic-user',
            password: 'synthetic-password',
        }),
        getContent: load,
        getContentByXtreamId: async () => (loaded ? candidate : null),
    } as unknown as IXtreamDataSource;
    const adapter = new FavoritesXtreamAdapter(
        f.client,
        () => true,
        false,
        unlocked
    );
    const [first, second] = await Promise.all([
        adapter.invoke(raw, 'getFavorites', ['source']),
        adapter.invoke(raw, 'getFavorites', ['source']),
    ]);
    expect(first).toMatchObject([{ id: 77, catalog_status: 'present' }]);
    expect(second).toMatchObject([{ id: 77, catalog_status: 'present' }]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith(
        'source',
        expect.objectContaining({ serverUrl: 'https://synthetic.invalid' }),
        'movie'
    );
    expect(f.set).not.toHaveBeenCalled();
});
it('scans a received catalog once for all requested favorites', async () => {
    const f = fixture();
    const first = f.entries[0];
    f.entries.splice(
        0,
        1,
        ...[42, 43, 44].map((id) => ({
            ...first,
            address: {
                ...first.address,
                content: {
                    provider: 'xtream' as const,
                    kind: 'movie' as const,
                    id: String(id),
                },
            },
        }))
    );
    let inspected = 0;
    const rows = Array.from({ length: 1000 }, (_, index) =>
        Object.defineProperty({ ...candidate, id: index + 1 }, 'xtream_id', {
            enumerable: true,
            get: () => {
                inspected++;
                return index + 1;
            },
        })
    );
    const raw = {
        getFavorites: async () => [],
        getPlaylist: async () => ({
            serverUrl: 'https://synthetic.invalid',
            username: 'synthetic-user',
            password: 'synthetic-password',
        }),
        getContent: async () => rows,
    } as unknown as IXtreamDataSource;
    expect(
        await new FavoritesXtreamAdapter(
            f.client,
            () => true,
            false,
            unlocked
        ).invoke(raw, 'getFavorites', ['source'])
    ).toHaveLength(3);
    expect(inspected).toBeLessThan(rows.length * 2);
});
it('retains an offline snapshot and retries hydration when the provider returns', async () => {
    const f = fixture();
    let loaded = false;
    const load = jest
        .fn()
        .mockRejectedValueOnce(new Error('Synthetic provider outage'))
        .mockImplementation(async () => {
            loaded = true;
            return [candidate];
        });
    const raw = {
        getFavorites: async () => [],
        hasContent: async () => loaded,
        getPlaylist: async () => ({
            serverUrl: 'https://synthetic.invalid',
            username: 'synthetic-user',
            password: 'synthetic-password',
        }),
        getContent: load,
        getContentByXtreamId: async () => (loaded ? candidate : null),
    } as unknown as IXtreamDataSource;
    const adapter = new FavoritesXtreamAdapter(
        f.client,
        () => true,
        false,
        unlocked
    );
    expect(await adapter.invoke(raw, 'getFavorites', ['source'])).toMatchObject(
        [{ id: null, title: candidate.title, catalog_status: 'unknown' }]
    );
    expect(await adapter.invoke(raw, 'getFavorites', ['source'])).toMatchObject(
        [{ id: 77, catalog_status: 'present' }]
    );
    expect(load).toHaveBeenCalledTimes(2);
});
it('keeps offline writes independent of received-favorite catalog hydration', async () => {
    const f = fixture();
    const load = jest.fn();
    const raw = {
        getFavorites: async () => [],
        getContentByXtreamId: async () => null,
        getContent: load,
    } as unknown as IXtreamDataSource;
    await new FavoritesXtreamAdapter(
        f.client,
        () => true,
        false,
        unlocked
    ).invoke(raw, 'addFavorite', [
        { id: 43, providerId: 43, type: 'movie' },
        'source',
    ]);
    expect(f.set).toHaveBeenCalledWith(
        'source',
        { provider: 'xtream', kind: 'movie', id: '43' },
        true,
        undefined
    );
    expect(load).not.toHaveBeenCalled();
});
it('does not use a PWA cache lookup to bypass the filtered catalog', async () => {
    const f = fixture();
    const raw = {
        getFavorites: async () => [],
        getPlaylist: async () => ({
            serverUrl: 'https://synthetic.invalid',
            username: 'synthetic-user',
            password: 'synthetic-password',
        }),
        getContent: async () => [],
        getContentByXtreamId: async () => candidate,
    } as unknown as IXtreamDataSource;
    expect(
        await new FavoritesXtreamAdapter(
            f.client,
            () => true,
            false,
            unlocked
        ).invoke(raw, 'getFavorites', ['source'])
    ).toMatchObject([{ id: null, catalog_status: 'unknown' }]);
});
it('retains an explicit identity conflict after PWA catalog hydration', async () => {
    const f = fixture();
    f.entries[0] = {
        ...f.entries[0],
        record: {
            ...f.entries[0].record,
            state: {
                ...f.entries[0].record.state,
                snapshot: {
                    ...f.entries[0].record.state.snapshot,
                    identityConflict: true,
                },
            },
        },
    };
    const raw = {
        getFavorites: async () => [],
        getPlaylist: async () => ({
            serverUrl: 'https://synthetic.invalid',
            username: 'synthetic-user',
            password: 'synthetic-password',
        }),
        getContent: async () => [candidate],
    } as unknown as IXtreamDataSource;
    expect(
        await new FavoritesXtreamAdapter(
            f.client,
            () => true,
            false,
            unlocked
        ).invoke(raw, 'getFavorites', ['source'])
    ).toMatchObject([
        { id: null, catalog_missing_reason: 'identity_conflict' },
    ]);
});
it('does not republish membership removed while its catalog is loading', async () => {
    const f = fixture();
    let finish!: (items: (typeof candidate)[]) => void;
    const load = jest.fn(
        () => new Promise<(typeof candidate)[]>((resolve) => (finish = resolve))
    );
    const raw = {
        getFavorites: async () => [],
        getPlaylist: async () => ({
            serverUrl: 'https://synthetic.invalid',
            username: 'synthetic-user',
            password: 'synthetic-password',
        }),
        getContent: load,
    } as unknown as IXtreamDataSource;
    const pending = new FavoritesXtreamAdapter(
        f.client,
        () => true,
        false,
        unlocked
    ).invoke(raw, 'getFavorites', ['source']);
    for (let attempt = 0; attempt < 10 && !load.mock.calls.length; attempt++)
        await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);
    f.entries.length = 0;
    finish([candidate]);
    expect(await pending).toEqual([]);
});
it('rejects catalog results after source incarnation changes', async () => {
    const f = fixture();
    let finish!: (items: (typeof candidate)[]) => void;
    const load = jest.fn(
        () => new Promise<(typeof candidate)[]>((resolve) => (finish = resolve))
    );
    const raw = {
        getFavorites: async () => [],
        getPlaylist: async () => ({
            serverUrl: 'https://synthetic.invalid',
            username: 'synthetic-user',
            password: 'synthetic-password',
        }),
        getContent: load,
    } as unknown as IXtreamDataSource;
    const pending = new FavoritesXtreamAdapter(
        f.client,
        () => true,
        false,
        unlocked
    ).invoke(raw, 'getFavorites', ['source']);
    for (let attempt = 0; attempt < 10 && !load.mock.calls.length; attempt++)
        await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);
    f.client.contexts.set('source', {
        sourceId: 'source',
        sourceIncarnation: 'replacement',
        provider: 'xtream',
    });
    finish([candidate]);
    await expect(pending).rejects.toThrow();
});

it('resolves only the addressed received favorite for a single heart check', async () => {
    const f = fixture();
    const first = f.entries[0];
    f.entries.splice(
        0,
        1,
        ...Array.from({ length: 100 }, (_, index) => ({
            ...first,
            address: {
                ...first.address,
                content: { ...first.address.content, id: String(index + 1) },
            },
        }))
    );
    const lookup = jest.fn(async (id: number) => ({
        ...candidate,
        xtream_id: id,
    }));
    const raw = {
        getFavorites: async () => [],
        getContentByXtreamId: lookup,
    } as unknown as IXtreamDataSource;
    expect(
        await new FavoritesXtreamAdapter(
            f.client,
            () => true,
            true,
            unlocked
        ).invoke(raw, 'isFavorite', [
            { id: 42, providerId: 42, type: 'movie' },
            'source',
        ])
    ).toBe(true);
    expect(lookup).toHaveBeenCalledTimes(1);
});

it.each(['locked', 'unresolved', 'loading', 'changed'] as const)(
    'withholds a SQLite received favorite when its category is %s',
    async (mode) => {
        const f = fixture();
        let version = 0;
        const locks = {
            active: () => true,
            withholdsEverything: () => mode === 'loading',
            version: () => version,
        };
        const lookup = jest.fn(
            async (
                _id,
                _source,
                _kind,
                _identity,
                _category,
                excludeLocked
            ) => {
                if (mode === 'changed') version++;
                return mode === 'unresolved' ||
                    (mode === 'locked' && excludeLocked)
                    ? null
                    : candidate;
            }
        );
        const raw = {
            getFavorites: async () => [],
            getContentByXtreamId: lookup,
        } as unknown as IXtreamDataSource;
        expect(
            await new FavoritesXtreamAdapter(
                f.client,
                () => true,
                true,
                locks
            ).project(raw, 'source')
        ).toEqual([]);
        if (mode === 'loading') expect(lookup).not.toHaveBeenCalled();
    }
);
