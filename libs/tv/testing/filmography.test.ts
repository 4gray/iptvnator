import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findFilmographyTitle } from '@iptvnator/tv/data-access';
import type { ActorFilmographyCredit } from '@iptvnator/shared/tmdb';
import type { Media, ProviderClient } from '@iptvnator/tv/util';

const credit: ActorFilmographyCredit = {
    tmdbId: 700,
    mediaType: 'movie',
    title: 'The Film',
    year: 2020,
    posterUrl: null,
    character: null,
    crewJob: null,
};
const item = (id: string, extra: Partial<Media> = {}): Media => ({
    id,
    providerId: `provider-${id}`,
    sourceId: 'source',
    kind: 'movie',
    title: 'The Film',
    year: '2020',
    raw: { cmd: 'unchanged-provider-command' },
    ...extra,
});
function provider(catalog: ProviderClient['catalog']): ProviderClient {
    return {
        catalog,
        capabilities: { movies: true, series: true, live: false, epg: false },
        connect: async () => ({
            id: 'source',
            provider: 'xtream',
            name: 'Fixture',
            url: 'https://fixture.invalid',
        }),
        details: async (item) => item,
        episodes: async () => [],
        epg: async () => [],
        resolve: async () => {
            throw new Error('Search must not play.');
        },
        dispose: () => undefined,
    };
}
const signal = () => new AbortController().signal;
test('matching versions across localized/original queries and series catalogs are combined before selection', async () => {
    const versions = [item('localized'), item('original')];
    const client = provider(async (_kind, _category, page, query) => ({
        items: [versions[query === 'Фильм' ? 0 : 1]],
        total: 1,
        page,
        categories: [],
    }));
    const query = { ...credit, title: 'Фильм', originalTitle: 'The Film' };
    assert.deepEqual(
        await findFilmographyTitle(client, 'source', query, signal()),
        {
            status: 'choices',
            items: versions,
        }
    );
    versions[0] = item('localized', { year: '2019' });
    assert.deepEqual(
        await findFilmographyTitle(client, 'source', query, signal()),
        {
            status: 'found',
            item: versions[1],
        }
    );
    const series = versions.map((m) => ({
        ...m,
        kind: 'series' as const,
        year: '2020',
    }));
    const mixed = provider(async (kind, _category, page) => ({
        items: [series[kind === 'series' ? 0 : 1]],
        total: 1,
        page,
        categories: [],
    }));
    mixed.capabilities.vodSeries = true;
    assert.deepEqual(
        await findFilmographyTitle(
            mixed,
            'source',
            { ...credit, mediaType: 'tv' },
            signal()
        ),
        {
            status: 'choices',
            items: series,
        }
    );
});
test('filmography searches every result page in the current portal and opens the year-corroborated provider item', async () => {
    const wanted = item('correct');
    const requests: unknown[] = [];
    const client = provider(async (kind, category, page, query) => {
        requests.push([kind, category, page, query]);
        return {
            items:
                page === 0
                    ? [
                          item('wrong-year', { year: '1980' }),
                          item('foreign', { sourceId: 'other' }),
                      ]
                    : [wanted],
            total: 3,
            page,
            categories: [],
        };
    });
    const result = await findFilmographyTitle(
        client,
        'source',
        credit,
        signal()
    );
    assert.equal(result.status, 'found');
    assert.equal(result.status === 'found' && result.item, wanted);
    assert.deepEqual(requests, [
        ['movie', '', 0, 'The Film'],
        ['movie', '', 1, 'The Film'],
    ]);
    assert.equal(wanted.providerId, 'provider-correct');
    assert.equal(wanted.raw.cmd, 'unchanged-provider-command');
});
test('localized filmographies retry original titles while keeping movie/series identities distinct', async () => {
    const queries: string[] = [];
    const client = provider(async (kind, _category, page, query) => {
        queries.push(`${kind}:${query}`);
        return {
            items:
                query === 'The Film'
                    ? [item('film'), item('series', { kind: 'series' })]
                    : [],
            total: query === 'The Film' ? 2 : 0,
            page,
            categories: [],
        };
    });
    const result = await findFilmographyTitle(
        client,
        'source',
        { ...credit, title: 'Фильм', originalTitle: 'The Film' },
        signal()
    );
    assert.equal(result.status === 'found' && result.item.kind, 'movie');
    assert.deepEqual(queries, ['movie:Фильм', 'movie:The Film']);
});
test('unknown availability is not reported as absence after a connection failure or incomplete/repeated pages', async () => {
    await assert.rejects(
        findFilmographyTitle(
            provider(async () => {
                throw new Error('offline');
            }),
            'source',
            credit,
            signal()
        )
    );
    const repeated = provider(async (_kind, _category, page) => ({
        items: [item('same', { title: 'Unrelated' })],
        total: 500,
        page,
        categories: [],
    }));
    await assert.rejects(
        findFilmographyTitle(repeated, 'source', credit, signal()),
        /incomplete/
    );
    const limited = provider(async (_kind, _category, page) => ({
        items: [item(String(page), { title: 'Unrelated' })],
        total: 500,
        page,
        categories: [],
    }));
    await assert.rejects(
        findFilmographyTitle(limited, 'source', credit, signal()),
        /incomplete/
    );
});
test('several matching portal versions require a choice; absent or contradicted remakes are not opened', async () => {
    const versions = [item('1080'), item('4k')];
    const catalog = (items: Media[]) =>
        provider(async (_kind, _category, page) => ({
            items,
            total: items.length,
            page,
            categories: [],
        }));
    assert.deepEqual(
        await findFilmographyTitle(
            catalog(versions),
            'source',
            credit,
            signal()
        ),
        { status: 'choices', items: versions }
    );
    assert.deepEqual(
        await findFilmographyTitle(catalog([]), 'source', credit, signal()),
        { status: 'missing' }
    );
    assert.deepEqual(
        await findFilmographyTitle(
            catalog([
                item('2049', { title: 'Blade Runner 2049', year: undefined }),
            ]),
            'source',
            { ...credit, title: 'Blade Runner', year: 1982 },
            signal()
        ),
        { status: 'missing' }
    );
});
test('cancellation before a lookup or after an ignored transport abort cannot publish a found title', async () => {
    const abort = new AbortController();
    abort.abort();
    let calls = 0;
    const client = provider(async (_kind, _category, page) => {
        calls++;
        return { items: [item('found')], total: 1, page, categories: [] };
    });
    await assert.rejects(
        findFilmographyTitle(client, 'source', credit, abort.signal),
        { name: 'AbortError' }
    );
    assert.equal(calls, 0);
    const late = new AbortController();
    const ignored = provider(async (_kind, _category, page) => {
        late.abort();
        return { items: [item('found')], total: 1, page, categories: [] };
    });
    await assert.rejects(
        findFilmographyTitle(ignored, 'source', credit, late.signal),
        { name: 'AbortError' }
    );
});

