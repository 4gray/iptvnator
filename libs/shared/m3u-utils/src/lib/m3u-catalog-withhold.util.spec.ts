import { buildM3uCatalogIndex } from './m3u-catalog-index.util';
import {
    isM3uGroupWithheld,
    withholdM3uCatalogGroups,
} from './m3u-catalog-withhold.util';

const row = (name: string, group: string, path: string) => ({
    name,
    url: `http://h.example/${path}`,
    group: { title: group },
});

const ROWS = [
    row('Open News', 'News', 'live/u/p/1.ts'),
    row('Night Desk', 'Locked News', 'live/u/p/2.ts'),
    row('Sandline (2021)', 'Films', 'movie/u/p/3.mkv'),
    row('Dry Canyon (2015)', 'Locked Films', 'movie/u/p/4.mkv'),
    row('Harbor Lights S01E01', 'Shows', 'series/u/p/5.mp4'),
];

describe('withholdM3uCatalogGroups', () => {
    const index = buildM3uCatalogIndex(ROWS);

    it('returns the index untouched when nothing is withheld', () => {
        expect(withholdM3uCatalogGroups(index, null)).toBe(index);
    });

    it('takes every row and group of a withheld group out', () => {
        const visible = withholdM3uCatalogGroups(
            index,
            new Set(['Locked News', 'Locked Films'])
        );

        expect(visible.byKind.movie.map((r) => r.name)).toEqual([
            'Sandline (2021)',
        ]);
        expect(visible.liveChannels.map((r) => r.name)).toEqual(['Open News']);
        expect(visible.groupsByKind.movie.map((g) => g.title)).toEqual([
            'Films',
        ]);
        expect(visible.counts).toEqual({
            live: 1,
            movie: 1,
            episode: 1,
            radio: 0,
        });
    });

    it('withholds everything when the lock store cannot be read', () => {
        const visible = withholdM3uCatalogGroups(index, 'all');

        expect(visible.byKind.movie).toEqual([]);
        expect(visible.liveChannels).toEqual([]);
        // The split itself stays: locking must not pour films back into
        // the channel list.
        expect(visible.hasNonLiveContent).toBe(true);
    });

    it('withholds nothing when there is no lock in force', () => {
        expect(isM3uGroupWithheld(null, 'News')).toBe(false);
    });

    it('takes a row with no group out when the empty group is withheld', () => {
        const ungrouped = {
            name: 'Loose',
            url: 'http://h.example/live/u/p/9.ts',
        };
        const visible = withholdM3uCatalogGroups(
            buildM3uCatalogIndex([ungrouped, ...ROWS]),
            new Set([''])
        );

        expect(visible.liveChannels.map((r) => r.name)).not.toContain('Loose');
        expect(visible.liveChannels).toHaveLength(2);
    });

    it('treats a row with no group as the empty group', () => {
        expect(isM3uGroupWithheld(new Set(['']), undefined)).toBe(true);
        expect(isM3uGroupWithheld(new Set(['News']), undefined)).toBe(false);
    });
});
