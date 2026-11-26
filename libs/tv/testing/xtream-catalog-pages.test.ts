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

function provider(initialCategories = categories) {
    const actions: string[] = [];
    const reads = { title: 0, artwork: 0 };
    let currentCategories = initialCategories;
    const movies = rows.map((row) => ({
        ...row,
        get name() {
            reads.title++;
            return row.name;
        },
        get stream_icon() {
            reads.artwork++;
            return undefined;
        },
    }));
    class Transport extends ProviderTransport {
        async request(
            _source: Source,
            _route: 'xtream' | 'stalker' | 'parse',
            params: Record<string, string | number>
        ) {
            actions.push(String(params.action));
            if (params.action === 'get_vod_streams') return movies;
            if (params.action === 'get_vod_categories')
                return currentCategories;
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
        reads,
        setCategories(next: typeof categories) {
            currentCategories = next;
        },
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

test('Xtream catalog pages reuse the row order and expand only the requested page', async () => {
    const { client, actions, reads } = provider();
    const signal = new AbortController().signal;
    const first = await client.catalog('movie', '', 0, '', signal, 'title');
    assert.equal(reads.artwork, 60, 'only page one reads artwork');
    reads.title = 0;
    const second = await client.catalog('movie', '', 1, '', signal, 'title');
    assert.equal(reads.artwork, 120);
    assert.equal(reads.title, 60, 'page two reads titles only for its items');
    assert.notEqual(second.items[0].id, first.items[0].id);
    assert.equal(
        actions.filter((a) => a === 'get_vod_streams').length,
        1,
        'the provider list is fetched once'
    );
    const resorted = await client.catalog('movie', '', 0, '', signal, 'recent');
    assert.equal(resorted.items[0].title, rows[rows.length - 1].name);
});

test('Xtream catalog pages use the latest category names on cached rows', async () => {
    const { client, reads, setCategories } = provider([
        { category_id: '1', category_name: 'A,2B' },
        { category_id: '2', category_name: 'C' },
    ]);
    const signal = new AbortController().signal;
    const first = await client.catalog('movie', '1', 0, '', signal);
    assert.equal(first.items[0].categoryName, 'A,2B');

    setCategories([
        { category_id: '1', category_name: 'A' },
        { category_id: '2', category_name: 'B,2C' },
    ]);
    reads.title = 0;
    const second = await client.catalog('movie', '1', 1, '', signal);
    assert.equal(second.items[0].categoryName, 'A');
    assert.equal(reads.title, second.items.length);
});

test('Xtream catalog order reuse can be turned off', async () => {
    const previousWindow = globalThis.window;
    Object.assign(globalThis, {
        window: {
            localStorage: {
                getItem: (key: string) =>
                    key === 'iptvnator.tv.disableXtreamCatalogOrderCache'
                        ? '1'
                        : null,
            },
        },
    });
    try {
        const { client, reads } = provider();
        const signal = new AbortController().signal;
        await client.catalog('movie', '', 0, '', signal);
        reads.title = 0;
        await client.catalog('movie', '', 1, '', signal);
        assert.ok(
            reads.title >= rows.length,
            'page two rebuilds the row order'
        );
    } finally {
        Object.assign(globalThis, { window: previousWindow });
    }
});
