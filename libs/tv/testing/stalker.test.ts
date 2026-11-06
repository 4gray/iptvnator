import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Source, Media, identity } from '@iptvnator/tv/util';
import {
    ProviderTransport,
    ProviderRequestError,
    createProvider,
} from '@iptvnator/tv/data-access';
import { StalkerPagedCatalog } from '@iptvnator/portal/stalker/client';
import { StalkerSession } from '@iptvnator/tv/data-access';
import { stalkerEpisodes } from '@iptvnator/tv/data-access';
class Transport extends ProviderTransport {
    calls: string[] = [];
    invalid = false;
    constructor(
        private respond: (params: Record<string, string | number>) => unknown
    ) {
        super('https://backend.invalid');
    }
    async request(
        _source: Source,
        _route: 'stalker' | 'xtream' | 'parse',
        params: Record<string, string | number>
    ) {
        this.calls.push(String(params.action));
        return this.respond(params);
    }
}
const source = (): Source => ({
    id: 's',
    provider: 'stalker',
    name: 'mock',
    url: 'https://portal.invalid/server/load.php',
    endpoint: 'https://portal.invalid/server/load.php',
    macAddress: '00:1A:79:00:00:01',
    full: true,
    token: 'persisted',
});
const parent: Media = {
    id: 'parent',
    sourceId: 's',
    providerId: '100',
    kind: 'series',
    title: 'Show',
    raw: { origin: 'series' },
};
for (const legacy of [false, true]) {
    test(`lazy episode resolves its real file and preserves identity (legacy progress: ${legacy})`, async () => {
        const s = source();
        const calls: Record<string, string | number>[] = [];
        const transport = new Transport((params) => {
            calls.push(params);
            if (params.action === 'create_link')
                return { js: { cmd: 'https://cdn.invalid/right.mp4' } };
            return {
                js: {
                    data: params.episode_id
                        ? [
                              {
                                  id: '900',
                                  is_file: true,
                                  video_id: '100',
                                  series_id: '101',
                                  protocol: 'custom',
                                  cmd: 'https://cdn.invalid/right.mp4',
                              },
                          ]
                        : params.season_id
                          ? [
                                {
                                    id: '101',
                                    is_episode: true,
                                    series_number: '1',
                                },
                            ]
                          : [
                                {
                                    id: '11',
                                    video_id: '100',
                                    is_season: true,
                                    season_number: '1',
                                },
                            ],
                },
            };
        });
        const provider = createProvider(s, transport, async () => undefined);
        const show = {
            ...parent,
            id: identity(s, 'series', 'movie:100'),
            raw: { origin: 'vod', is_series: true },
        };
        const signal = new AbortController().signal;
        try {
            const [episode] = await provider.episodes(show, signal);
            const originalId = episode.id;
            if (legacy)
                episode.raw = { cmd: '/media/file_101.mpg', origin: 'vod' };
            const resolved = await provider.resolve(episode, signal);
            assert.equal(resolved.url, 'https://cdn.invalid/right.mp4');
            assert.equal(
                calls.find((call) => call.action === 'create_link')?.cmd,
                '/media/file_900.mpg'
            );
            const lookup = calls.find((call) => call.episode_id);
            assert.equal(lookup?.movie_id, '100');
            assert.equal(lookup?.season_id, '11');
            assert.equal(lookup?.episode_id, '101');
            assert.equal(episode.id, originalId);
        } finally {
            provider.dispose();
        }
    });
}
test('full portal reuses persisted token and repairs expired auth once for concurrent requests', async () => {
    let expired = false;
    let handshakes = 0;
    let saved = 0;
    const transport = new Transport((params) => {
        if (params.action === 'handshake') {
            handshakes++;
            return {
                js: {
                    token: handshakes === 1 ? 'persisted' : 'repaired',
                    random: 'random',
                },
            };
        }
        if (params.action === 'get_profile')
            return { js: { id: 1, status: 0 } };
        return expired && params.token !== 'repaired'
            ? 'Authorization failed.'
            : { js: [] };
    });
    const session = new StalkerSession(source(), transport, async () => {
        saved++;
    });
    try {
        await session.discover(new AbortController().signal);
        assert.equal(transport.calls.includes('get_profile'), false);
        expired = true;
        await Promise.all([
            session.request(
                { action: 'get_categories' },
                new AbortController().signal
            ),
            session.request(
                { action: 'get_categories' },
                new AbortController().signal
            ),
        ]);
        assert.equal(handshakes, 2);
        assert.equal(saved, 2);
    } finally {
        session.dispose();
    }
});
test('simple portal mode is observed from data, independent of URL shape', async () => {
    const configuration = { ...source(), full: undefined, endpoint: undefined };
    const transport = new Transport(() => ({
        js: [{ id: '1', title: 'News' }],
    }));
    const session = new StalkerSession(
        configuration,
        transport,
        async () => undefined
    );
    try {
        await session.discover(new AbortController().signal);
        assert.equal(configuration.full, false);
        assert.equal(transport.calls.includes('handshake'), false);
    } finally {
        session.dispose();
    }
});
test('regular and embedded series retain commands and episode numbers', async () => {
    const transport = new Transport(() => ({
        js: [
            {
                id: 'season',
                name: 'Season 1',
                cmd: 'ffrt http://cdn.invalid/show',
                series: [1, 2],
            },
        ],
    }));
    const session = new StalkerSession(
        source(),
        transport,
        async () => undefined
    );
    try {
        const regular = await stalkerEpisodes(
            session,
            source(),
            parent,
            new AbortController().signal
        );
        assert.equal(regular.length, 2);
        assert.equal(regular[1].episode, 2);
        assert.equal(regular[1].seriesTitle, parent.title);
        assert.equal(regular[1].raw.cmd, 'ffrt http://cdn.invalid/show');
        const embedded = await stalkerEpisodes(
            session,
            source(),
            {
                ...parent,
                raw: {
                    origin: 'vod',
                    series: [4, 5],
                    cmd: 'http://cdn.invalid/embedded',
                },
            },
            new AbortController().signal
        );
        assert.equal(embedded[0].episode, 4);
        assert.equal(embedded[0].seriesTitle, parent.title);
        assert.equal(embedded[0].raw.series, 4);
    } finally {
        session.dispose();
    }
});
test('lazy Ministra episodes preserve parent-scoped IDs and provider lookup coordinates', async () => {
    const transport = new Transport((params) =>
        params.season_id
            ? {
                  js: {
                      data: [
                          {
                              id: 'file',
                              is_episode: true,
                              series_number: '3',
                              name: 'Third',
                          },
                      ],
                  },
              }
            : {
                  js: {
                      data: [
                          {
                              id: 'season',
                              video_id: '100',
                              name: 'Season 2',
                              season_number: '2',
                              is_season: true,
                          },
                      ],
                  },
              }
    );
    const session = new StalkerSession(
        source(),
        transport,
        async () => undefined
    );
    try {
        const lazy = {
            ...parent,
            raw: { origin: 'vod', is_series: '1', series: [] },
        };
        const one = await stalkerEpisodes(
            session,
            source(),
            lazy,
            new AbortController().signal
        );
        const two = await stalkerEpisodes(
            session,
            source(),
            { ...lazy, providerId: '200', id: 'other' },
            new AbortController().signal
        );
        assert.equal(one[0].episode, 3);
        assert.equal(one[0].season, 2);
        assert.equal(one[0].raw.cmd, undefined);
        assert.deepEqual(one[0].raw.lazyEpisode, {
            originalCmd: undefined,
            custom_sid: 'vod-series',
            vodEpisode: {
                movieId: '100',
                seasonId: 'season',
                episodeId: 'file',
            },
        });
        assert.notEqual(one[0].id, two[0].id);
    } finally {
        session.dispose();
    }
});
test('oversized provider pages remain bounded without losing rows across a server page boundary', async () => {
    const catalog = new StalkerPagedCatalog(async (params) => ({
        js: {
            data: Array.from({ length: 250 }, (_, id) => ({ id })).slice(
                (Number(params.p) - 1) * 100,
                Number(params.p) * 100
            ),
            total_items: 250,
            max_page_items: 100,
        },
    }));
    const first = await catalog.load(
        { type: 'vod' },
        0,
        new AbortController().signal
    );
    const second = await catalog.load(
        { type: 'vod' },
        1,
        new AbortController().signal
    );
    assert.equal(first.data.length, 60);
    assert.equal(second.data.length, 60);
    assert.equal(second.data[0].id, 60);
    assert.equal(second.data[59].id, 119);
    assert.equal(
        (await catalog.load({ type: 'vod' }, 4, new AbortController().signal))
            .data.length,
        10
    );
});
test('an upstream HTTP auth failure repairs the session with the same policy as a plain-text failure', async () => {
    let handshakes = 0;
    const transport = new Transport((params) => {
        if (params.action === 'handshake')
            return {
                js: { token: ++handshakes === 1 ? 'persisted' : 'repaired' },
            };
        if (params.action === 'get_profile') return { js: { status: 0 } };
        if (params.token === 'persisted')
            throw new ProviderRequestError(401, true);
        return { js: [] };
    });
    const session = new StalkerSession(
        source(),
        transport,
        async () => undefined
    );
    try {
        await session.discover(new AbortController().signal);
        await session.request(
            { action: 'get_categories' },
            new AbortController().signal
        );
        assert.equal(handshakes, 2);
    } finally {
        session.dispose();
    }
});
test('an existing MAC identity is validated without rewriting its stored bytes', async () => {
    const configuration = {
        ...source(),
        full: false,
        macAddress: '00:1a:79:00:00:01',
    };
    const session = new StalkerSession(
        configuration,
        new Transport(() => ({ js: [] })),
        async () => undefined
    );
    try {
        await session.discover(new AbortController().signal);
        assert.equal(configuration.macAddress, '00:1a:79:00:00:01');
    } finally {
        session.dispose();
    }
});
