import { createFavoriteBackupRestorer } from './favorites-backup-restore';
import { FavoritesPlaylistAdapter } from './favorites-playlist-adapter';
import { previewLocalFavorites } from './favorites-sync-settings';
import { FavoritesSyncClient } from '@iptvnator/services/favorites-sync';
import {
    m3uFavoriteReference,
    type FavoriteLocalRecord,
    type FavoriteLocalStore,
    type FavoriteReference,
} from '@iptvnator/shared/interfaces/favorites-sync';
import type {
    Playlist,
    PlaylistBackupEntry,
} from '@iptvnator/shared/interfaces';
import type { IXtreamDataSource } from '@iptvnator/portal/xtream/data-access';

async function fixture(
    provider: 'm3u' | 'xtream' | 'stalker',
    enabled: boolean
) {
    const url = 'https://synthetic.invalid/stream';
    const reference: FavoriteReference =
        provider === 'm3u'
            ? await m3uFavoriteReference(url)
            : provider === 'xtream'
              ? { provider, kind: 'movie', id: '42' }
              : { provider, kind: 'movie', id: '42' };
    const favorite =
        provider === 'm3u'
            ? url
            : {
                  id: '42',
                  title: 'Synthetic restored favorite',
                  favoriteContentType: 'vod',
              };
    const source = {
        _id: 'synthetic-source',
        favorites: [favorite],
        ...(provider === 'xtream'
            ? { serverUrl: 'https://synthetic.invalid' }
            : provider === 'stalker'
              ? { portalUrl: 'https://synthetic.invalid' }
              : {
                    playlist: {
                        items: [
                            {
                                id: url,
                                url,
                                name: 'Synthetic restored favorite',
                            },
                        ],
                    },
                }),
    } as Playlist;
    let consent: string | null = enabled ? 'generation' : null;
    let active = true;
    let record: FavoriteLocalRecord = {
        base: { revision: 3, member: false },
        state: { revision: 3, member: false },
        local: { revision: 3, member: false },
        pending: [],
    };
    const store: FavoriteLocalStore = {
        read: async () => record,
        entries: async () => [
            { address: client.address(context, reference), record },
        ],
        pending: async () => record.pending,
        mutate: jest.fn(async (_address, change) => (record = change(record))),
    };
    const context = {
        sourceId: source._id,
        sourceIncarnation: 'first',
        provider,
    };
    const request = jest.fn(async () => ({ status: 200, body: context }));
    const client = new FavoritesSyncClient(store, {
        instanceId: 'nas',
        deviceId: 'synthetic-device',
        consent: () => consent,
        profileActive: () => active,
        contexts: [context],
        request,
        changed: jest.fn(),
        remember: jest.fn(),
    });
    const adapter = new FavoritesPlaylistAdapter(
        client,
        () => consent !== null
    );
    record.pending.push({
        address: client.address(context, reference),
        consentGeneration: 'previous-consent',
        operation: {
            operationId: 'synthetic-parked',
            deviceId: 'synthetic-device',
            expectedRevision: 3,
            member: false,
        },
    });
    const entry = {
        portalType: provider,
        userState: {
            favorites:
                provider === 'xtream'
                    ? [
                          {
                              xtreamId: 42,
                              contentType: 'movie',
                              snapshot: {
                                  title: 'Synthetic restored favorite',
                              },
                          },
                      ]
                    : [favorite],
        },
    } as PlaylistBackupEntry;
    const raw = {
        getFavorites: async () => [
            {
                id: null,
                xtream_id: 42,
                type: 'movie',
                title: 'Synthetic restored favorite',
            },
        ],
    } as unknown as IXtreamDataSource;
    return {
        source,
        reference,
        store,
        client,
        adapter,
        entry,
        raw,
        request,
        record: () => record,
        consent: (value: string | null) => (consent = value),
        active: (value: boolean) => (active = value),
    };
}
it.each(['m3u', 'xtream', 'stalker'] as const)(
    'makes a restored %s membership available to explicit preview after opt-out',
    async (provider) => {
        for (const enabled of [false, true]) {
            const f = await fixture(provider, enabled);
            const base = f.record().base;
            const pending = f.record().pending;
            await createFavoriteBackupRestorer(
                f.client,
                f.adapter,
                async () => f.source
            )(f.source._id, f.entry);
            expect(f.record().local?.member).toBe(true);
            expect(f.record().state.member).toBe(!enabled);
            expect(f.record().base).toBe(base);
            expect(f.record().pending).toBe(pending);
            expect(f.request).not.toHaveBeenCalled();
            f.consent('import-generation');
            const preview = await previewLocalFavorites(
                f.client,
                f.raw,
                f.adapter,
                [f.source],
                async () => f.source,
                'import-generation'
            );
            expect(
                preview.sources[0].items.map((item) => item.reference)
            ).toEqual([f.reference]);
            expect(preview.unresolved).toBe(0);
        }
    }
);
it('leaves omitted local removals intact', async () => {
    const f = await fixture('xtream', false);
    const restore = createFavoriteBackupRestorer(
        f.client,
        f.adapter,
        async () => f.source
    );
    await restore(f.source._id, {
        ...f.entry,
        userState: { ...f.entry.userState, favorites: [] },
    } as PlaylistBackupEntry);
    expect(f.record().local?.member).toBe(false);
    expect(f.store.mutate).not.toHaveBeenCalled();
});
it('uses the canonical restore normalization for malformed legacy Xtream entries', async () => {
    const f = await fixture('xtream', false);
    if (f.entry.portalType !== 'xtream')
        throw new Error('Synthetic fixture type');
    f.entry.userState.favorites.unshift({ xtreamId: -1, contentType: 'movie' });
    await createFavoriteBackupRestorer(
        f.client,
        f.adapter,
        async () => f.source
    )(f.source._id, f.entry);
    expect(f.record().local?.member).toBe(true);
    expect(f.request).not.toHaveBeenCalled();
});
it.each(['profile', 'consent', 'incarnation'])(
    'rejects a delayed restore after changing %s',
    async (change) => {
        const f = await fixture('m3u', false);
        const restore = createFavoriteBackupRestorer(
            f.client,
            f.adapter,
            async () => {
                if (change === 'profile') f.active(false);
                else if (change === 'consent') f.consent('replacement');
                else
                    f.client.contexts.set(f.source._id, {
                        ...f.client.contexts.get(f.source._id)!,
                        sourceIncarnation: 'replacement',
                    });
                return f.source;
            }
        );
        await expect(restore(f.source._id, f.entry)).rejects.toThrow(
            'Favorite restore expired'
        );
        expect(f.store.mutate).not.toHaveBeenCalled();
    }
);
