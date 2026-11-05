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
const direct = 'https://media.invalid/movie.mp4?token=fixture';
const movie = {
    stream_id: 42,
    container_extension: null,
    direct_source: direct,
};

for (const { label, raw, expectedRequests } of [
    {
        label: 'loaded details with a playable catalog row',
        raw: {
            stream_id: 42,
            container_extension: 'mp4',
            details: { movie_data: movie },
        },
        expectedRequests: 0,
    },
    {
        label: 'loaded details without a catalog format',
        raw: { stream_id: 42, details: { movie_data: movie } },
        expectedRequests: 0,
    },
    { label: 'catalog', raw: movie, expectedRequests: 0 },
    { label: 'fresh details', raw: { stream_id: 42 }, expectedRequests: 1 },
]) {
    test(`Xtream resolves a direct-only movie from ${label}`, async () => {
        let requests = 0;
        class Transport extends ProviderTransport {
            async request() {
                requests++;
                return { movie_data: movie };
            }
        }
        const provider = createProvider(
            source,
            new Transport('https://backend.invalid'),
            async () => undefined
        );
        const item = {
            id: 'movie',
            sourceId: source.id,
            providerId: '42',
            kind: 'movie' as const,
            title: 'Movie',
            raw,
        };
        assert.equal(
            (await provider.resolve(item, new AbortController().signal)).url,
            direct
        );
        assert.equal(requests, expectedRequests);
    });
}
