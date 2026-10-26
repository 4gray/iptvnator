import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Source } from '@iptvnator/tv/util';
import {
    ProviderTransport,
    createProvider,
    findFilmographyTitle,
} from '@iptvnator/tv/data-access';
class Transport extends ProviderTransport {
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
        return this.respond(params);
    }
}
const source = (): Source => ({
    id: 's',
    provider: 'stalker',
    name: 'Fixture',
    url: 'https://portal.invalid/portal.php',
    endpoint: 'https://portal.invalid/portal.php',
    macAddress: '00:1A:79:00:00:01',
    full: false,
});
test('filmography finds an embedded VOD series by original title when the regular series API is unsupported', async () => {
    const queries: string[] = [];
    const transport = new Transport((params) => {
        if (params.action === 'get_categories') return { js: [] };
        queries.push(`${params.type}:${params.search}`);
        if (params.type === 'series') return { js: false };
        const data =
            params.search === 'Ted Lasso'
                ? [
                      {
                          id: 'movie-collision',
                          name: 'Ted Lasso',
                          year: '2020',
                      },
                      {
                          id: 'show',
                          name: 'Ted Lasso s04',
                          year: '2026',
                          series: [1, 2, 3],
                          cmd: 'ffrt http://fixture.invalid/show',
                      },
                  ]
                : [];
        return { js: { data, total_items: data.length, max_page_items: 10 } };
    });
    const provider = createProvider(
        { ...source(), full: false },
        transport,
        async () => undefined
    );
    try {
        const result = await findFilmographyTitle(
            provider,
            's',
            {
                tmdbId: 97546,
                title: 'Тед Лассо',
                originalTitle: 'Ted Lasso',
                mediaType: 'tv',
                year: 2020,
                posterUrl: null,
                character: null,
                crewJob: null,
            },
            new AbortController().signal
        );
        assert.equal(result.status, 'found');
        assert.equal(
            result.status === 'found' && result.item.raw.origin,
            'vod'
        );
        assert.equal(
            result.status === 'found' && result.item.providerId,
            'show'
        );
        assert.ok(queries.includes('vod:Ted Lasso'));
        await assert.rejects(
            findFilmographyTitle(
                provider,
                's',
                {
                    tmdbId: 1,
                    title: 'Missing show',
                    mediaType: 'tv',
                    year: 2020,
                    posterUrl: null,
                    character: null,
                    crewJob: null,
                },
                new AbortController().signal
            ),
            /incomplete/
        );
    } finally {
        provider.dispose();
    }
});
