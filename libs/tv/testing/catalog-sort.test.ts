import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    hydrateUserData,
    initialData,
    sortCatalog,
    Source,
} from '@iptvnator/tv/util';
import { createProvider, ProviderTransport } from '@iptvnator/tv/data-access';
import { xtreamCatalogTimestamp } from '@iptvnator/portal/xtream/client';
const signal = new AbortController().signal;
class Transport extends ProviderTransport {
    calls: Record<string, string | number>[] = [];
    constructor(
        private respond: (params: Record<string, string | number>) => unknown
    ) {
        super('https://backend.invalid');
    }
    async request(
        _source: Source,
        _route: 'xtream' | 'stalker' | 'parse',
        params: Record<string, string | number>
    ) {
        this.calls.push(params);
        return this.respond(params);
    }
}
const source: Source = {
    id: 'sort',
    name: 'mock',
    provider: 'xtream',
    url: 'https://provider.invalid',
};
test('recency normalizes epochs and ISO dates without using release year or invalid future dates', () => {
    const expected = Date.parse('2025-10-02T00:00:00Z');
    for (const added of [
        expected,
        String(expected),
        expected / 1000,
        String(expected / 1000),
        '2025-10-02',
        '2025-10-02T00:00:00Z',
    ])
        assert.equal(xtreamCatalogTimestamp({ added }, false), expected);
    assert.equal(
        xtreamCatalogTimestamp(
            { added: '', last_modified: '2025-10-02' },
            true
        ),
        expected
    );
    assert.equal(
        xtreamCatalogTimestamp(
            { added: '2025-10-02', last_modified: '2025-10-03' },
            true
        ),
        expected
    );
    for (const raw of [
        { added: 'N/A' },
        { added: -1 },
        { added: Infinity },
        { added: '2099-01-01' },
        { year: '2026', releaseDate: '2025-10-02' },
    ])
        assert.equal(xtreamCatalogTimestamp(raw, false), 0);
});
test('catalog ties and missing dates preserve provider order without mutating source; old data defaults safely', () => {
    const items = [
        { title: 'Z' },
        { title: 'B', addedAt: 5 },
        { title: 'A', addedAt: 5 },
        { title: 'C' },
    ];
    assert.deepEqual(
        sortCatalog(items, 'recent').map((x) => x.title),
        ['B', 'A', 'Z', 'C']
    );
    assert.deepEqual(
        sortCatalog(items, 'title').map((x) => x.title),
        ['A', 'B', 'C', 'Z']
    );
    assert.equal(sortCatalog(items, 'provider'), items);
    assert.equal(items[0].title, 'Z');
    const { catalogSort: _oldMissing, ...legacy } = initialData();
    const hydrated = hydrateUserData(legacy);
    assert.deepEqual(hydrated.catalogSort, {
        movie: 'recent',
        series: 'recent',
    });
    assert.equal(hydrated.sources, legacy.sources);
    assert.deepEqual(
        hydrateUserData({
            ...legacy,
            catalogSort: { movie: 'title', series: 'invalid' } as never,
        }).catalogSort,
        { movie: 'title', series: 'recent' }
    );
});
test('Xtream sorts the whole catalog before slicing, keeps filters and never reorders live channels', async () => {
    const rows = Array.from({ length: 125 }, (_, i) => ({
        stream_id: i + 1,
        series_id: i + 1,
        name: `Title ${String(124 - i).padStart(3, '0')}`,
        added: String(1700000000 + i),
        category_id: i % 2 ? 'odd' : 'even',
        container_extension: 'mp4',
    }));
    const transport = new Transport((p) =>
        String(p.action).endsWith('categories') ? [] : rows
    );
    const provider = createProvider(source, transport, async () => undefined);
    for (const kind of ['movie', 'series'] as const) {
        const first = await provider.catalog(kind, '', 0, '', signal);
        const next = await provider.catalog(kind, '', 1, '', signal);
        assert.equal(first.items[0].providerId, '125');
        assert.equal(next.items[0].providerId, '65');
        assert.equal(
            new Set([...first.items, ...next.items].map((x) => x.id)).size,
            120
        );
        assert.equal(
            (await provider.catalog(kind, 'odd', 0, '', signal)).items[0]
                .providerId,
            '124'
        );
        assert.equal(
            (await provider.catalog(kind, '', 0, 'Title 01', signal, 'title'))
                .items[0].title,
            'Title 010'
        );
        assert.equal(
            (await provider.catalog(kind, '', 0, '', signal, 'provider'))
                .items[0].providerId,
            '1'
        );
    }
    assert.equal(
        (await provider.catalog('live', '', 0, '', signal)).items[0].providerId,
        '1'
    );
    provider.dispose();
});
test('Stalker sort is sent for every page and page cache cannot leak a previous order', async () => {
    const transport = new Transport((p) =>
        p.action === 'get_categories'
            ? { js: [] }
            : {
                  js: {
                      data: Array.from({ length: 14 }, (_, i) => ({
                          id: `${p.sortby}:${p.p}:${i}`,
                          name: 'Title',
                      })),
                      max_page_items: 14,
                      total_items: 100,
                  },
              }
    );
    const provider = createProvider(
        { ...source, provider: 'stalker', full: false, endpoint: source.url },
        transport,
        async () => undefined
    );
    for (const kind of ['movie', 'series'] as const) {
        await provider.catalog(kind, 'group', 0, 'query', signal, 'recent');
        const next = await provider.catalog(
            kind,
            'group',
            1,
            'query',
            signal,
            'recent'
        );
        assert.equal(next.items[0].providerId, 'added:2:0');
        assert.equal(
            (await provider.catalog(kind, 'group', 0, 'query', signal, 'title'))
                .items[0].providerId,
            'name:1:0'
        );
    }
    const lists = transport.calls.filter(
        (p) => p.action === 'get_ordered_list'
    );
    assert.ok(
        lists.every((p) => p.category === 'group' && p.search === 'query')
    );
    assert.ok(lists.some((p) => p.p === 2 && p.sortby === 'added'));
    provider.dispose();
});
test('Stalker catalogs use the first nonblank title across live, movies and series', async () => {
    const transport = new Transport((p) =>
        ['get_categories', 'get_genres'].includes(String(p.action))
            ? { js: [] }
            : {
                  js: {
                      data: [
                          { id: '1', o_name: '', name: 'Provider name' },
                          {
                              id: '2',
                              o_name: '   ',
                              name: '  ',
                              title: 'Fallback title',
                          },
                          {
                              id: '3',
                              o_name: 'Original title',
                              name: 'Translated title',
                          },
                      ],
                      max_page_items: 14,
                      total_items: 3,
                  },
              }
    );
    const provider = createProvider(
        { ...source, provider: 'stalker', full: false, endpoint: source.url },
        transport,
        async () => undefined
    );
    try {
        for (const kind of ['live', 'movie', 'series'] as const) {
            const result = await provider.catalog(kind, '', 0, '', signal);
            assert.deepEqual(
                result.items.map((item) => item.title),
                ['Provider name', 'Fallback title', 'Original title']
            );
        }
    } finally {
        provider.dispose();
    }
});
test('M3U without added metadata retains source order for recent and sorts titles across all pages', async () => {
    const transport = new Transport(() => ({
        playlist: {
            items: Array.from({ length: 70 }, (_, i) => ({
                name: `Title ${String(69 - i).padStart(2, '0')}`,
                url: `https://media.invalid/movie/${i}.mp4`,
            })),
        },
    }));
    const provider = createProvider(
        { ...source, provider: 'm3u' },
        transport,
        async () => undefined
    );
    await provider.connect(signal);
    assert.equal(
        (await provider.catalog('movie', '', 0, '', signal)).items[0].title,
        'Title 69'
    );
    assert.equal(
        (await provider.catalog('movie', '', 0, '', signal, 'title')).items[0]
            .title,
        'Title 00'
    );
    assert.equal(
        (await provider.catalog('movie', '', 1, '', signal, 'title')).items[0]
            .title,
        'Title 60'
    );
    provider.dispose();
});
