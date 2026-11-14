import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    commitFavoriteResult,
    disconnectLibrary,
    favoriteItems,
    isSharedFavorite,
    mergeFavoriteSource,
    pendingFavorites,
    queueFavorite,
    resolveFavoriteEntries,
    resolveFavoriteConflict,
    sharedFavoriteMedia,
} from '@iptvnator/tv/data-access';
import {
    applyFavoriteOperation,
    favoriteAddressKey,
    type FavoriteAddress,
    type FavoriteSourceContext,
} from '@iptvnator/shared/interfaces/favorites-sync';
import {
    identity,
    initialData,
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
    assert.equal(entry.record.pending[0].consentGeneration, 'consent-1');
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
    const committed = commitFavoriteResult(
        queued,
        key,
        head.operation.operationId,
        {
            status: 'applied',
            state: {
                revision: 1,
                member: true,
                snapshot: { title: 'Synthetic Channel' },
            },
        }
    );
    const record = committed.sharedFavorites[key].record;
    assert.equal(record.pending.length, 0);
    assert.deepEqual(record.base, record.state);
    assert.equal(record.state.member, true);
});

test('a divergent server receipt waits for an explicit choice', () => {
    const data = sharedData();
    const { data: queued, entry } = queueFavorite(
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
    const original = entry.record.pending[0].operation;
    const server = { revision: 2, member: false };
    const result = commitFavoriteResult(queued, key, original.operationId, {
        status: 'conflict',
        state: server,
    });
    assert.deepEqual(pendingFavorites(result), []);
    assert.deepEqual(result.sharedFavorites[key].record.conflict, server);
    assert.equal(
        favoriteItems(resolveFavoriteConflict(result, key, false)).length,
        0
    );
    const confirmed = resolveFavoriteConflict(result, key, true);
    const operation =
        pendingFavorites(confirmed)[0].entry.record.pending[0].operation;
    assert.notEqual(operation.operationId, original.operationId);
    assert.equal(operation.expectedRevision, server.revision);
    assert.equal(applyFavoriteOperation(server, operation).status, 'applied');
});

test('an import add preserves a newer server removal', () => {
    const data = sharedData();
    const { data: queued, entry } = queueFavorite(
        data,
        source,
        liveItem,
        true,
        context,
        address.content,
        data.favoritesConsent,
        data.favoritesDeviceId,
        true
    );
    const operation = entry.record.pending[0].operation;
    const key = favoriteAddressKey(address);
    const result = commitFavoriteResult(queued, key, operation.operationId, {
        status: 'conflict',
        state: { member: false, revision: 2 },
    });
    assert.deepEqual(pendingFavorites(result), []);
    assert.deepEqual(favoriteItems(result), []);
});

test('a conflict receipt lets the next queued edit reach the server', () => {
    const key = favoriteAddressKey(address);
    const data = sharedData();
    const queue = (current: UserData, member: boolean) =>
        queueFavorite(
            current,
            source,
            liveItem,
            member,
            context,
            address.content,
            data.favoritesConsent,
            data.favoritesDeviceId
        ).data;
    const queued = queue(queue(data, true), false);
    const [add, remove] = queued.sharedFavorites[key].record.pending;
    const server = { revision: 1, member: false };
    const result = commitFavoriteResult(
        queued,
        key,
        add.operation.operationId,
        applyFavoriteOperation(server, add.operation)
    );
    const row = result.sharedFavorites[key].record;
    assert.equal(
        row.pending[0].operation.operationId,
        remove.operation.operationId
    );
    assert.equal(row.state.member, false);
    assert.equal(
        applyFavoriteOperation(server, row.pending[0].operation).status,
        'applied'
    );
});

test('shared membership overrides the local copy and becomes inert when the source is unlinked', () => {
    const data = sharedData({ favorites: [liveItem] });
    const added = queueFavorite(
        data,
        source,
        liveItem,
        true,
        context,
        address.content,
        data.favoritesConsent,
        data.favoritesDeviceId
    ).data;
    const removed = queueFavorite(
        added,
        source,
        liveItem,
        false,
        context,
        address.content,
        data.favoritesConsent,
        data.favoritesDeviceId
    ).data;
    assert.deepEqual(favoriteItems(removed), []);
    assert.deepEqual(removed.favorites, [liveItem]);
    const disconnected = disconnectLibrary(added);
    assert.deepEqual(disconnected.favorites, [liveItem]);
    assert.deepEqual(favoriteItems(disconnectLibrary(removed)), []);
    for (const changed of [
        disconnected,
        { ...added, library: { ...added.library!, instanceId: 'other' } },
        {
            ...added,
            sharedFavoriteContexts: {
                [context.sourceId]: { ...context, sourceIncarnation: 'other' },
            },
        },
    ]) {
        assert.deepEqual(sharedFavoriteMedia(changed), []);
        assert.deepEqual(pendingFavorites(changed), []);
        assert.deepEqual(favoriteItems(changed), [liveItem]);
    }
});

test('mergeFavoriteSource creates member rows with resolved items and keeps pending bases', async () => {
    const data = sharedData();
    const entries = [
        {
            address,
            state: {
                revision: 7,
                member: true,
                snapshot: { title: 'Synthetic Channel' },
            },
        },
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

test('new consent edits stay deliverable after an expired head', async () => {
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
    assert.equal(queued.sharedFavorites[key].record.pending.length, 1);
    assert.equal(
        queued.sharedFavorites[key].record.pending[0].operation
            .expectedRevision,
        0
    );
    const merged = mergeFavoriteSource(queued, source, context, [], new Map());
    const row = merged.sharedFavorites[key].record;
    assert.equal(row.pending.length, 1);
    assert.equal(row.pending[0].consentGeneration, 'consent-1');
    assert.equal(pendingFavorites(merged).length, 1);
});
