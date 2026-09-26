import { buildM3uCatalogIndex } from './m3u-catalog-index.util';
import { M3U_ENTRY_CORPUS } from './m3u-entry-corpus.spec-data';

const row = (url: string, name: string, group: string, radio?: 'true') => ({
    url,
    name,
    radio,
    group: { title: group },
});

/**
 * The corpus models the raw `group-title` attribute; the index consumes the
 * parsed channel shape, where the parser has already wrapped it.
 */
const asChannels = M3U_ENTRY_CORPUS.map((entry) => ({
    ...entry,
    group: { title: entry.group },
}));

describe('buildM3uCatalogIndex', () => {
    it('splits the corpus by kind and counts each', () => {
        const index = buildM3uCatalogIndex(asChannels);

        for (const kind of ['live', 'movie', 'episode', 'radio'] as const) {
            const expected = M3U_ENTRY_CORPUS.filter(
                (entry) => entry.kind === kind
            );
            expect(index.counts[kind]).toBe(expected.length);
            expect(index.byKind[kind]).toHaveLength(expected.length);
        }
    });

    it('buckets groups per kind, because groups mix kinds', () => {
        // The real shape this guards: one provider group holding both a film
        // and a series episode. A single group→rows map would put a film in
        // the series tab.
        const index = buildM3uCatalogIndex([
            row('http://h.example/movie/u/p/1.mkv', 'Dune', 'Netflix TR'),
            row(
                'http://h.example/series/u/p/2.mp4',
                'Dark S01E01',
                'Netflix TR'
            ),
            row('http://h.example/live/u/p/3.ts', 'TRT 1', 'Ulusal'),
        ]);

        expect(index.groupsByKind.movie).toEqual([
            {
                title: 'Netflix TR',
                channels: [expect.objectContaining({ name: 'Dune' })],
            },
        ]);
        expect(index.groupsByKind.episode.map((g) => g.title)).toEqual([
            'Netflix TR',
        ]);
        expect(index.groupsByKind.live.map((g) => g.title)).toEqual(['Ulusal']);
    });

    it('keeps the provider group order', () => {
        const index = buildM3uCatalogIndex([
            row('http://h.example/live/u/p/1.ts', 'A', 'Zeta'),
            row('http://h.example/live/u/p/2.ts', 'B', 'Alpha'),
            row('http://h.example/live/u/p/3.ts', 'C', 'Zeta'),
        ]);

        expect(index.groupsByKind.live.map((g) => g.title)).toEqual([
            'Zeta',
            'Alpha',
        ]);
        expect(index.groupsByKind.live[0].channels).toHaveLength(2);
    });

    it('collects ungrouped rows under an empty title', () => {
        const index = buildM3uCatalogIndex([
            { url: 'http://h.example/live/u/p/1.ts', name: 'A' },
        ]);

        expect(index.groupsByKind.live[0].title).toBe('');
    });

    it('reports a live-only playlist as having no other content', () => {
        const index = buildM3uCatalogIndex([
            row('http://h.example/live/u/p/1.ts', 'A', 'News'),
        ]);

        expect(index.hasNonLiveContent).toBe(false);
    });

    it('reports mixed content so the catalog tabs can appear', () => {
        const index = buildM3uCatalogIndex([
            row('http://h.example/live/u/p/1.ts', 'A', 'News'),
            row('http://h.example/movie/u/p/2.mkv', 'Dune', 'Films'),
        ]);

        expect(index.hasNonLiveContent).toBe(true);
    });

    it('handles an absent or empty playlist', () => {
        for (const input of [null, undefined, []]) {
            const index = buildM3uCatalogIndex(input);
            expect(index.counts.live).toBe(0);
            expect(index.groupsByKind.live).toEqual([]);
            expect(index.hasNonLiveContent).toBe(false);
        }
    });
});
