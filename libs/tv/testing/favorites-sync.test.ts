import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    commitFavoriteResult,
    isSharedFavorite,
    mediaFavoriteReference,
    mediaFavoriteSnapshot,
    mergeFavoriteSource,
    pendingFavorites,
    queueFavorite,
    resolveFavoriteEntries,
    resolveFavoriteMedia,
    serverMemberKeys,
    sharedFavoriteCounts,
    sharedFavoriteMedia,
} from '@iptvnator/tv/data-access';
import {
    emptyFavoriteState,
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

test('queueFavorite writes an optimistic member row with a pending intent, local favorites untouched', () => {
    const data = sharedData({ favorites: [liveItem] });
    const { data: next, entry } = queueFavorite(
        data,
        source,
        liveItem,
        true,
        context,
        address.content,
        data.favoritesConsent,
        data.favoritesDeviceId
    );
    const key = favoriteAddressKey(address);
    assert.equal(entry.record.state.member, true);
    assert.equal(entry.record.state.revision, 1);
    assert.equal(entry.record.pending.length, 1);
    assert.equal(
        entry.record.pending[0].consentGeneration,
        'consent-1'
    );
    assert.equal(next.sharedFavorites[key], entry);
    assert.deepEqual(next.favorites, data.favorites);
    assert.equal(pendingFavorites(next).length, 1);
});

test('pending intents under an old consent generation are not deliverable', () => {
    const data = sharedData();
    const { data: queued } = queueFavorite(
        data,
        source,
        liveItem,
        true,
        context,
        address.content,
        'consent-old',
        'tv-1'
    );
    assert.equal(pendingFavorites(queued).length, 0);
    const reconsented = { ...queued, favoritesConsent: 'consent-old' };
    assert.equal(pendingFavorites(reconsented).length, 1);
});

test('applied receipts drain the outbox and commit base state', () => {
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
    const key = favoriteAddressKey(address);
    const head = queued.sharedFavorites[key].record.pending[0];
    const { data: committed, delivered } = commitFavoriteResult(
        queued,
        key,
        head.operation.operationId,
        {
            status: 'applied',
            state: { revision: 1, member: true, snapshot: { title: 'Synthetic Channel' } },
        }
    );
    assert.equal(delivered, true);
    const record = committed.sharedFavorites[key].record;
    assert.equal(record.pending.length, 0);
    assert.deepEqual(record.base, record.state);
    assert.equal(record.state.member, true);
});

test('conflicts rebase the head intent twice, then the server state wins', () => {
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
    const key = favoriteAddressKey(address);
    let current = queued;
    for (let attempt = 1; attempt <= 2; attempt++) {
        const head = current.sharedFavorites[key].record.pending[0];
        const conflict = { revision: attempt, member: false };
        const result = commitFavoriteResult(current, key, head.operation.operationId, {
            status: 'conflict',
            state: conflict,
        });
        assert.equal(result.rebased, true);
        current = result.data;
        const record = current.sharedFavorites[key].record;
        assert.equal(record.pending.length, 1);
        assert.equal(record.pending[0].operation.expectedRevision, attempt);
        assert.equal(record.base.revision, attempt);
        assert.equal(record.state.member, true);
    }
    const head = current.sharedFavorites[key].record.pending[0];
    const final = commitFavoriteResult(current, key, head.operation.operationId, {
        status: 'conflict',
        state: { revision: 3, member: false },
    });
    assert.equal(final.rebased, false);
    const record = final.data.sharedFavorites[key].record;
    assert.equal(record.pending.length, 0);
    assert.equal(record.state.member, false);
    assert.equal(record.state.revision, 3);
});

test('a conflict matching the intent is adopted instead of retried', () => {
    const data = sharedData();
    const { data: queued } = queueFavorite(
        data,
        source,
        liveItem,
        false,
        context,
        address.content,
        data.favoritesConsent,
        data.favoritesDeviceId
    );
    const key = favoriteAddressKey(address);
    const head = queued.sharedFavorites[key].record.pending[0];
    const { data: committed, delivered } = commitFavoriteResult(
        queued,
        key,
        head.operation.operationId,
        { status: 'conflict', state: { revision: 5, member: false } }
    );
    assert.equal(delivered, true);
    assert.equal(committed.sharedFavorites[key].record.pending.length, 0);
});

test('mergeFavoriteSource creates member rows with resolved items and keeps pending bases', async () => {
    const data = sharedData();
    const entries = [
        { address, state: { revision: 7, member: true, snapshot: { title: 'Synthetic Channel' } } },
    ];
    const media = await resolveFavoriteEntries(source, entries);
    const merged = mergeFavoriteSource(data, source, context, entries, media);
    const row = merged.sharedFavorites[favoriteAddressKey(address)];
    assert.equal(row.record.state.member, true);
    assert.equal(row.record.base.revision, 7);
    assert.equal(row.media?.id, liveItem.id);
    assert.equal(row.media?.sourceId, 'tv-src-1');
    assert.equal(sharedFavoriteMedia(merged).length, 1);
    assert.equal(isSharedFavorite(merged, liveItem), true);
    // Refreshing the same revision twice does not duplicate or regress.
    const again = mergeFavoriteSource(merged, source, context, entries, media);
    assert.equal(Object.keys(again.sharedFavorites).length, 1);
});

test('mergeFavoriteSource rejects foreign scope and mismatched context', async () => {
    const data = sharedData();
    const foreign = [
        {
            address: { ...address, instanceId: 'other-instance' },
            state: { revision: 1, member: true },
        },
    ];
    await assert.rejects(
        resolveFavoriteEntries(source, foreign).then((media) =>
            mergeFavoriteSource(data, source, context, foreign, media)
        )
    );
    const wrongIncarnation = [
        {
            address: { ...address, sourceIncarnation: 'inc-2' },
            state: { revision: 1, member: true },
        },
    ];
    await assert.rejects(
        resolveFavoriteEntries(source, wrongIncarnation).then((media) =>
            mergeFavoriteSource(data, source, context, wrongIncarnation, media)
        )
    );
});

test('mergeFavoriteSource reverts undeliverable intents instead of keeping phantom rows', async () => {
    const data = sharedData();
    const { data: queued } = queueFavorite(
        data,
        source,
        liveItem,
        true,
        context,
        address.content,
        'consent-old',
        'tv-1'
    );
    const key = favoriteAddressKey(address);
    assert.equal(queued.sharedFavorites[key].record.state.member, true);
    const merged = mergeFavoriteSource(queued, source, context, [], new Map());
    const row = merged.sharedFavorites[key].record;
    assert.equal(row.pending.length, 0);
    assert.equal(row.state.member, false);
    assert.equal(sharedFavoriteMedia(merged).length, 0);
});

test('mergeFavoriteSource keeps live intents deliverable behind dead heads', async () => {
    const data = sharedData();
    const { data: dead } = queueFavorite(
        data,
        source,
        liveItem,
        true,
        context,
        address.content,
        'consent-old',
        'tv-1'
    );
    const { data: queued } = queueFavorite(
        dead,
        source,
        liveItem,
        false,
        context,
        address.content,
        'consent-1',
        'tv-1'
    );
    const key = favoriteAddressKey(address);
    assert.equal(queued.sharedFavorites[key].record.pending.length, 2);
    const merged = mergeFavoriteSource(queued, source, context, [], new Map());
    const row = merged.sharedFavorites[key].record;
    assert.equal(row.pending.length, 1);
    assert.equal(row.pending[0].consentGeneration, 'consent-1');
    assert.equal(pendingFavorites(merged).length, 1);
});

test('serverMemberKeys dedupes only member entries by reference', () => {
    const keys = serverMemberKeys([
        { address, state: { revision: 1, member: true } },
        {
            address: {
                ...address,
                content: { provider: 'xtream', kind: 'movie', id: '7' },
            },
            state: { revision: 1, member: false },
        },
    ]);
    assert.equal(keys.size, 1);
    assert(
        keys.has(
            JSON.stringify({ provider: 'xtream', kind: 'live', id: '42' })
        )
    );
});

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
