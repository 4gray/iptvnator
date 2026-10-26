import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    createProvider,
    findFilmographyTitle,
    ProviderTransport,
} from '@iptvnator/tv/data-access';
import type { Source } from '@iptvnator/tv/util';

class Transport extends ProviderTransport {
    constructor() {
        super('https://backend.invalid');
    }
    async request(
        _source: Source,
        _route: 'xtream' | 'stalker' | 'parse',
        params: Record<string, string | number>
    ) {
        return params.action === 'get_vod_streams'
            ? [
                  {
                      stream_id: 42,
                      name: 'Spider Man (2002)',
                      year: '2002',
                      category_id: 'films',
                  },
              ]
            : [];
    }
}
for (const providerType of ['xtream', 'm3u'] as const) {
    test(`filmography ${providerType} normalizes punctuation before local catalog filtering`, async () => {
        const source: Source = {
            id: 'source',
            name: 'Fixture',
            provider: providerType,
            url: 'https://provider.invalid',
            username: 'fixture',
            password: 'fixture',
            m3uItems: [
                {
                    name: 'Spider Man (2002)',
                    url: 'https://media.invalid/film.mp4',
                    group: { title: 'films' },
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
            if (providerType === 'm3u') await client.connect(signal);
            const result = await findFilmographyTitle(
                client,
                source.id,
                {
                    tmdbId: 557,
                    title: 'Spider-Man',
                    mediaType: 'movie',
                    year: 2002,
                    character: null,
                    crewJob: null,
                    posterUrl: null,
                },
                signal
            );
            assert.equal(result.status, 'found');
            assert.equal(
                result.status === 'found' && result.item.title,
                'Spider Man (2002)'
            );
            const empty = await client.catalog(
                'movie',
                '',
                0,
                'Unrelated Film',
                signal
            );
            assert.equal(empty.total, 0);
        } finally {
            client.dispose();
        }
    });
}
