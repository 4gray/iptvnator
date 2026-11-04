import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProvider, ProviderTransport } from '@iptvnator/tv/data-access';
import { type Source } from '@iptvnator/tv/util';

class Transport extends ProviderTransport {
    constructor() {
        super('https://backend.invalid');
    }
    async request(
        _source: Source,
        route: 'xtream' | 'stalker' | 'parse',
        params: Record<string, string | number>
    ) {
        if (route === 'xtream')
            return String(params.action).endsWith('categories')
                ? [{ category_id: '77', category_name: 'Fixture Collection' }]
                : [
                      {
                          stream_id: 42,
                          series_id: 42,
                          name: 'Fixture Title',
                          category_id: '77',
                      },
                  ];
        return {
            js:
                params.action === 'get_categories'
                    ? [{ id: '77', title: 'Fixture Collection' }]
                    : {
                          data: [
                              {
                                  id: 42,
                                  name: 'Fixture Title',
                                  category_id: '77',
                              },
                          ],
                          total_items: 1,
                          max_page_items: 10,
                      },
        };
    }
}

for (const provider of ['xtream', 'stalker', 'm3u'] as const) {
    test(`${provider} catalog preserves a named category with the original media identity`, async () => {
        const source: Source = {
            id: 'fixture',
            provider,
            name: 'Fixture Source',
            url: 'https://provider.invalid',
            full: true,
            token: 'fixture-token',
            endpoint: 'https://provider.invalid/server/load.php',
            m3uItems: [
                {
                    name: 'Fixture Title',
                    url: 'https://provider.invalid/fixture.mp4',
                    group: { title: 'Fixture Collection' },
                },
            ],
        };
        const client = createProvider(
            source,
            new Transport(),
            async () => undefined
        );
        const signal = new AbortController().signal;
        try {
            if (provider === 'm3u') await client.connect(signal);
            for (const kind of provider === 'm3u'
                ? (['movie'] as const)
                : (['movie', 'series'] as const)) {
                const result = await client.catalog(kind, '', 0, '', signal);
                assert.equal(
                    result.items[0].categoryName,
                    'Fixture Collection'
                );
                assert.equal(
                    result.items[0].category,
                    provider === 'm3u' ? 'Fixture Collection' : '77'
                );
                assert.equal(result.items[0].sourceId, 'fixture');
            }
        } finally {
            client.dispose();
        }
    });
}
