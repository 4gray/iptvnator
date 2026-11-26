import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProvider, ProviderTransport } from '@iptvnator/tv/data-access';
import type { Source } from '@iptvnator/tv/util';

const source: Source = {
    id: 'xtream',
    provider: 'xtream',
    name: 'Test',
    url: 'https://provider.invalid',
    username: 'user',
    password: 'password',
};
// 150 synthetic movies in two categories, added one day apart, titles out of order.
const rows = Array.from({ length: 150 }, (_, i) => ({
    stream_id: i + 1,
    name: `Movie ${String((i * 37) % 150).padStart(3, '0')}`,
    category_id: i % 2 ? '2' : '1',
    added: String(1700000000 + i * 86400),
}));
const categories = [
    { category_id: '1', category_name: 'One' },
    { category_id: '2', category_name: 'Two' },
];

function provider() {
    const actions: string[] = [];
    class Transport extends ProviderTransport {
        async request(
            _source: Source,
            _route: 'xtream' | 'stalker' | 'parse',
            params: Record<string, string | number>
        ) {
            actions.push(String(params.action));
            if (params.action === 'get_vod_streams') return rows;
            if (params.action === 'get_vod_categories') return categories;
            return [];
        }
    }
    return {
        client: createProvider(
            source,
            new Transport('https://backend.invalid'),
            async () => undefined
        ),
        actions,
    };
}

async function allPages(
    client: ReturnType<typeof provider>['client'],
    category: string,
    query: string,
    sort: 'title' | 'recent'
) {
    const signal = new AbortController().signal;
    const titles: string[] = [];
    for (let page = 0; ; page++) {
        const result = await client.catalog(
            'movie',
            category,
            page,
            query,
            signal,
            sort
        );
        titles.push(...result.items.map((m) => m.title));
        if ((page + 1) * 60 >= result.total)
            return { titles, total: result.total };
    }
}

test('Xtream catalog pages together give the whole sorted, filtered list', async () => {
    const { client } = provider();
    const byTitle = await allPages(client, '', '', 'title');
    assert.equal(byTitle.total, 150);
    assert.deepEqual(byTitle.titles, [...byTitle.titles].sort());
    assert.equal(new Set(byTitle.titles).size, 150);

    const recent = await allPages(client, '', '', 'recent');
    assert.deepEqual(
        recent.titles,
        rows.map((r) => r.name).reverse(),
        'newest first'
    );

    const two = await allPages(client, '2', '', 'title');
    assert.equal(two.total, 75);
    const query = await allPages(client, '', 'Movie 01', 'title');
    assert.deepEqual(
        query.titles,
        rows
            .map((r) => r.name)
            .filter((t) => t.startsWith('Movie 01'))
            .sort()
    );
});

test('Xtream catalog pages reuse one sorted list until the view changes', async () => {
    const { client, actions } = provider();
    const signal = new AbortController().signal;
    const first = await client.catalog('movie', '', 0, '', signal, 'title');
    const second = await client.catalog('movie', '', 1, '', signal, 'title');
    const again = await client.catalog('movie', '', 0, '', signal, 'title');
    // Same Media objects: the list was not rebuilt for the next page.
    assert.equal(again.items[0], first.items[0]);
    assert.notEqual(second.items[0], first.items[0]);
    assert.equal(
        actions.filter((a) => a === 'get_vod_streams').length,
        1,
        'the provider list is fetched once'
    );
    const resorted = await client.catalog('movie', '', 0, '', signal, 'recent');
    assert.notEqual(resorted.items[0], first.items[0]);
    assert.equal(resorted.items[0].title, rows[rows.length - 1].name);
});
