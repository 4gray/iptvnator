import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    createProvider,
    ProviderTransport,
    mediaFavoriteReference,
    mediaFavoriteSnapshot,
    queueFavorite,
    resolveFavoriteEntries,
    resolveFavoriteMedia,
    sharedFavoriteCounts,
} from '@iptvnator/tv/data-access';
import {
    favoriteAddressKey,
    m3uFavoriteReference,
    type FavoriteAddress,
    type FavoriteSourceContext,
} from '@iptvnator/shared/interfaces/favorites-sync';
import {
    hydrateUserData,
    identity,
    initialData,
    removeSourceData,
    type Media,
    type Source,
    type UserData,
} from '@iptvnator/tv/util';

const source: Source = {
    id: 'tv-src-1',
    libraryId: 'srv-src-1',
    provider: 'xtream',
    url: 'http://portal.example',
    name: 'Portal',
};
const context: FavoriteSourceContext = {
    sourceId: 'srv-src-1',
    sourceIncarnation: 'inc-1',
    provider: 'xtream',
};
const liveItem: Media = {
    id: identity(source, 'live', '42'),
    sourceId: 'tv-src-1',
    providerId: '42',
    kind: 'live',
    title: 'Synthetic Channel',
    raw: {},
};
const address: FavoriteAddress = {
    instanceId: 'inst-1',
    scope: 'shared',
    sourceId: 'srv-src-1',
    sourceIncarnation: 'inc-1',
    content: { provider: 'xtream', kind: 'live', id: '42' },
};

function sharedData(extra: Partial<UserData> = {}): UserData {
    return {
        ...initialData(),
        sources: [source],
        favoritesMode: 'shared',
        favoritesConsent: 'consent-1',
        favoritesDeviceId: 'tv-1',
        sharedFavoriteContexts: { 'srv-src-1': context },
        library: {
            url: 'http://library.example/api',
            token: '',
            instanceId: 'inst-1',
            lastSync: 0,
            originals: {},
        },
        ...extra,
    };
}

test('mediaFavoriteReference maps providers and rejects unshareable items', async () => {
    const xtream = await mediaFavoriteReference(liveItem, source);
    assert.deepEqual(xtream, {
        provider: 'xtream',
        kind: 'live',
        id: '42',
    });
    const unlinked = { ...source, libraryId: undefined };
    assert.equal(await mediaFavoriteReference(liveItem, unlinked), null);
    const episode = { ...liveItem, kind: 'episode' as const };
    assert.equal(await mediaFavoriteReference(episode, source), null);
    const invalid = { ...liveItem, providerId: 'not-a-number' };
    assert.equal(await mediaFavoriteReference(invalid, source), null);
});

test('resolveFavoriteMedia rebuilds identities matching the catalog providers', () => {
    const xtream = resolveFavoriteMedia(source, address, {
        title: 'Synthetic Channel',
    });
    assert.equal(xtream?.id, identity(source, 'live', '42'));
    const stalkerSource: Source = {
        id: 'tv-src-2',
        libraryId: 'srv-src-2',
        provider: 'stalker',
        url: 'http://stalker.example',
        name: 'Stalker',
    };
    const lazy = resolveFavoriteMedia(
        stalkerSource,
        {
            ...address,
            sourceId: 'srv-src-2',
            content: {
                provider: 'stalker',
                kind: 'series',
                id: '9',
                mode: 'lazy',
            },
        },
        { title: 'Synthetic Series' }
    );
    assert.equal(lazy?.id, identity(stalkerSource, 'series', 'movie:9'));
    assert.equal(lazy?.kind, 'series');
    assert.equal(lazy?.raw.is_series, true);
    const live = resolveFavoriteMedia(
        stalkerSource,
        {
            ...address,
            sourceId: 'srv-src-2',
            content: { provider: 'stalker', kind: 'live', id: '3' },
        },
        { title: 'Synthetic Channel' }
    );
    assert.equal(live?.id, identity(stalkerSource, 'live', 'live:3'));
    assert.equal(live?.raw.favoriteContentType, 'itv');
});

test('hydrateUserData requires consent for shared mode and preserves rows', () => {
    const base = hydrateUserData({});
    assert.equal(base.favoritesMode, 'local');
    assert.equal(base.sharedFavorites && typeof base.sharedFavorites, 'object');
    const legacy = hydrateUserData({ favoritesMode: 'shared' });
    assert.equal(legacy.favoritesMode, 'local');
    assert.equal(legacy.favoritesConsent, '');
    const enabled = hydrateUserData({
        favoritesMode: 'shared',
        favoritesConsent: 'consent-1',
        sharedFavorites: { 'row-key': { record: {} } } as never,
    });
    assert.equal(enabled.favoritesMode, 'shared');
    assert.equal(enabled.favoritesConsent, 'consent-1');
    assert('row-key' in enabled.sharedFavorites);
});

