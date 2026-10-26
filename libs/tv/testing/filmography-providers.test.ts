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

test('M3U release tags reject the wrong remake without treating canonical numeric titles as release years', async () => {
    const source: Source = {
        id: 'source',
        name: 'Fixture',
        provider: 'm3u',
        url: 'https://provider.invalid/list.m3u',
        m3uItems: [
            'Dune (2021)',
            'Dune [2021]',
            'Dune {2021}',
            'Blade Runner 2049',
        ].map((name, index) => ({
            name,
            url: `https://media.invalid/film-${index}.mp4`,
        })),
    };
    const client = createProvider(
        source,
        new Transport(),
        async () => undefined
    );
    const signal = new AbortController().signal;
    const credit = {
        tmdbId: 841,
        title: 'Dune',
        mediaType: 'movie' as const,
        year: 1984,
        character: null,
        crewJob: null,
        posterUrl: null,
    };
    try {
        await client.connect(signal);
        assert.equal(
            (await findFilmographyTitle(client, source.id, credit, signal))
                .status,
            'missing'
        );
        const modern = await findFilmographyTitle(
            client,
            source.id,
            { ...credit, year: 2021 },
            signal
        );
        assert.equal(modern.status, 'choices');
        assert.equal(modern.status === 'choices' && modern.items.length, 3);
        assert.equal(
            (
                await findFilmographyTitle(
                    client,
                    source.id,
                    { ...credit, title: 'Blade Runner 2049', year: 2017 },
                    signal
                )
            ).status,
            'found'
        );
    } finally {
        client.dispose();
    }
});