test('canonical numeric titles are not release tags, while TV season-year tags may follow the premiere', async () => {
    const numeric = item('numeric', {
        title: 'Blade Runner 2049',
        year: undefined,
    });
    const catalog = (value: Media) =>
        provider(async (_kind, _category, page) => ({
            items: [value],
            total: 1,
            page,
            categories: [],
        }));
    const result = await findFilmographyTitle(
        catalog(numeric),
        'source',
        { ...credit, title: 'Blade Runner 2049', year: 2017 },
        signal()
    );
    assert.equal(result.status === 'found' && result.item, numeric);
    const series = item('show', {
        kind: 'series',
        title: 'Ted Lasso s04 (2026)',
        year: '2026',
    });
    const tv = await findFilmographyTitle(
        catalog(series),
        'source',
        { ...credit, title: 'Ted Lasso', mediaType: 'tv', year: 2020 },
        signal()
    );
    assert.equal(tv.status === 'found' && tv.item, series);
    const remake = await findFilmographyTitle(
        catalog(
            item('remake', {
                kind: 'series',
                title: 'The Office',
                year: '2005',
            })
        ),
        'source',
        { ...credit, title: 'The Office', mediaType: 'tv', year: 2001 },
        signal()
    );
    assert.equal(remake.status, 'missing');
});

test('exact title/year versions on different pages require a choice after paging finishes', async () => {
    const versions = [item('1080'), item('4k')];
    const pages: number[] = [];
    const client = provider(async (_kind, _category, page) => {
        pages.push(page);
        return { items: [versions[page]], total: 2, page, categories: [] };
    });
    assert.deepEqual(
        await findFilmographyTitle(client, 'source', credit, signal()),
        { status: 'choices', items: versions }
    );
    assert.deepEqual(pages, [0, 1]);
});

test('an exact match cannot auto-open when a portal repeats pages instead of completing the search', async () => {
    let calls = 0;
    const wanted = item('found');
    const client = provider(async (_kind, _category, page) => {
        calls++;
        return { items: [wanted], total: 100000, page, categories: [] };
    });
    await assert.rejects(
        findFilmographyTitle(client, 'source', credit, signal()),
        /incomplete/
    );
    assert.equal(calls, 2);
});