test('removeSourceData keeps shared rows inert but deletes local favorites', () => {
    const data = sharedData({ favorites: [liveItem] });
    const { data: queued } = queueFavorite(
        data,
        source,
        liveItem,
        true,
        context,
        address.content,
        data.favoritesConsent,
        data.favoritesDeviceId
    );
    const removed = removeSourceData(queued, 'tv-src-1');
    assert.equal(removed.favorites.length, 0);
    assert.equal(
        Object.keys(removed.sharedFavorites).length,
        1,
        'shared membership is server truth, not deleted with the TV source'
    );
});

test('mediaFavoriteSnapshot degrades to empty metadata on contract-breaking titles', () => {
    const broken = { ...liveItem, title: 'ab' };
    assert.deepEqual(mediaFavoriteSnapshot(broken), {});
});

test('resolveFavoriteEntries resolves m3u rows by playlist url hash', async () => {
    const m3uSource: Source = {
        id: 'tv-src-3',
        libraryId: 'srv-src-3',
        provider: 'm3u',
        url: 'http://playlist.example',
        name: 'List',
        m3uItems: [
            {
                url: 'http://media.example/ch',
                name: 'Synthetic Channel',
                tvg: {},
            },
        ],
    };
    const reference = await m3uFavoriteReference('http://media.example/ch');
    const m3uAddress: FavoriteAddress = {
        ...address,
        sourceId: 'srv-src-3',
        content: reference,
    };
    const entries = [
        {
            address: m3uAddress,
            state: { revision: 1, member: true },
        },
    ];
    const media = await resolveFavoriteEntries(m3uSource, entries);
    const item = media.get(favoriteAddressKey(m3uAddress));
    assert.equal(item?.providerId, 'http://media.example/ch');
    assert.equal(item?.kind, 'live');
    assert.equal(item?.title, 'Synthetic Channel');
});

test('downloads a linked URL playlist to resolve server favorites by exact URL hash', async () => {
    const playlist: Source = {
        ...source,
        provider: 'm3u',
        url: 'https://playlist.example/list.m3u',
    };
    const stream = 'https://media.example/channel';
    const ref = { ...address, content: await m3uFavoriteReference(stream) };
    const transport = new ProviderTransport('https://backend.example');
    transport.request = async (requested, route) => {
        assert.equal(requested.url, playlist.url);
        assert.equal(route, 'parse');
        return {
            playlist: { items: [{ url: stream, name: 'Synthetic channel' }] },
        };
    };
    const media = await resolveFavoriteEntries(
        playlist,
        [{ address: ref, state: { member: true, revision: 1 } }],
        transport
    );
    assert.equal(media.get(favoriteAddressKey(ref))?.providerId, stream);
});

test('round-trips regular and embedded Stalker series references', async () => {
    const portal: Source = { ...source, provider: 'stalker' };
    for (const mode of ['regular', 'embedded'] as const) {
        const content = {
            provider: 'stalker' as const,
            kind: 'series' as const,
            id: '7',
            mode,
        };
        const item = resolveFavoriteMedia(
            portal,
            { ...address, content },
            { episodes: [4, 5] }
        )!;
        assert.deepEqual(await mediaFavoriteReference(item, portal), content);
        if (mode === 'embedded')
            assert.deepEqual(
                mediaFavoriteSnapshot(
                    {
                        ...item,
                        raw: { ...item.raw, series: [4, '5', null, false, ''] },
                    },
                    content
                ).episodes,
                [4, 5]
            );
    }
});

test('shared Stalker playback resolves the exact provider row before using its command', async () => {
    const portal: Source = {
        ...source,
        provider: 'stalker',
        full: false,
        macAddress: '00:00:00:00:00:01',
        endpoint: 'https://portal.example/server/load.php',
    };
    const transport = new ProviderTransport('https://backend.example');
    const command = 'ffmpeg https://media.example/live';
    transport.request = async (_source, _route, params) => {
        assert.equal(params.action, 'get_all_channels');
        return {
            js: [
                {
                    id: '1',
                    name: 'Synthetic channel',
                    cmd: 'https://media.example/other',
                },
                {
                    id: '42',
                    name: 'Synthetic channel',
                    cmd: command,
                    use_http_tmp_link: 0,
                    wowza_tmp_link: 0,
                },
            ],
        };
    };
    const signal = new AbortController().signal;
    const provider = createProvider(portal, transport, async () => undefined);
    await provider.connect(signal);
    const item = resolveFavoriteMedia(
        portal,
        {
            ...address,
            content: { provider: 'stalker', kind: 'live', id: '42' },
        },
        { title: 'Synthetic channel' }
    )!;
    assert.equal(item.raw.cmd, undefined);
    assert.equal(
        (await provider.resolve(item, signal)).url,
        'https://media.example/live'
    );
    provider.dispose();
});

test('counts report members, pending and conflicts for the settings status', () => {
    const data = sharedData();
    const { data: queued } = queueFavorite(
        data,
        source,
        liveItem,
        true,
        context,
        address.content,
        data.favoritesConsent,
        data.favoritesDeviceId
    );
    assert.deepEqual(sharedFavoriteCounts(queued), {
        members: 1,
        pending: 1,
        conflicts: 0,
    });
});
