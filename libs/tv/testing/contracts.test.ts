import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    identity,
    initialData,
    recordProgress,
    removeSourceData,
    hydrateUserData,
    LatestRequest,
    Source,
} from '@iptvnator/tv/util';
import {
    UserDataRepository,
    createProvider,
    ProviderTransport,
} from '@iptvnator/tv/data-access';
import {
    XtreamClient,
    resolveXtreamVodPlaybackSource,
} from '@iptvnator/portal/xtream/client';
const source: Source = {
    id: 'a',
    provider: 'xtream',
    name: 'test',
    url: 'https://provider.invalid/player_api.php?username=user',
    username: 'u /',
    password: 'p&',
};
test('source/type identities never collide, even with separators', () => {
    assert.notEqual(identity(source, 'live', 1), identity(source, 'movie', 1));
    assert.notEqual(
        identity(source, 'movie', 1),
        identity({ ...source, id: 'b' }, 'movie', 1)
    );
    assert.notEqual(
        identity(source, 'episode', 'a:b'),
        identity({ ...source, id: 'a:episode' }, 'episode', 'b')
    );
});
test('latest-selection ownership rejects aborted and late responses', () => {
    const lane = new LatestRequest();
    const first = lane.start();
    const second = lane.start();
    assert.equal(first.signal.aborted, true);
    assert.equal(lane.owns(first), false);
    assert.equal(lane.owns(second), true);
    lane.cancel();
    assert.equal(lane.owns(second), false);
});
test('writes serialize and rejected transactions never become successful in-memory data', async () => {
    let fail = false;
    const writes: string[] = [];
    const repository = new UserDataRepository(
        {
            read: async () => initialData(),
            write: async (data) => {
                await Promise.resolve();
                if (fail) throw new Error('quota');
                writes.push(data.activeId);
            },
        },
        () => undefined
    );
    await repository.load();
    await Promise.all([
        repository.update((d) => ({ ...d, activeId: 'one' })),
        repository.update((d) => ({ ...d, backend: d.activeId })),
    ]);
    assert.equal(repository.data.backend, 'one');
    assert.equal(writes.length, 2);
    fail = true;
    await assert.rejects(
        repository.update((d) => ({ ...d, activeId: 'lost' }))
    );
    assert.equal(repository.data.activeId, 'one');
    fail = false;
    await repository.update((d) => ({ ...d, activeId: 'recovered' }));
    assert.equal(repository.data.activeId, 'recovered');
});
test('Xtream stream construction and complete source candidates preserve credential encoding', async () => {
    const client = new XtreamClient(source, async (params) =>
        params.action === 'get_account_info'
            ? {
                  user_info: { auth: 1, status: 'Active' },
                  server_info: { timezone: 'UTC' },
              }
            : {}
    );
    await client.account(new AbortController().signal);
    assert.equal(client.timezone, 'UTC');
    assert.equal(
        client.stream('movie', 1, 'mp4'),
        'https://provider.invalid/movie/u%20%2F/p%26/1.mp4'
    );
    assert.throws(() => client.stream('movie', 0, 'mp4'));
    assert.equal(
        resolveXtreamVodPlaybackSource({
            movie_data: { stream_id: 1 },
            container_extension: 'mp4',
        } as Parameters<typeof resolveXtreamVodPlaybackSource>[0]),
        null
    );
});
test('extracted EPG normalization accepts object rows, Unicode base64 and provider-local time', () => {
    const client = new XtreamClient(source, async () => ({}));
    const result = client.normalizeShortEpgItems(
        {
            epg_listings: {
                one: {
                    title: Buffer.from('Привет').toString('base64'),
                    start: '2026-10-21 20:00:00',
                    end: '2026-10-21 21:00:00',
                },
            },
        },
        'UTC+03:00'
    );
    assert.equal(result[0].title, 'Привет');
    assert.equal(result[0].start, '2026-10-21T17:00:00.000Z');
});
test('Xtream plays a complete catalog pair without waiting for unavailable detail metadata', async () => {
    let requests = 0;
    class Unavailable extends ProviderTransport {
        async request(): Promise<never> {
            requests++;
            throw new Error('offline');
        }
    }
    const provider = createProvider(
        source,
        new Unavailable('https://backend.invalid'),
        async () => undefined
    );
    const item = {
        id: 'movie',
        sourceId: source.id,
        providerId: '123',
        kind: 'movie' as const,
        title: 'Movie',
        raw: { stream_id: 123, container_extension: 'mp4' },
    };
    const result = await provider.resolve(item, new AbortController().signal);
    assert.ok(result.url.endsWith('/123.mp4'));
    assert.equal(requests, 0);
});
test('positions outlive the recent-history limit and source removal clears only owned data', async () => {
    let data = initialData();
    for (let id = 0; id < 205; id++) {
        const item = {
            id: String(id),
            sourceId: id === 204 ? 'b' : 'a',
            providerId: String(id),
            kind: 'movie' as const,
            title: 'Movie',
            raw: {},
        };
        data = recordProgress(data, {
            item,
            seconds: 8,
            duration: 30,
            updated: id,
        });
    }
    assert.equal(data.history.length, 200);
    assert.equal(data.positions['0'].seconds, 8);
    const removed = removeSourceData(data, 'a');
    assert.equal(Object.keys(removed.positions).length, 1);
    assert.ok(removed.positions['204']);
    assert.ok(data.positions['0']);
});
test('additive TV data reads recover historical positions without mutating the old snapshot', async () => {
    const item = {
        id: 'old',
        sourceId: 'a',
        providerId: '1',
        kind: 'movie' as const,
        title: 'Movie',
        raw: {},
    };
    const old = { history: [{ item, seconds: 5, duration: 30, updated: 1 }] };
    const data = hydrateUserData(old);
    assert.equal(data.positions.old.seconds, 5);
    assert.equal('positions' in old, false);
});
